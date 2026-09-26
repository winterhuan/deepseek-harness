# Agent Note: Short-drama production consistency and result ownership

Status: proposed

English | [中文](2026-09-22-short-drama-production-consistency.zh.md)

## Problem

The Creative short-drama workbench spans creator-document parsing, workspace reads, production preparation, background jobs, and output discovery. The current implementation has no single consistency point across those layers. The workbench can submit preparation while protocol diagnostics contain errors; it reads the five creator documents through independent requests; it reconstructs media ownership from output-path tokens; and the TypeScript projection parser and Python creator checker encode overlapping but different document rules.

The result is avoidable uncertainty rather than only extra code: malformed documents can reach preparation, edits can produce a mixed- revision projection, renamed outputs can attach to the wrong target, and a document accepted by the workbench can still fail the creator checker. Visual entries without explicit IDs also derive IDs from titles, so a title edit can invalidate selections, canvas positions, references, and media associations.

## Proposal

### Block production on protocol errors

Treat an error-severity `DramaProductionDiagnostic` as a precondition for single-item production, batch preparation, and final composition. The workbench keeps warnings visible but disables operations that require a valid creator-document protocol. Add Client tests proving that each blocked action makes no submission and that warnings alone do not block it.

### Read one episode consistently

Add an episode-level read operation that returns the five creator documents, their file versions, and a read-batch revision. The workbench uses that result for `parseEpisodeProduction()` instead of issuing independent file requests from [workbench.tsx](../../../../packages/creative/creative/src/client/workbench.tsx). The operation must preserve dirty buffers and surface a conflict when a document changes during the read; it must not silently combine revisions from separate reads.

### Make output ownership explicit

Write a current production manifest for every published media result. Each entry records the target ID, production request ID, framework job identity when available, media kind, workspace path, and content digest. The workbench reads this manifest as the authoritative association. Path-token matching remains only a diagnostic for untracked files and never assigns a tracked result by itself.

### Give the document protocol one executable owner

Define the shared short-drama document fixture set for IDs, fields, references, visual coverage, and malformed headings. Run both the TypeScript projection tests and `creator_markdown_check.py` against that set. Either move the shared structural parser to one generated or language-neutral representation, or make the Client projection consume the Python checker’s structured diagnostics while retaining only the display projection in TypeScript. The accepted behavior must state which checks are structural blockers and which remain review-only.

### Require stable visual IDs

Require explicit `VISUAL-*` IDs for production-relevant visual entries. A missing or invalid ID remains a diagnostic and does not create a production target. Do not derive persistent target identity from a mutable title; existing presentation-only title slugs may remain in non-production displays.

## Alternatives considered

**Keep the current permissive UI and rely on `short-drama-produce` to reject invalid jobs.** Rejected: the creator receives a late model-visible preparation failure, while the workbench already has the diagnostics and can prevent an invalid request before it enters the Session.

**Continue reading individual files and reconcile the latest result.** Rejected: independent versions can form a document set that never existed on disk, and latest-result selection cannot prove cross-document consistency.

**Keep path matching and improve its regular expressions.** Rejected: regular expressions cannot preserve ownership after a rename or distinguish two valid results whose paths share target tokens. The production operation already knows the target and request identity; the manifest should retain that fact.

**Copy the Python checker into TypeScript or copy the TypeScript parser into Python.** Rejected: duplication preserves the drift that caused the problem. Shared fixtures and an explicit ownership decision are required before either implementation grows.

**Generate visual IDs from title plus content hash.** Rejected: content-derived IDs still change when a creator intentionally edits the entry, and they hide the missing creator-owned identity. A stable explicit ID is clearer and is already the protocol vocabulary.

## Acceptance criteria

- Production, batch, and composition controls refuse protocol errors before `beginSubmission()`; warnings remain actionable without blocking.
- An episode projection is built from one read revision, and a concurrent edit produces a visible conflict or retry rather than mixed documents.
- Published media results carry an explicit manifest association and digest; tracked workbench versions never depend on filename heuristics.
- Shared fixtures cover valid and invalid structural cases consumed by both the TypeScript and Python checks, including duplicate IDs, unknown references, malformed headings, missing visual IDs, and reference syntax.
- A visual entry without a valid `VISUAL-*` ID cannot become a production target, and title edits do not silently change an existing target ID.
- Client, production-tool, short-drama selftests, snapshot, and documentation checks cover the changed behavior.

## Risks

The manifest adds a project artifact and requires output publication to remain atomic with its metadata; incomplete publication must produce an unavailable result rather than a partially associated one. Episode-level reads may increase response size and need bounded document bytes. Requiring visual IDs makes creator documents stricter and requires explicit authoring guidance. A shared fixture set does not by itself make the two parsers equivalent; the owning checks must still declare which layer enforces each rule.
