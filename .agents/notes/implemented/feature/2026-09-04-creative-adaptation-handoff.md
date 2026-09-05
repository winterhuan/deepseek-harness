# Agent Note: Cross-domain adaptation handoff (novel to drama, game, and video)

Status: implemented

English | [中文](2026-09-04-creative-adaptation-handoff.zh.md)

## Problem

Each creative domain worked end to end, but the four domains were islands: the Skill bridges contained zero cross-domain routing, the story entry skill routed only within its thirteen novel skills, and each pipeline expected a different input shape. `short-drama-novel-analyze` wants one raw `原著.txt` while the story pipeline writes one file per chapter; `video-understanding` takes raw media files and knows nothing of `剧集/<EP>/制作成果/`; game intake is novel-centric with no path from drama documents. An agent could improvise every handoff, dropping chapter boundaries, style profiles, and provenance along the way — and the one handoff the bridges did imply (drama documents into game intake) is a false friend: screenplay density cannot support system design.

## Decision

**Route in bridge copy, four sentences.** The story entry lists the three exits (drama via the export package, game via `novel-game-analyze`, recap via `sources/`); `story-import` names the exporter; a new `short-drama-novel-analyze` override names the export package as its only intake; the video bridge adopts the `制作成果/`-to-`sources/` copy convention; the game bridge closes drama intake explicitly. Copy is the cheapest router and the only layer all four pipelines already read.

**Export sharded chapters without re-slicing them.** `story-import/scripts/export_novel_txt.py` concatenates `正文/第NNN章.md` in numeric order into `原著.txt` verbatim plus `章节映射.json` (zero-based `[start, end)` line spans, per-chapter sha256, source files). Novel analysis demands byte-citable spans ("no bytes, no span"), so the map — not the text — is the deliverable that matters: any analysis span resolves to a chapter file and hash. Strictness is deliberate: duplicate numbers, non-chapter files, missing headings, and heading/file number mismatches all fail loud naming the file, because silently merging prose into the wrong chapter corrupts citations. Verified end to end: 20 exported chapters index as exactly 20 chapters with zero problems in the real `novel_index.py`.

**Keep the adaptation ledger out of `SOURCE_BIBLE`.** Cross-domain lineage (which novel chapters, which adaptation decisions, which pooling) is a DSH-owned append-only record — `改编谱系.jsonl` at the workspace root, one entry per adaptation edge with source fingerprints — recorded by the adapting agent at intake via `story-import/scripts/record_lineage.py`. Sources hash as files (sha256 of bytes) or directories (sha256 of the sorted path-hash listing), so a novel export package, a drama episode directory, or a single media file are all citable; targets are project addresses that may not exist yet, and empty decisions are legal for pure delivery copies (the edge itself is the drama-to-video handshake). `SOURCE_BIBLE` stays pipeline-internal and immutable: its "downstream never silently rewrites" guarantee carries game QA evidence chains, and bolting lineage onto it would weaken exactly that.

**No drama-to-game path, stated plainly.** Same-IP dual adaptation shares the novel upstream, not the drama. The game bridge says so instead of leaving the model to discover it through failed intake.

## Alternatives considered

**Teach `novel_index.py` to read sharded workspaces.** Rejected: it is an upstream-pinned file whose span model assumes one input file; the exporter keeps upstream byte-identical while satisfying the citability contract from our side.

**Pass style profiles and tracking state through the export.** Rejected for now: no confirmed consumer — `novel-analyze` builds its own index and judgments from the text. The exporter stays two artifacts (`原著.txt` plus the map); add passthrough only behind a named consumer.

**Non-numeric chapters (楔子/番外) by position guessing.** Rejected: inventing chapter numbers corrupts the same citations the map exists to protect. The exporter errors naming the files; a future version can accept an explicit order manifest.

## Consequences

- `story-import/scripts/export_novel_txt.py` is new (upstream files untouched) with `--selftest` covering span reconstruction plus four loud-failure cases; the sibling-indexer cross-check runs when the drama tree is present.
- Bridge routing sentences are pinned by `skill-provider.spec.ts` per-domain assertions; the short-story direct-read qualification keeps single-file workspaces out of the export path.
- `record_lineage.py` ships with `--selftest` (round-trip plus six loud-failure cases); follow-ups are now only: explicit order manifest for non-numeric chapters, and style-profile passthrough behind a consumer.
