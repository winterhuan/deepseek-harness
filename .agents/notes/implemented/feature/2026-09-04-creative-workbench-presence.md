# Agent Note: Creative workbench claims layout only with creative work

Status: implemented

English | [中文](2026-09-04-creative-workbench-presence.zh.md)

## Problem

Installing the creative plugin turned every Session into a writing surface: `CreativeWorkbench` rendered its split surface unconditionally (even an empty file tree with a "no novel files yet" notice), and the stylesheet rewrites any conversation scroll host containing that surface into the three-column grid. Writing code, reading a plain answer, in a workspace with nothing creative — the official Chat was squeezed with no way out and no collapse control. The same defect class was fixed next door in `zenstory-ai/oh-story-dsh#30`; this change ports its three acceptance criteria to the in-process workbench.

## Decision

**Presence gates mounting.** `src/client/workbench-presence.ts` owns the pure decision: `hasCreativeProject` is true for story/drama files, workspace game projects, or video projects (the bundled game example never counts), `resolveWorkbenchOpen` lets an explicit choice win over auto-detection, and the choice persists per workspace in `localStorage` because the DSH Session Store is not persisted. All reads tolerate blocked site data. The bridge hoists the workspace request and computes `open` in the same render that learns the workspace, so a collapsed workbench never flashes the layout open.

**Closed means unmounted.** The workbench returns `null` with neither creative work nor a workspace error, and otherwise a launcher-only surface carrying `data-open="false"`. Every layout-takeover selector now requires `.creative-split-surface[data-open="true"]`, so collapsing unmounts the grid by construction; the collapsed bridge publishes only the conversation column's corner geometry for the floating launcher. File-link capture, Chat DOM rewriting, and the save shortcut stay mounted only while open (the dirty-buffer `beforeunload` guard intentionally stays global: it is invisible until unload).

**Every workbench collapses.** The story/drama brand header, the game toolbar, and the video toolbar each gained a collapse control writing the `closed` preference; the launcher writes `open`. Game/Video lazy mounting is unchanged.

## Alternatives considered

**A global visibility toggle in settings.** Rejected: the correct default differs per workspace (a novel workspace wants the workbench; a code checkout does not), so a global switch answers the wrong question. Per-workspace memory with an explicit override covers both.

**Hiding with CSS while keeping the surface mounted.** Rejected: the observers, listeners, and workspace polling would keep running behind an invisible panel, and the `:has()` selectors would need a parallel gating vocabulary. Unmounting makes "closed" structural rather than cosmetic.

## Consequences

- `src/client/workbench-presence.ts` is fully covered by `tests/workbench-presence.client.spec.ts`; the assembled behavior is pinned by the keyless `snapshots/web/workbench-presence` scenario (`workbench-presence.e2e.ts` over `workbench-presence.overlay.yml`): native conversation on an empty workspace, takeover on the first Agent-written file in the same session, collapse back, preference surviving reload, plus the `workspace.expected` tree oracle.
- Non-creative sessions render zero creative DOM and issue no workspace-driven listeners; the first creative file an Agent writes hands the layout over inside the same session.
- READMEs document the presence rule; `test:web` replay must stay green because it owns the assembled conversation output.
