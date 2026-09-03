# Agent Note: Short-drama SHOT- image jobs pass prepare but fail confirm

Status: implemented

English | [中文](2026-09-04-short-drama-shot-confirm.zh.md)

## Problem

A storyboard frozen keyframe (`SHOT-*` in `分镜.md`) bound to an image job passed `production_tool.py prepare` but failed `confirm` with `stored job source entry has the wrong modality`. Prepare resolves the entry prefix per document from `CREATOR_SOURCE_ENTRIES` (分镜.md yields `SHOT-`, and the storyboard-to-image mapping exists precisely so a video's start frame has a stage that can render it). Confirm instead resolved the prefix per modality from a hardcoded `{"image": "IMG-", "video": "MOTION-"}` table that predates the storyboard mapping, so every legitimate storyboard image job died at the pay gate — the worst place to discover a validation bug, and after the creator had already approved the job.

## Decision

**Mirror prepare's per-document lookup in confirm.** The three-line literal became the same `CREATOR_SOURCE_ENTRIES[document][0]` lookup prepare uses, including its same-modality condition, so both gates enforce one rule. A six-case matrix (SHOT/IMG/MOTION × image/video, pass and reject sides) plus a real `prepare` → `confirm` run on a storyboard image job lock the behavior: previously prepared SHOT- jobs confirm without re-preparing, while cross-modality bindings (MOTION entry on an image job, SHOT entry on a video job) keep failing with the same error.

**Record the patch in the manifest, not beside it.** `production_tool.py` is upstream-pinned, so the manifest's `sha256`/`bytes` entry was recomputed for the patched file and the rationale lives here — the same logged-local-modification story the tree already uses for vendored sources. The patch is three semantic lines against prepare's own table, so a future upstream sync re-applies or retires it cleanly. The Skill bridge notes that SHOT- storyboard entries are valid image sources at confirm time.

## Alternatives considered

**Author the image job against 图片提示词.md instead.** Rejected as the standing answer: copying a frozen keyframe prompt into a second document creates a parallel truth the review pass exists to flag, and it severs the SHOT- traceability the storyboard stage owns. It remains a valid manual workaround for a single blocked job, not a fix.

**Route confirm through a companion shim.** Rejected: the predicate is an inline literal, not a module constant, so a shim would need whole-function copies with swapped globals — unreviewable cleverness that breaks silently on the next upstream sync, exactly what the pin exists to prevent.

**Skip confirm for SHOT- image jobs.** Rejected: confirm is the paid-production gate; bypassing it for one shape of job removes the creator's last checkpoint before spend.

## Consequences

- `knowledge/drama/.../short-drama-produce/scripts/production_tool.py` carries a logged three-line local modification; its manifest entry matches the patched bytes.
- `short-drama-produce` bridge copy documents SHOT- confirm acceptance; no Host, card, or adapter code changed.
- Verification is a recorded six-case matrix plus the prepare→confirm run in this change's history, not a committed suite: the file is upstream-owned data with no executed gate, and a companion test file would rot against upstream syncs.
