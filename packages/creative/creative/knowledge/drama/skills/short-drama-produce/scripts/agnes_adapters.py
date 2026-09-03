#!/usr/bin/env python3
"""Stdlib-only Agnes production adapters for image and video generation.

This file is a DSH-side companion to the pinned upstream
``provider_adapters.py`` in the same directory: it imports that module's
shared helpers (credential handling, safe HTTP, reference inlining, output
handling) and adds two adapters the upstream snapshot does not ship. The
upstream file itself stays byte-identical to its manifest pin.

Like the upstream adapters, the public ``compile_*`` functions are
deterministic and perform no I/O. The CLI reads the confirmed production job
from stdin and writes only the adapter contract JSON to stdout after a
provider result has been saved to a temporary regular file.

Image generation (``agnes-image``) is synchronous: ``POST /v1/images/generations``
returns a URL (or Base64 payload) directly. Video generation (``agnes-video``)
is asynchronous: ``POST /v1/videos`` returns a ``video_id`` that is polled via
``GET /agnesapi`` until the task completes. Both endpoints share one
``AGNES_API_KEY`` bearer credential under one base URL.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import sys
import time
import urllib.parse
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from provider_adapters import (  # noqa: E402
    TERMINAL_FAILURES,
    AdapterFailure,
    _base_url,
    _binding_roles,
    _credential,
    _download,
    _inline_reference_urls,
    _is_inline_reference,
    _pop_prompt_language,
    _prompt_with_reference_contract,
    _provider_code,
    _reference_paths,
    _request_id,
    _request_json,
    _require_job,
    _take,
    _temporary_output,
)

AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1"
AGNES_IMAGE_MODEL = "agnes-image-2.5-flash"
AGNES_IMAGE_SIZES = {"1K", "2K", "3K", "4K"}
AGNES_IMAGE_RATIOS = {"1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"}
AGNES_IMAGE_ROLES = {"reference_image": "image_url"}
AGNES_VIDEO_FLASH_MODEL = "agnes-video-2.5-flash"
AGNES_VIDEO_MODEL = "agnes-video-2.5"
AGNES_VIDEO_MODELS = {AGNES_VIDEO_FLASH_MODEL, AGNES_VIDEO_MODEL}
AGNES_VIDEO_RATIOS = {"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
AGNES_VIDEO_RESOLUTIONS = {"720P", "2K"}
AGNES_VIDEO_ROLES = {
    "first_frame": "image_url",
    "last_frame": "image_url",
    "reference_image": "image_url",
    "reference_audio": "audio_url",
    "reference_video": "video_url",
}
MINIMUM_PYTHON = (3, 9)
if sys.version_info < MINIMUM_PYTHON:
    raise SystemExit("agnes_adapters.py requires Python 3.9 or newer")


def compile_agnes_image_payload(
    job: Mapping[str, Any],
    *,
    model: str,
    reference_urls: Sequence[str] = (),
    reference_roles: Sequence[str] = (),
) -> dict[str, Any]:
    """Compile an image job into the Agnes image-generation request body.

    ``model`` is the exact Agnes image model id (``AGNES_IMAGE_MODEL`` when
    unset); every documented image release shares the same size tiers, so any
    non-empty id is accepted. Reference images ride ``extra_body.image`` as
    URLs or Base64 data URIs, and the result is always requested as a URL.
    """
    prompt, parameters = _require_job(job, "image")
    if not isinstance(model, str) or not model.strip():
        raise ValueError("Agnes image model must be explicitly configured")
    references = job.get("references", [])
    if not isinstance(references, list) or len(reference_urls) != len(references):
        raise ValueError("Agnes reference URLs must match job references")
    if len(reference_roles) != len(reference_urls):
        raise ValueError("Agnes reference roles must match job references")
    if Path(job["outputs"][0]).suffix.casefold() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("Agnes image adapter requires a PNG, JPG, or WebP target")
    parameters = _take(parameters, {"size", "ratio", "prompt_language"})
    prompt_language = _pop_prompt_language(parameters)
    size = parameters.get("size")
    if not isinstance(size, str) or size not in AGNES_IMAGE_SIZES:
        raise ValueError("Agnes image size must be one of 1K, 2K, 3K, or 4K")
    ratio = parameters.get("ratio", "1:1")
    if not isinstance(ratio, str) or ratio not in AGNES_IMAGE_RATIOS:
        raise ValueError("Agnes image ratio is outside the supported profile")
    reference_tokens = [f"<Picture {index}>" for index in range(1, len(references) + 1)]
    for role in reference_roles:
        if role not in AGNES_IMAGE_ROLES:
            raise ValueError(f"unsupported Agnes image reference role: {role}")
    text = _prompt_with_reference_contract(
        prompt,
        job,
        prompt_language=prompt_language,
        reference_tokens=reference_tokens,
    )
    for url in reference_urls:
        if not isinstance(url, str) or not url:
            raise ValueError("Agnes reference URL must be non-empty")
        parsed = urllib.parse.urlparse(url)
        if not (
            (parsed.scheme == "https" and parsed.netloc) or _is_inline_reference(url)
        ):
            raise ValueError("Agnes reference URL must be HTTPS or a base64 data URI")
    extra_body: dict[str, Any] = {"response_format": "url"}
    if reference_urls:
        extra_body["image"] = list(reference_urls)
    return {
        "model": model.strip(),
        "prompt": text,
        "size": size,
        "ratio": ratio,
        "extra_body": extra_body,
    }


def _agnes_query_root(base: str) -> str:
    """Derive the task-query root from the configured API base URL.

    Task creation lives under ``{base}/videos`` while task queries live one
    level up at ``/agnesapi`` (``{root}/agnesapi``), so a base URL ending in
    ``/v1`` sheds that suffix for polling. A custom base without the suffix
    is used as-is.
    """
    root = base.rstrip("/")
    if root.casefold().endswith("/v1"):
        root = root[: -len("/v1")]
    if not root:
        raise AdapterFailure(
            "Agnes base URL leaves no query root",
            category="configuration",
            code="invalid_base_url",
        )
    return root


def _run_agnes_image(job: Mapping[str, Any]) -> tuple[Path, str | None]:
    token = _credential("AGNES_API_KEY")
    model = os.environ.get("AGNES_IMAGE_MODEL", AGNES_IMAGE_MODEL)
    references = _reference_paths(job)
    reference_roles = (
        _binding_roles(job, allowed=AGNES_IMAGE_ROLES, provider="Agnes")
        if references
        else []
    )
    reference_urls = _inline_reference_urls(
        references, reference_roles, allowed=AGNES_IMAGE_ROLES, provider="Agnes"
    )
    body = compile_agnes_image_payload(
        job,
        model=model,
        reference_urls=reference_urls,
        reference_roles=reference_roles,
    )
    base = _base_url("AGNES_BASE_URL", AGNES_BASE_URL)
    result, headers = _request_json(
        f"{base}/images/generations",
        provider="agnes-image",
        body=body,
        token=token,
    )
    data = result.get("data") if isinstance(result, Mapping) else None
    first = data[0] if isinstance(data, list) and len(data) == 1 and isinstance(data[0], Mapping) else None
    request_id = _request_id(headers)
    if first is None:
        raise AdapterFailure(
            "Agnes did not return exactly one image",
            code="missing_image",
            request_id=request_id,
        )
    url = first.get("url")
    if isinstance(url, str) and url:
        return (
            _download(job, url, job["outputs"][0], provider="agnes-image"),
            request_id,
        )
    encoded = first.get("b64_json")
    if not isinstance(encoded, str) or not encoded:
        raise AdapterFailure(
            "Agnes did not return exactly one image",
            code="missing_image",
            request_id=request_id,
        )
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise AdapterFailure(
            "Agnes returned invalid image data",
            code="invalid_image_data",
            request_id=request_id,
        ) from exc
    return _temporary_output(job, job["outputs"][0], content), request_id


def compile_agnes_video_payload(
    job: Mapping[str, Any],
    *,
    model: str,
    reference_urls: Sequence[str] = (),
    reference_roles: Sequence[str] = (),
) -> dict[str, Any]:
    """Compile a video job into the Agnes video-task creation body.

    ``model`` must be one of the two documented releases: the flash model is
    free but fixed to ``720P`` without video references, while ``agnes-video-2.5``
    bills per second and additionally accepts ``2K`` and video references.
    ``mode`` may be omitted, in which case it is derived from the bound
    references (frames select keyframe, media selects reference, neither
    selects text); an explicit mode must agree with them.
    """
    prompt, parameters = _require_job(job, "video")
    if not isinstance(model, str) or model.strip() not in AGNES_VIDEO_MODELS:
        raise ValueError(
            "Agnes video model must be agnes-video-2.5-flash or agnes-video-2.5"
        )
    flash = model.strip() != AGNES_VIDEO_MODEL
    references = job.get("references", [])
    if not isinstance(references, list) or len(reference_urls) != len(references):
        raise ValueError("Agnes reference URLs must match job references")
    if len(reference_roles) != len(reference_urls):
        raise ValueError("Agnes reference roles must match job references")
    if Path(job["outputs"][0]).suffix.casefold() != ".mp4":
        raise ValueError("Agnes video adapter requires an MP4 target")
    parameters = _take(
        parameters, {"duration", "ratio", "resolution", "mode", "seed", "prompt_language"}
    )
    prompt_language = _pop_prompt_language(parameters)
    duration = parameters.get("duration", 5)
    if not isinstance(duration, int) or isinstance(duration, bool) or not 4 <= duration <= 12:
        raise ValueError("Agnes video duration must be an integer from 4 to 12 seconds")
    resolution = parameters.get("resolution", "720P")
    if resolution not in AGNES_VIDEO_RESOLUTIONS:
        raise ValueError("Agnes video resolution must be 720P or 2K")
    if flash and resolution != "720P":
        raise ValueError("Agnes flash video supports only 720P")
    ratio = parameters.get("ratio", "16:9")
    if not isinstance(ratio, str) or ratio not in AGNES_VIDEO_RATIOS:
        raise ValueError("Agnes video ratio is outside the supported profile")
    seed = parameters.get("seed")
    if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool)):
        raise ValueError("Agnes video seed must be an integer")
    for role in reference_roles:
        if role not in AGNES_VIDEO_ROLES:
            raise ValueError(f"unsupported Agnes video reference role: {role}")
        if role == "reference_video" and flash:
            raise ValueError("Agnes flash video does not accept video references")
    seen_frames = [role for role in reference_roles if role in {"first_frame", "last_frame"}]
    if len(set(seen_frames)) != len(seen_frames):
        raise ValueError("Agnes accepts one first_frame and one last_frame reference")
    seen_media = [role for role in reference_roles if role.startswith("reference_")]
    if seen_frames and seen_media:
        raise ValueError("Agnes frame conditioning cannot be mixed with reference conditioning")
    mode = parameters.get("mode")
    if mode is None:
        mode = "keyframe" if seen_frames else "reference" if seen_media else "text"
    if mode == "text":
        if reference_roles:
            raise ValueError("Agnes text-to-video accepts no references")
    elif mode == "keyframe":
        if not seen_frames or seen_media:
            raise ValueError("Agnes keyframe mode needs a first or last frame reference")
    elif mode == "reference":
        if not seen_media or seen_frames:
            raise ValueError("Agnes reference mode needs an image or audio reference")
    else:
        raise ValueError('Agnes video mode must be text, keyframe, or reference')
    counters = {"image_url": 0, "video_url": 0, "audio_url": 0}
    labels = {"image_url": "Picture", "video_url": "Video", "audio_url": "Audio"}
    reference_tokens: list[str] = []
    for role in reference_roles:
        field = AGNES_VIDEO_ROLES[role]
        counters[field] += 1
        reference_tokens.append(f"<{labels[field]} {counters[field]}>")
    text = _prompt_with_reference_contract(
        prompt,
        job,
        prompt_language=prompt_language,
        reference_tokens=reference_tokens,
    )
    images = [
        url for url, role in zip(reference_urls, reference_roles) if role == "reference_image"
    ]
    audios = [
        url for url, role in zip(reference_urls, reference_roles) if role == "reference_audio"
    ]
    videos = [
        {"url": url}
        for url, role in zip(reference_urls, reference_roles)
        if role == "reference_video"
    ]
    if mode == "reference":
        if len(images) > 5:
            raise ValueError("Agnes flash video accepts at most five reference images")
        if flash and len(audios) > 3:
            raise ValueError("Agnes flash video accepts at most three reference audios")
    for url in reference_urls:
        if not isinstance(url, str) or not url:
            raise ValueError("Agnes reference URL must be non-empty")
        parsed = urllib.parse.urlparse(url)
        if not (
            (parsed.scheme == "https" and parsed.netloc) or _is_inline_reference(url)
        ):
            raise ValueError("Agnes reference URL must be HTTPS or a base64 data URI")
    body: dict[str, Any] = {
        "model": model.strip(),
        "prompt": text,
        "mode": mode,
        "seconds": str(duration),
        "size": resolution,
        "aspect_ratio": ratio,
        "n": 1,
    }
    if seed is not None:
        body["seed"] = seed
    for role in ("first_frame", "last_frame"):
        if role in reference_roles:
            body[role] = reference_urls[reference_roles.index(role)]
    if images:
        body["images"] = images
    if audios:
        body["audios"] = audios
    if videos:
        body["videos"] = videos
    return body


def _run_agnes_video(job: Mapping[str, Any]) -> tuple[Path, str]:
    token = _credential("AGNES_API_KEY")
    model = os.environ.get("AGNES_VIDEO_MODEL", "")
    references = _reference_paths(job)
    reference_roles = (
        _binding_roles(job, allowed=AGNES_VIDEO_ROLES, provider="Agnes")
        if references
        else []
    )
    reference_urls = _inline_reference_urls(
        references, reference_roles, allowed=AGNES_VIDEO_ROLES, provider="Agnes"
    )
    body = compile_agnes_video_payload(
        job,
        model=model,
        reference_urls=reference_urls,
        reference_roles=reference_roles,
    )
    base = _base_url("AGNES_BASE_URL", AGNES_BASE_URL)
    created, _ = _request_json(
        f"{base}/videos",
        provider="agnes-video",
        body=body,
        token=token,
    )
    video_id = created.get("video_id")
    if not isinstance(video_id, str) or not video_id:
        raise AdapterFailure(
            "Agnes did not return a video id",
            code=_provider_code(created) or "missing_video_id",
        )
    query = (
        f"{_agnes_query_root(base)}/agnesapi"
        f"?video_id={urllib.parse.quote(video_id, safe='')}"
        f"&model_name={urllib.parse.quote(model.strip(), safe='')}"
    )
    try:
        interval = float(os.environ.get("AGNES_VIDEO_POLL_INTERVAL", "2"))
        deadline = time.monotonic() + float(
            os.environ.get("AGNES_VIDEO_TIMEOUT_SECONDS", "1800")
        )
    except ValueError as exc:
        raise AdapterFailure("Agnes polling configuration is invalid") from exc
    if interval <= 0 or deadline <= time.monotonic():
        raise AdapterFailure("Agnes polling configuration is invalid")
    while time.monotonic() < deadline:
        document, _ = _request_json(
            query,
            provider="agnes-video",
            method="GET",
            token=token,
        )
        status = document.get("status")
        if status == "completed":
            metadata = document.get("metadata")
            url = metadata.get("url") if isinstance(metadata, Mapping) else None
            if not isinstance(url, str) or not url:
                raise AdapterFailure(
                    "Agnes completed without a video URL",
                    code="missing_video_url",
                    request_id=video_id,
                )
            return _download(
                job, url, job["outputs"][0], provider="agnes-video"
            ), video_id
        if isinstance(status, str) and status.casefold() in TERMINAL_FAILURES:
            raise AdapterFailure(
                "Agnes video task failed",
                code="task_" + status.casefold(),
                request_id=video_id,
            )
        if status not in {"queued", "in_progress"}:
            raise AdapterFailure(
                "Agnes returned an unknown task status",
                code="unknown_task_status",
                request_id=video_id,
            )
        time.sleep(interval)
    raise AdapterFailure(
        "Agnes video task polling timed out",
        category="timeout",
        code="task_poll_timeout",
        request_id=video_id,
        retryable=True,
    )


def _selftest() -> None:
    image = {
        "modality": "image", "prompt": "portrait", "references": [],
        "outputs": ["制作成果/a.png"], "parameters": {"size": "2K", "ratio": "16:9"},
    }
    video = {
        "modality": "video", "prompt": "slow push in", "references": [],
        "outputs": ["制作成果/a.mp4"], "parameters": {"duration": 5, "ratio": "9:16"},
    }
    compiled_image = compile_agnes_image_payload(image, model=AGNES_IMAGE_MODEL)
    if compiled_image["model"] != AGNES_IMAGE_MODEL:
        raise RuntimeError("Agnes image model self-test failed")
    if compiled_image["size"] != "2K" or compiled_image["ratio"] != "16:9":
        raise RuntimeError("Agnes image parameter self-test failed")
    extra_body = compiled_image["extra_body"]
    if extra_body.get("response_format") != "url" or "image" in extra_body:
        raise RuntimeError("Agnes image extra_body self-test failed")
    compiled_default = compile_agnes_image_payload(
        {**image, "parameters": {"size": "1K"}}, model=AGNES_IMAGE_MODEL
    )
    if compiled_default["ratio"] != "1:1":
        raise RuntimeError("Agnes image default ratio self-test failed")
    for invalid_image in (
        {**image, "parameters": {"size": "720P"}},
        {**image, "parameters": {"size": "2K", "ratio": "21:10"}},
        {**image, "parameters": {"size": "2K", "quality": "high"}},
        {**image, "outputs": ["制作成果/a.mp4"]},
    ):
        try:
            compile_agnes_image_payload(invalid_image, model=AGNES_IMAGE_MODEL)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid Agnes image payload was accepted")
    try:
        compile_agnes_image_payload(image, model="  ")
    except ValueError:
        pass
    else:
        raise AssertionError("Agnes image payload without a model was accepted")
    compiled_video = compile_agnes_video_payload(video, model=AGNES_VIDEO_FLASH_MODEL)
    if compiled_video["model"] != AGNES_VIDEO_FLASH_MODEL:
        raise RuntimeError("Agnes video model self-test failed")
    if (
        compiled_video["mode"] != "text"
        or compiled_video["seconds"] != "5"
        or compiled_video["size"] != "720P"
        or compiled_video["aspect_ratio"] != "9:16"
    ):
        raise RuntimeError("Agnes video parameter self-test failed")
    compiled_premium = compile_agnes_video_payload(
        {**video, "parameters": {"duration": 8, "ratio": "16:9", "resolution": "2K"}},
        model=AGNES_VIDEO_MODEL,
    )
    if compiled_premium["size"] != "2K" or compiled_premium["seconds"] != "8":
        raise RuntimeError("Agnes premium video self-test failed")
    for invalid_video in (
        {**video, "parameters": {"duration": 3}},
        {**video, "parameters": {"duration": 5, "resolution": "2K"}},
        {**video, "parameters": {"duration": 5, "mode": "keyframe"}},
        {**video, "parameters": {"duration": 5, "mode": "cinescape"}},
        {**video, "parameters": {"duration": "5"}},
        {**video, "outputs": ["制作成果/a.png"]},
    ):
        try:
            compile_agnes_video_payload(invalid_video, model=AGNES_VIDEO_FLASH_MODEL)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid Agnes video payload was accepted")
    try:
        compile_agnes_video_payload(video, model="")
    except ValueError:
        pass
    else:
        raise AssertionError("Agnes video payload without a model was accepted")
    try:
        compile_agnes_video_payload(video, model="agnes-video-9.9")
    except ValueError:
        pass
    else:
        raise AssertionError("Agnes video payload with an unknown model was accepted")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "provider",
        nargs="?",
        choices=("agnes-image", "agnes-video"),
    )
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        _selftest()
        return 0
    if args.provider is None:
        parser.error("provider is required unless --selftest is used")
    try:
        job = json.load(sys.stdin.buffer)
        if not isinstance(job, Mapping):
            raise ValueError("adapter input must be an object")
        runners = {
            "agnes-image": _run_agnes_image,
            "agnes-video": _run_agnes_video,
        }
        path, provider_job_id = runners[args.provider](job)
        response: dict[str, Any] = {
            "outputs": [{"target": job["outputs"][0], "source": str(path)}]
        }
        if provider_job_id:
            response["provider_job_id"] = provider_job_id
        json.dump(response, sys.stdout, ensure_ascii=True)
        return 0
    except AdapterFailure as exc:
        # Provider bodies and credentials are intentionally never reflected.
        json.dump({"error": exc.public(args.provider)}, sys.stdout, ensure_ascii=True)
        print("provider adapter failed safely", file=sys.stderr)
        return 1
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        json.dump(
            {
                "error": {
                    "provider": args.provider,
                    "category": "invalid_request",
                    "code": "invalid_job",
                    "retryable": False,
                }
            },
            sys.stdout,
            ensure_ascii=True,
        )
        print("provider adapter failed safely", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
