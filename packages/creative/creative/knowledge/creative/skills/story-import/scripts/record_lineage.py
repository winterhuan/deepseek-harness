#!/usr/bin/env python3
"""Append one cross-domain adaptation edge to the workspace lineage ledger.

Novel, drama, game, and video pipelines each keep their own canon (author
memory, serial memory, SOURCE_BIBLE, background research), so without a shared
record nobody can answer "which novel chapters did this episode adapt, and who
merged whom". The ledger lives at the workspace root as 改编谱系.jsonl, one
JSON object per line, append-only: the adapting agent records one edge at
intake, with a fingerprint of the source as it was read. A later review
recomputes the fingerprint instead of trusting prose.

Source fingerprints cover files (sha256 of bytes) and directories (sha256 of
the sorted "relative-path:sha256" listing), so a drama episode directory or a
novel export package is citable as one hash. Fingerprint a directory before
recording edges into it: the ledger file itself lives under the workspace
root, so hashing afterwards would fold prior edges into the new fingerprint
and it could never be recomputed. Symlinked entries fail instead of being
silently omitted, for the same reason. Targets are project addresses that may not exist yet at intake time. Decisions may be empty for pure
delivery copies (e.g. drama media into recap sources); the edge itself is the
delivery handshake there.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DOMAINS = ("novel", "drama", "game", "video", "media")
SCHEMA_VERSION = 1
LEDGER_NAME = "改编谱系.jsonl"
MAX_HASH_BYTES = 256 * 1024 * 1024
MINIMUM_PYTHON = (3, 9)
if sys.version_info < MINIMUM_PYTHON:
    raise SystemExit("record_lineage.py requires Python 3.9 or newer")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _relative_to_root(workspace_root: Path, raw: str, *, must_exist: bool) -> Path:
    candidate = Path(raw)
    resolved = (workspace_root / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
    try:
        relative = resolved.relative_to(workspace_root.resolve())
    except ValueError as exc:
        raise ValueError(f"lineage path escapes the workspace: {raw}") from exc
    if ".." in relative.parts:
        raise ValueError(f"lineage path escapes the workspace: {raw}")
    if must_exist and not resolved.exists():
        raise ValueError(f"lineage source does not exist: {raw}")
    return resolved


def fingerprint(path: Path) -> str:
    """Hash one workspace file or directory for an edge source."""
    if path.is_symlink() or not path.exists():
        raise ValueError(f"lineage source is missing: {path}")
    if path.is_file():
        try:
            content = path.read_bytes()
        except OSError as exc:
            raise ValueError(f"lineage source is unreadable: {path}") from exc
        return hashlib.sha256(content).hexdigest()
    if not path.is_dir():
        raise ValueError(f"lineage source is not a file or directory: {path}")
    entries: list[str] = []
    total = 0
    for child in sorted(path.rglob("*")):
        if child.is_symlink():
            raise ValueError(f"lineage source contains a symlink: {child}")
        if not child.is_file():
            continue
        try:
            content = child.read_bytes()
        except OSError as exc:
            raise ValueError(f"lineage source is unreadable: {child}") from exc
        total += len(content)
        if total > MAX_HASH_BYTES:
            raise ValueError(f"lineage source exceeds the hash budget: {path}")
        entries.append(f"{child.relative_to(path).as_posix()}:{hashlib.sha256(content).hexdigest()}")
    return hashlib.sha256(("\n".join(entries) + "\n").encode("utf-8")).hexdigest()


def record_edge(
    workspace_root: Path,
    *,
    from_domain: str,
    from_path: str,
    to_domain: str,
    to_path: str,
    decisions: list[str] | tuple[str, ...] = (),
    by: str = "agent",
    ledger_name: str = LEDGER_NAME,
) -> dict[str, Any]:
    """Append one adaptation edge and return it."""
    if not workspace_root.is_dir():
        raise ValueError(f"workspace root is not a directory: {workspace_root}")
    if from_domain not in DOMAINS:
        raise ValueError(f"lineage source domain must be one of {', '.join(DOMAINS)}")
    if to_domain not in DOMAINS:
        raise ValueError(f"lineage target domain must be one of {', '.join(DOMAINS)}")
    for decision in decisions:
        if not isinstance(decision, str) or not decision.strip():
            raise ValueError("lineage decisions must be non-empty strings")
    if not isinstance(by, str) or not by.strip():
        raise ValueError("lineage author must be a non-empty string")
    root = workspace_root.resolve()
    source = _relative_to_root(root, from_path, must_exist=True)
    target_raw = to_path.replace("\\", "/")
    if (
        not target_raw
        or target_raw in (".", "./")
        or target_raw.startswith("/")
        or ".." in Path(target_raw).parts
    ):
        raise ValueError(f"lineage target must be a workspace-relative path: {to_path}")
    entry: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "at": _utc_now(),
        "from": {
            "domain": from_domain,
            "path": source.relative_to(root).as_posix(),
            "sha256": fingerprint(source),
        },
        "to": {"domain": to_domain, "path": target_raw},
        "decisions": list(decisions),
        "by": by.strip(),
    }
    ledger = root / ledger_name
    with ledger.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def _selftest() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "ip"
        (root / "正文").mkdir(parents=True)
        (root / "正文" / "第001章.md").write_text("第1章\n\n　　春。\n", encoding="utf-8")
        episode = root / "剧集" / "EP001"
        (episode / "制作成果").mkdir(parents=True)
        (episode / "剧本.md").write_text("# EP001\n", encoding="utf-8")
        (episode / "制作成果" / "SHOT-001.png").write_bytes(b"\x89PNG\r\n\x1a\nfakepng")
        first = record_edge(
            root,
            from_domain="novel",
            from_path="正文/第001章.md",
            to_domain="drama",
            to_path="剧集/EP001",
            decisions=["合并人物甲/乙", "EP001覆盖第1章"],
        )
        if first["from"]["sha256"] != fingerprint(root / "正文/第001章.md"):
            raise RuntimeError("lineage self-test source fingerprint failed")
        second = record_edge(
            root,
            from_domain="drama",
            from_path="剧集/EP001/制作成果/SHOT-001.png",
            to_domain="video",
            to_path="video-recaps/demo/sources/SHOT-001.png",
            decisions=[],
        )
        if second["to"]["path"] != "video-recaps/demo/sources/SHOT-001.png":
            raise RuntimeError("lineage self-test delivery edge failed")
        lines = (root / LEDGER_NAME).read_text(encoding="utf-8").split("\n")
        stored = [json.loads(line) for line in lines if line.strip()]
        if len(stored) != 2 or stored[0]["schema_version"] != SCHEMA_VERSION:
            raise RuntimeError("lineage self-test ledger append failed")
        if stored[1]["from"] != second["from"] or stored[1]["decisions"] != []:
            raise RuntimeError("lineage self-test ledger round-trip failed")
        bad_calls: list[dict[str, Any]] = [
            {"from_domain": "opera", "from_path": "正文/第001章.md", "to_domain": "drama", "to_path": "剧集/EP001"},
            {"from_domain": "novel", "from_path": "正文/缺失.md", "to_domain": "drama", "to_path": "剧集/EP001"},
            {"from_domain": "novel", "from_path": "../escape.md", "to_domain": "drama", "to_path": "剧集/EP001"},
            {"from_domain": "novel", "from_path": "正文/第001章.md", "to_domain": "drama", "to_path": "/abs/path"},
            {"from_domain": "novel", "from_path": "正文/第001章.md", "to_domain": "drama", "to_path": "."},
            {"from_domain": "novel", "from_path": "正文/第001章.md", "to_domain": "drama", "to_path": "剧集/EP001", "decisions": ["  "]},
        ]
        for kwargs in bad_calls:
            try:
                record_edge(root, **kwargs)  # type: ignore[arg-type]
            except ValueError:
                pass
            else:
                raise AssertionError(f"invalid lineage edge was accepted: {kwargs}")
        try:
            record_edge(Path(raw) / "missing-root", from_domain="novel",
                        from_path="x.md", to_domain="drama", to_path="剧集/EP001")
        except ValueError:
            pass
        else:
            raise AssertionError("lineage edge into a missing workspace was accepted")
        linked = Path(raw) / "linked"
        (linked / "正文").mkdir(parents=True)
        (linked / "正文" / "第001章.md").write_text("第1章\n\n　　春。\n", encoding="utf-8")
        os.symlink("第001章.md", linked / "正文" / "别名.md")
        try:
            fingerprint(linked / "正文")
        except ValueError:
            pass
        else:
            raise AssertionError("lineage fingerprint silently omitted a symlink")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-root", required=False, default=None)
    parser.add_argument("--from-domain", required=False, default=None)
    parser.add_argument("--from-path", required=False, default=None)
    parser.add_argument("--to-domain", required=False, default=None)
    parser.add_argument("--to-path", required=False, default=None)
    parser.add_argument("--decision", action="append", default=[])
    parser.add_argument("--by", default="agent")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest:
        _selftest()
        print("record_lineage self-test passed")
        return 0
    missing = [name for name in ("workspace_root", "from_domain", "from_path", "to_domain", "to_path")
               if getattr(args, name) is None]
    if missing:
        parser.error(f"missing required options: {', '.join('--' + name.replace('_', '-') for name in missing)}")
    try:
        entry = record_edge(
            Path(args.workspace_root),
            from_domain=args.from_domain,
            from_path=args.from_path,
            to_domain=args.to_domain,
            to_path=args.to_path,
            decisions=args.decision,
            by=args.by,
        )
    except ValueError as exc:
        print(f"record_lineage failed: {exc}", file=sys.stderr)
        return 1
    from_entry = entry["from"]
    print(f"recorded {from_entry} -> {entry['to']} in {LEDGER_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
