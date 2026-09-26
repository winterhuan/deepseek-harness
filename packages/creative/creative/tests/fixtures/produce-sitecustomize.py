"""Offline HTTP responses for real Creative production subprocess tests."""

import base64
import io
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request


def reject_network(event, _arguments):
    if event in {"socket.connect", "socket.getaddrinfo"}:
        raise RuntimeError("production contract tests forbid network access")


sys.addaudithook(reject_network)


def record(event):
    with Path(os.environ["CREATIVE_TEST_EVENTS"]).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event) + "\n")


def response(document):
    result = io.BytesIO(json.dumps(document).encode("utf-8"))
    result.headers = {}
    return result


def offline_urlopen(request, **_kwargs):
    url = request if isinstance(request, str) else request.full_url
    method = "GET" if isinstance(request, str) else request.get_method()
    mode = os.environ["CREATIVE_TEST_MODE"]
    if not url.startswith("https://provider.invalid/"):
        raise RuntimeError("unexpected URL in production contract test")
    previous_events = [json.loads(line) for line in Path(os.environ["CREATIVE_TEST_EVENTS"]).read_text(encoding="utf-8").splitlines()]
    previous_posts = [event for event in previous_events if event.get("method") == "POST"]
    key_id = None if isinstance(request, str) else "first" if request.get_header("Authorization") == "Bearer dummy-first" else "second"
    record({"method": method, "url": url, "key_id": key_id})
    if mode == "timeout":
        raise TimeoutError("dummy secret must not enter output")
    if mode == "auth" and not previous_posts:
        raise urllib.error.HTTPError(url, 401, "rejected", {}, io.BytesIO(b'{"error":{"message":"dummy secret"}}'))
    if mode == "auth" and previous_posts[-1]["key_id"] == key_id:
        raise RuntimeError("credential failover reused the rejected key")
    if mode in {"poll-auth", "download-auth"} and method == "GET":
        raise urllib.error.HTTPError(url, 403, "rejected", {}, io.BytesIO(b"{}"))
    if url.endswith("/videos"):
        body = json.loads(request.data)
        record({
            "video": {field: body[field] for field in ("model", "mode", "seconds", "size", "aspect_ratio")},
            "reference_images": len(body.get("images", [])),
        })
        return response({"video_id": "fixture-video"})
    if "/agnesapi?" in url:
        if "CREATIVE_TEST_VIDEO_RESPONSES" in os.environ:
            polls = [event for event in previous_events if "/agnesapi?" in event.get("url", "")]
            documents = json.loads(os.environ["CREATIVE_TEST_VIDEO_RESPONSES"])
            document = documents[min(len(polls), len(documents) - 1)]
            if "http_error" in document:
                raise urllib.error.HTTPError(url, document["http_error"], "rejected", {}, io.BytesIO(b"{}"))
            if document.get("network_timeout"):
                raise TimeoutError("dummy secret must not enter output")
            return response(document)
        return response({"status": "completed", "metadata": {"url": "https://provider.invalid/video.mp4"}})
    if url.endswith("/video.mp4"):
        result = io.BytesIO(b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42")
        result.headers = {}
        return result
    if mode == "download-auth":
        return response({"data": [{"url": "https://provider.invalid/media.png"}]})
    content = b"invalid media" if mode == "invalid-media" else b"\x89PNG\r\n\x1a\nfixture-image"
    return response({"data": [{"b64_json": base64.b64encode(content).decode("ascii")}]})


urllib.request.urlopen = offline_urlopen
original_json_load = json.load


def capture_adapter_input(handle, *args, **kwargs):
    document = original_json_load(handle, *args, **kwargs)
    if isinstance(document, dict) and "project_root" in document:
        snapshot = Path(document["project_root"])
        project = Path(os.environ["CREATIVE_TEST_PROJECT"])
        if os.environ["CREATIVE_TEST_MODE"] == "snapshot":
            (project / "input.txt").write_text("changed during production", encoding="utf-8")
        record({
            "snapshot": snapshot != project,
            "source": (snapshot / "input.txt").read_text(encoding="utf-8"),
            "run_id": document["run_id"],
        })
        if "CREATIVE_TEST_VIDEO_RESPONSES" in os.environ:
            # Only the adapter clock advances; the parent still owns real child deadlines.
            clock = [0.0]

            def advance(seconds):
                record({"poll_wait": seconds})
                clock[0] += seconds

            time.monotonic = lambda: clock[0]
            time.sleep = advance
    return document


json.load = capture_adapter_input
