# Agent Note: Knowledge divergence governance

Status: implemented

English | [中文](2026-09-05-knowledge-divergence-governance.zh.md)

## Problem

Creative `knowledge/` trees are pinned upstream snapshots, but product work modifies them (`production_tool.py` confirm fix) and adds beside them (`agnes_adapters.py`, `export_novel_txt.py`, `record_lineage.py`). A pin that forbids modification blocks the work; deleting the manifests destroys provenance. No gate ever verified the hashes — they were bookkeeping — so the replacement must stay bookkeeping, not grow a checker, spec, and CI surface for four ledger files.

## Decision

**`files[]` stays the upstream record, untouched. `divergence` records only what differs**: `forked` paths (modified, with `reason` and owning note) and `added` paths (DSH-authored, with `reason`). No duplicated hashes — git already versions content, and the upstream pin lives in `files[]`.

**To modify a skill**: edit the file, move its path into the matching `divergence` bucket with a reason. Review owns enforcement: the manifest diff sits in the same PR as the skill edit. No gate, no spec, no sync procedure beyond reading the entry.

## Alternatives considered

**Checker script plus doc-sync gate.** Rejected as disproportionate: it guards against forgetting a five-line manifest edit that code review sees anyway, at the cost of a script, a spec, and CI surface nobody asked to maintain.

**Fork whole trees on first modification.** Rejected: it would declare hundreds of untouched files owned, making future upstream syncs a full re-review instead of a per-entry question.

## Consequences

- Four manifests carry `governance` plus mostly-empty `divergence` maps; current entries: one forked file, three added files.
- Future upstream syncs diff `files[]` against the new upstream and re-ask each `divergence` entry: keep, port, or retire.
