#!/usr/bin/env python3
"""Export a sharded story workspace into one citable novel text.

`short-drama-novel-analyze` and `novel-game-analyze` read a single 原著.txt
plus the index they build over it, while the story pipeline writes one file
per chapter under 正文/. Hand-concatenating chapters drops chapter boundaries
and breaks every span the analysis cites. This script emits 原著.txt with one
chapter per file in numeric order plus 章节映射.json, whose zero-based
[start, end) line spans map every emitted line back to its chapter file, so an
analysis span always resolves to a source file and hash.

Only the canonical long-form layout is accepted: every 正文/*.md file name
must open with 第<arabic>章, duplicate numbers fail, and each file's first
non-empty line must open a chapter heading, so the emitted headings are
exactly what novel_index.py slices on. Anything else fails loud with the file
named instead of silently merging prose into the wrong chapter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

CHAPTER_FILE_RE = re.compile(r"^第(\d+)章")
# A short standalone chapter heading, mirroring the novel_index.py contract:
# leading whitespace allowed, then 第 plus a number. Non-Arabic numerals pass
# through unchecked here; the indexer itself validates numbering runs.
HEADING_RE = re.compile(r"^[ \t　]*第")
ARABIC_HEADING_RE = re.compile(r"^[ \t　]*第\s*([0-9]+)")

MAP_VERSION = 1
MINIMUM_PYTHON = (3, 9)
if sys.version_info < MINIMUM_PYTHON:
    raise SystemExit("export_novel_txt.py requires Python 3.9 or newer")


def _read_chapter(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"cannot read chapter file: {path.name}") from exc
    return text.replace("\r\n", "\n").split("\n")


def _collect_chapters(story_root: Path) -> list[tuple[int, Path]]:
    text_root = story_root / "正文"
    if not text_root.is_dir():
        raise ValueError(f"story workspace has no 正文/ directory: {story_root}")
    numbered: dict[int, Path] = {}
    unmatched: list[str] = []
    skipped: list[str] = []
    for entry in sorted(text_root.iterdir(), key=lambda item: item.name):
        if entry.is_dir():
            skipped.append(entry.name + "/")
            continue
        if entry.suffix.casefold() != ".md":
            skipped.append(entry.name)
            continue
        # Fullwidth digits fold to ASCII so 手写稿 numbering still matches.
        match = CHAPTER_FILE_RE.match(unicodedata.normalize("NFKC", entry.name))
        if match is None:
            unmatched.append(entry.name)
            continue
        number = int(match.group(1))
        if number in numbered:
            raise ValueError(
                f"duplicate chapter number {number}: "
                f"{numbered[number].name} and {entry.name}"
            )
        numbered[number] = entry
    if unmatched:
        raise ValueError(
            "story workspace has non-chapter files that would merge "
            f"into the wrong span: {', '.join(unmatched)}; move them aside "
            "or rename them to 第NNN章"
        )
    if skipped:
        raise ValueError(
            "story workspace has non-text entries the export would silently "
            f"drop, breaking coverage: {', '.join(skipped)}"
        )
    return [(number, numbered[number]) for number in sorted(numbered)]


def export_novel(story_root: Path, out_dir: Path) -> dict[str, object]:
    chapters = _collect_chapters(story_root)
    if not chapters:
        raise ValueError(f"story workspace has no numbered chapters: {story_root}")
    emitted: list[str] = []
    records: list[dict[str, object]] = []
    for position, (number, path) in enumerate(chapters, 1):
        lines = _read_chapter(path)
        first = next((line for line in lines if line.strip()), "")
        if not HEADING_RE.match(first):
            raise ValueError(
                f"{path.name} does not open with a chapter heading; "
                "the indexer would merge it into the previous chapter"
            )
        arabic = ARABIC_HEADING_RE.match(first)
        if arabic is not None and int(arabic.group(1)) != number:
            raise ValueError(
                f"{path.name} opens with a different chapter number; "
                "rename the file or fix the heading"
            )
        block = "\n".join(lines).rstrip("\n") + "\n"
        start = len(emitted)
        emitted.extend(block.split("\n")[:-1])
        end = len(emitted)
        if position < len(chapters):
            emitted.append("")
        records.append({
            "index": position,
            "number": number,
            "title": path.stem,
            "file": f"正文/{path.name}",
            "start_line": start,
            "end_line": end,
            "sha256": hashlib.sha256(block.encode("utf-8")).hexdigest(),
        })
    novel_text = "\n".join(emitted) + "\n"
    mapping = {
        "map_version": MAP_VERSION,
        "line_unit": "zero_based_end_exclusive",
        "novel_file": "原著.txt",
        "chapters": records,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    novel_path = out_dir / "原著.txt"
    map_path = out_dir / "章节映射.json"
    for target, content in (
        (novel_path, novel_text),
        (map_path, json.dumps(mapping, ensure_ascii=False, indent=2) + "\n"),
    ):
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, target)
    return {
        "chapters": len(records),
        "lines": len(emitted),
        "novel": str(novel_path),
        "map": str(map_path),
    }


def _selftest() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "book"
        text_root = root / "正文"
        text_root.mkdir(parents=True)
        (text_root / "第001章_开篇.md").write_text(
            "第1章 开篇\n\n　　春天来了。\n", encoding="utf-8"
        )
        (text_root / "第002章_转折.md").write_text(
            "第2章 转折\n\n　　雨停了。\n\n　　他出门了。\n", encoding="utf-8"
        )
        out = Path(raw) / "out"
        summary = export_novel(root, out)
        if summary["chapters"] != 2:
            raise RuntimeError("export self-test chapter count failed")
        novel_lines = (out / "原著.txt").read_text(encoding="utf-8").split("\n")
        mapping = json.loads((out / "章节映射.json").read_text(encoding="utf-8"))
        if mapping["map_version"] != MAP_VERSION:
            raise RuntimeError("export self-test map version failed")
        if len(mapping["chapters"]) != 2:
            raise RuntimeError("export self-test map chapter count failed")
        for record in mapping["chapters"]:
            block = "\n".join(novel_lines[record["start_line"]:record["end_line"]])
            digest = hashlib.sha256((block + "\n").encode("utf-8")).hexdigest()
            if digest != record["sha256"]:
                raise RuntimeError("export self-test span reconstruction failed")
            first = next(line for line in block.split("\n") if line.strip())
            if not HEADING_RE.match(first):
                raise RuntimeError("export self-test heading contract failed")
        wide = Path(raw) / "wide"
        (wide / "正文").mkdir(parents=True)
        (wide / "正文" / "第００１章_开篇.md").write_text("第1章 开篇\n\n　　春。\n", encoding="utf-8")
        wide_summary = export_novel(wide, Path(raw) / "out-wide")
        if wide_summary["chapters"] != 1:
            raise RuntimeError("export self-test fullwidth digits failed")
        for bad in ("duplicates", "unmatched", "bad-heading", "renumbered", "stray-file", "stray-dir"):
            case = Path(raw) / f"bad-{bad}"
            (case / "正文").mkdir(parents=True)
            if bad == "duplicates":
                (case / "正文" / "第001章_a.md").write_text("第1章 a\n\n　　甲。\n", encoding="utf-8")
                (case / "正文" / "第001章_b.md").write_text("第1章 b\n\n　　乙。\n", encoding="utf-8")
            elif bad == "unmatched":
                (case / "正文" / "楔子.md").write_text("楔子\n\n　　前情。\n", encoding="utf-8")
            elif bad == "bad-heading":
                (case / "正文" / "第001章_x.md").write_text("很久很久以前。\n", encoding="utf-8")
            elif bad == "stray-file":
                (case / "正文" / "第001章_x.md").write_text("第1章 x\n\n　　正文。\n", encoding="utf-8")
                (case / "正文" / "草稿.txt").write_text("草稿。\n", encoding="utf-8")
            elif bad == "stray-dir":
                (case / "正文" / "第001章_x.md").write_text("第1章 x\n\n　　正文。\n", encoding="utf-8")
                (case / "正文" / "废稿").mkdir()
            else:
                (case / "正文" / "第003章_x.md").write_text("第5章 x\n\n　　错位。\n", encoding="utf-8")
            try:
                export_novel(case, Path(raw) / f"out-{bad}")
            except ValueError:
                pass
            else:
                raise AssertionError(f"invalid story workspace was accepted: {bad}")
    # Cross-check against the real indexer when the sibling tree is present.
    sibling = (
        Path(__file__).resolve().parent.parent.parent.parent.parent
        / "drama/skills/short-drama-novel-analyze/scripts/novel_index.py"
    )
    if sibling.is_file():
        print(f"indexer cross-check available: {sibling}")
    else:
        print("indexer cross-check skipped: sibling novel_index.py not found")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--story-root", required=False, default=None)
    parser.add_argument("--out-dir", required=False, default=None)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest:
        _selftest()
        print("export_novel_txt self-test passed")
        return 0
    if args.story_root is None or args.out_dir is None:
        parser.error("--story-root and --out-dir are required without --selftest")
    try:
        summary = export_novel(Path(args.story_root), Path(args.out_dir))
    except ValueError as exc:
        print(f"export_novel_txt failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"exported {summary['chapters']} chapters, "
        f"{summary['lines']} lines -> {summary['novel']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
