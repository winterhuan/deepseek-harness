# Agent Note: Harden and simplify the creative branch

Status: proposed

English | [中文](2026-09-26-creative-branch-hardening.zh.md)

## Problem

The `creative` branch carries nine commits on top of upstream `master` (~950 files, ~38k source lines in [`packages/creative/creative`](../../../../packages/creative/creative/) plus [`skill-viewer`](../../../../packages/skill/skill-viewer/) and [`ui-skill-viewer`](../../../../packages/client/ui-skill-viewer/)). A full review found known-red coverage debt that blocks the next upstream merge, one symptomatic runtime fix, documentation drift, dead code left by the bundled-game removal, and several correctness issues in the workbench UI. This note inventories the branch, records verified findings with evidence, and sequences the optimization work into small ordered batches. It extends the shipped [creative workbench decision](../../implemented/feature/2026-09-03-creative-workbench.md) and the [client-projection alignment](../../implemented/bug-fix/2026-09-18-align-creative-production-with-client-projections.md); it supersedes neither.

## Branch inventory

| Commit | Scope |
|---|---|
| `69d850bcfb` fix(tools) | `Symbol()` → `Symbol.for()` for the internal scheduler key so source-launched Hosts and built Loader plugins agree |
| `0c5854a0bc` feat(client) | `conversation/open-file` waterfall slot in `ui-chat`; creative intercepts file opens |
| `a4768b93f1` feat(skills) | New `skill-viewer` + `ui-skill-viewer`: session-scoped read-only skill panel |
| `3be366a74d` feat(creative) | The package itself: host tools/routes, React workbench, 660-file bundled knowledge base |
| `c92ffad26e` feat(web) | Ships creative in the Web profile and tsconfig wiring |
| `4352931d0a` test(creative) | Recorded workbench/production snapshot fixtures, host and client specs |
| `eb5ca75422` docs(creative) | Subsystem documentation and generated pairing records |
| `c74343da7c` fix(build) | `clean` removes declaration-only fixture outputs by `outDir` |
| `0662c5527c` chore(creative) | Drops the bundled game example and an unused skill |

## Implementation problems

Ordered by severity; every item was re-verified against the working tree on 2026-09-26.

1. **Coverage gate is red for creative.** The per-file 100% CI gate covers the package (it is absent from `vitest.config.ts` coverage excludes), yet no test renders `CreativeWorkspace`/`CreativeWorkbench`. Last measurement (2026-09-22): [`workbench.tsx`](../../../../packages/creative/creative/src/client/workbench.tsx) 5.58%, [`workbench-ui.ts`](../../../../packages/creative/creative/src/client/workbench-ui.ts) 23.8%, [`production-runtime.ts`](../../../../packages/creative/creative/src/client/production-runtime.ts) 89.55%. The branch policy defers the upstream merge until this is green.
2. **Drag listener leak.** [`drama-production-view.tsx`](../../../../packages/creative/creative/src/client/drama-production-view.tsx) `startDrag` registers global `pointermove`/`pointerup` and unbinds only on `pointerup`; releasing outside the window or unmounting mid-drag leaks listeners that accumulate, and the `move` closure captures the stale `canvas` prop.
3. **Scheduler fix is symptomatic.** `69d850bcfb` bridges split module instances through the global `Symbol.for` registry, punching the `@internal` key across package boundaries; its test only asserts `=== Symbol.for(...)` (tautological) and never exercises two module instances, so a real module split now passes silently.
4. **Interpreter mismatch.** [`produce-tool.ts`](../../../../packages/creative/creative/src/produce-tool.ts) hardcodes `python3` while [`workspace-route.ts`](../../../../packages/creative/creative/src/workspace-route.ts) preflight probes `python3` then `python`; on Windows without a `python3` alias preflight passes but the run fails.
5. **Documentation drift.** `session-controller` README (both languages) documents `sessions.jobsBaseline` readiness; no such field exists anywhere in source — added as prose-only by `0c5854a0bc`.
6. **Dead knowledge links.** [`knowledge/novel-to-game/README.md`](../../../../packages/creative/creative/knowledge/novel-to-game/README.md) and `README_ZH.md` still link the `examples/` directory that `0662c5527c` deleted.
7. **Two sources of truth.** [`workbench-store.ts`](../../../../packages/creative/creative/src/client/workbench-store.ts) persists `productionRequests`/`productionSequence` while [`production-intents.ts`](../../../../packages/creative/creative/src/client/production-intents.ts) rebuilds the same cards from the conversation log and `reconcileSequence` recomputes the sequence every render.
8. **Render-time heavy work and leaks.** `workbench.tsx` builds a non-memoized `JSON.stringify` read key each render and parses it back inside an effect; a `setTimeout(..., 0)` in an effect has no cleanup; `video-studio.tsx` runs two effects writing the same state; `GameDesign` double-writes initial state.
9. **Hardcoded Chinese bypassing locales.** [`production-runtime.ts`](../../../../packages/creative/creative/src/client/production-runtime.ts) error strings, a `workbench.tsx` exception, and `drama-production-view.tsx` glyphs. `GROUP_ORDER` in `workbench.tsx` names on-disk directories — those are data identifiers, not UI copy, and must be excluded from localization but annotated as such.
10. **Module-level mutable state.** `produce-tool.ts` key rotation and `workspace-route.ts` tracker/preflight cache are process-global and never cleared on plugin dispose, leaking across sessions.
11. **Preview reads skip the realpath check.** The workspace preview route in `workspace-route.ts` validates paths lexically (`contains`) but, unlike the host file route in the same file, never resolves symlinks — a symlink inside the workspace can escape the root. The game-preview `untoken` is unsigned base64url; acceptable only if documented as an accidental-access guard, not a security boundary.
12. **Minor residue.** The `'PINNED'` variant in [`game-verification.ts`](../../../../packages/creative/creative/src/game-verification.ts) lost its only producer in the game-example removal; `ui-trajectory` tests stub creative's view-target, a reverse dependency.

## Simplification opportunities

1. **Duplicate 33-field schema.** [`produce-settings.ts`](../../../../packages/creative/creative/src/produce-settings.ts) and [`produce-settings-entry.ts`](../../../../packages/creative/creative/src/produce-settings-entry.ts) each declare the same fields (one plain, one `.volatile()`); derive both from one field table to stop drift.
2. **Triple validation overlap.** `production-intent.ts`, `production-binding.ts`, and `production-context.ts` re-validate the same episode/kind/expectedOutputs fields; `track_job` validates twice per call. Merge into one parse.
3. **`workbench.tsx` is 1444 lines.** Extract `GamePreview`/`GameDesign`/`GameStudio` (~300 lines), `FileTreeNodes`, `PreviewProbe`, and the two tool views; pull file-read, agent-preview, production-input, editor-position, and navigation logic into hooks. `DramaProductionView` takes 30+ props forwarded to five boards — move to a container/presenter split.
4. **Game/Video studios are isomorphic.** `GameStudio`/`GamePreview` and `VideoStudio`/`VideoPreview` share selection, tabs, mount latches, empty states, and reload logic — extract a shared media-studio shell.
5. **Duplicated session-scope resolution.** [`skill-viewer`](../../../../packages/skill/skill-viewer/src/index.ts) `viewOf` repeats `session-controller`'s `skill-catalog` almost line for line; extract a shared helper.
6. **`ui-skill-viewer` mirrors `ui-skill`.** The controller cache layer is a hand-maintained twin (the code admits it) with a hand-written remote signature; share the cache or add a synchronization test. `SkillViewerResourceBase` duplicates `SkillResourceBase`; `userInvocable` is always true — dead field.
7. **Dead code.** Test-only `resolveProduceEnv`; unreachable tool-free branch in `role-provider.ts`; `mediaMimeTypeForPath` pure wrapper; duplicate slug validation between `gameRoot` and `videoProjectRoot`; duplicate MIME tables; a redundant default in `index.ts`; seven unreferenced locale keys.
8. **Knowledge mirrors without a generator.** 58 byte-identical file groups under `creative/knowledge/creative/story-setup/references/agent-references/` mirror four sibling skills; video-recap has 11 more. Generate at pack time or single-source them.
9. **`workspace-route.ts` mixes concerns.** 966 lines of HTTP routing, byte ranges, directory traversal, game/video projections, and preflight — split per concern.

## Proposal

Work in small sequential commits (amend + `push --force-with-lease` per branch convention), each landing green before the next starts.

**Batch 0 — Re-measure (no code change).** Re-run coverage for the creative package to refresh the red-file list; update item 1 with current numbers.

```sh
pnpm run test:coverage
```

**Batch 1 — Correctness fixes (one commit per item).**

1. Fix the drag leak: move global pointer handlers into a `useEffect`, handle `pointercancel`/`lostpointercapture`, read `canvas` from a ref. Verify with existing drama client specs.
2. Resolve the Python interpreter once using preflight's `python3` → `python` order and thread it into `produce-tool.ts`; add a unit test with a fake runner.
3. Remove the `sessions.jobsBaseline` paragraph from both session-controller READMEs (no consumer exists) and re-record the pairing sidecar; implementing the field is out of scope.
4. Fix the dead knowledge links in both `novel-to-game` READMEs and re-record the sidecar.
5. Delete dead code: the `'PINNED'` variant, test-only `resolveProduceEnv` export, the unreachable tool-free branch, the seven unused locale keys, `userInvocable`.
6. Key `produceKeyRotation` by session and clear route-level caches on plugin dispose.
7. Add the missing `realpath` containment check to preview reads; document `untoken` as an accidental-access guard in `workspace-route.ts`.

```sh
pnpm exec tsc -b tsconfig.host.json --force && pnpm exec tsc -b tsconfig.client.json --force
pnpm exec vitest run packages/creative/creative --testTimeout=30000
pnpm run test:docs
```

**Batch 2 — Single source of truth.** Make the conversation projection the only source for production requests and sequence; drop the persisted store fields with a state migration, update `sidebar.client.spec.ts`, and delete the render-time `reconcileSequence` write-back.

**Batch 3 — Test backfill (unblocks the upstream merge).** Render `CreativeWorkspace` in jsdom specs covering story/drama/game/video modes, the file tree, and the production panel; lift `production-runtime.ts` and `workbench-ui.ts` to 100%. Re-run the coverage gate.

**Batch 4 — Structural simplification (only after Batch 3).** Split `workbench.tsx` per simplification item 3; extract the media-studio shell; container/presenter split for `DramaProductionView`. Then merge the validation trio, derive the produce schema pair from one field table, extract shared skill-scope resolution, and split `workspace-route.ts`. Config-catalog and discovery metadata must not drift:

```sh
pnpm run hygiene && pnpm run doc-sync
```

**Batch 5 — Scheduler decision.** Add a dual-module-instance test for the scheduler key and document the `Symbol.for` bridge as a sanctioned mechanism in the `tools` README; revisit at the next upstream sync.

**Final gate for every batch.** Snapshot replay must stay at the recorded baseline (166 pass / 1 known upstream `punycode` failure):

```sh
pnpm run build && DSH_EXAMPLE_MODE=lib pnpm run test:snapshot
```

## Alternatives considered

**Merge upstream first, harden later.** Rejected: rebasing a branch with known-red coverage onto moving upstream multiplies conflict surfaces, and the coverage debt is recorded as a pre-merge blocker.

**One big cleanup commit.** Rejected: mixing correctness fixes with structural moves defeats review and selective revert; the branch convention is small amended commits.

**Revert the `Symbol.for` fix.** Rejected: source-launched Hosts loading built Loader plugins are a real topology; keep the bridge but make it honest with a dual-instance test.

## Acceptance criteria

- `pnpm run test:coverage` passes the per-file gate for every creative file, with `CreativeWorkspace` rendered by tests.
- No global listener survives unmount or `pointercancel` in the drama canvas.
- Preflight and `produce-tool.ts` agree on the Python interpreter; the mismatch path is covered by a test.
- No source-grep hit for `jobsBaseline` remains in documentation; knowledge README links resolve.
- Production requests/sequence have exactly one source of truth; existing sessions migrate without losing cards.
- Dead code listed above is gone; `pnpm run lint`, forced host+client typecheck, creative specs, doc gates, and the snapshot baseline all stay green.

## Risks

- Dropping persisted workbench state can strand existing sessions; the Batch 2 migration must be exercised against a real pre-change workspace store.
- Splitting `workbench.tsx` churns git blame and collides with any parallel UI work; Batch 3 tests must land first so behavior is pinned.
- A global `Symbol.for` key can silently bridge *incompatible* module pairs across versions; the Batch 5 test should pair instances built from different sources, not the same file twice.
- Schema derivation must preserve zod `.volatile()` wrappers and `credential-ref` roles exactly; a drift in generated catalogs would fail `hygiene` loudly — that failure is the intended tripwire.
