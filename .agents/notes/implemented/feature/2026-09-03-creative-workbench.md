# Agent Note: Creative workbench — fiction, short-drama, game, and video-recap production

Status: implemented

English | [中文](2026-09-03-creative-workbench.zh.md)

## Problem

DeepSeek Harness hosts coding agents but has no first-class support for long-form creative work: novels need chapter/outline/tracking invariants, short-drama needs creator-first document contracts and production projection, novel-to-game needs playable preview and QA binding, and video-recap needs a server-side pipeline with trusted media preview. Upstream Oh Story, Drama, NovelToGame, and VideoRecap ship as separate CLIs, dashboards, and git-embedded skills. Direct port would start parallel runtimes, duplicate permission and session ownership, and let model output diverge from the session log.

## Decision

`@deepseek-ai/dsh-creative` (`packages/creative/creative`, plugin `creative`) is one Harness plugin that bundles all four domains as in-process contributions.

* Four `SkillProvider`s (`creative`, `short-drama`, `novel-to-game`, `video-recap` in `src/skill-provider.ts:278`) serve pinned `knowledge/*/skills` trees with `BUNDLED_SKILL_RANK`. Each `get()` validates `relative(root, path)` containment and injects a DSH bridge (`DSH_*_BRIDGE`) so the model never starts a second dashboard, Agent runtime, or SSE transport. Skill-specific overrides are appended per skill.
* `creative_role` (`src/role-tool.ts:34`) spawns the seven Creative Roles as `subagents.spawn` children with `maxDepth: 1`, per-role `toolFilter.allow`, and a `persona` loaded from `knowledge/creative/roles` via `loadBundledRole`. `creative_bundled_reference` (`src/reference-tool.ts:44`) exposes only `story-setup/references/agent-references/*.md` and a `bundledReferenceGuard` denies a scoped shadow.
* `creative_production` (`src/production-tool.ts:19`) is concurrency-safe and projection-only. `validateProductionIntent` enforces `剧集/EP\d{3,}` episode paths, `SHOT-*` canonical ids, and job bounds; the tool never edits creator documents or authorizes paid production.
* Tool waterfall guards (`src/native-hooks.ts:124`) enforce `正文/第XXX章` before `大纲/细纲_第XXX章` via `fs.resolve` + `contains` on the calling Agent's filesystem, and add a post-write `additionalContexts` reminder. Decisions stay visible in the approval/tool UI and the session log.
* Session-scoped HTTP (`src/workspace-route.ts:809` mounted at `/creative` via `webServer`) lists, reads, writes, and streams media with `FsVersion` CAS (`replaceIfVersion`), `parseByteRange` RFC 9110 handling, `relative(root, path)` containment, and `trustedHosts` validated at load. Game preview is isolated with `sandbox allow-scripts` CSP and origin-flipped `http://127.0.0.1` ↔ `http://localhost` isolation; verification freshness is tracked by `WorkspaceVerificationTracker` (Current/Stale/Unbound/Pinned).
* Browser workbenches (`src/client/*`) use `defineStore('creative.workspace', scope:'session')` and `Slots` to render novel/drama/game/video tabs, handling dirty/conflict states and agent-driven navigation without downloading the bundled example before first entry.

Package `files` is `lib/index.js`, `lib/client.js`, `cordis.patch.yml`, `knowledge/**/*`, `lib/types/**/*.d.ts` (`scripts/check-workspace-constraints.ts:144`). No `src/invariant.ts` companion is published; invariants are operation-local and fail loud in the handler that makes the decision.

## Alternatives considered

**One package per domain.** Rejected: four separate `dsh-<domain>` packages would duplicate the shared Host route, trust, and Client store and force four independent version bumps for a single UX surface. The single `creative` group map (`packages/creative/README.md`) keeps the four `knowledge` trees versioned together while the four `SkillProvider.name` values preserve distinct discovery.

**Reuse upstream dashboards and `dashboard_server.py`.** Rejected: a second web server would own its own permissions, file writes, and session transport outside DSH's `sandboxPolicy` and `SessionId` scoping. The native `/creative` route and `VideoStudio`/`DramaProductionView` project the same artifacts through DSH-owned tools and approvals.

**Fork an Agent runtime per Role.** Rejected: an external runtime cannot inherit DSH's model, workspace, or cancellation. Using `subagents.spawn` keeps the seven Roles as children of the current DSH Agent with shared depth, tool, and UI budgets.

**Encode production as durable file mutation.** Rejected: `creative_production` would then count as creator confirmation for paid media generation. Keeping it projection-only and requiring explicit `track_job` after user confirmation preserves the ownership contract.

**Vendor `knowledge` under `vendor/`.** Rejected: the trees are content, not code vendoring; they are pinned by `knowledge/*/manifest.json` upstream commits and shipped as package data, avoiding the `vendor/README.md` sync procedure while still being auditable via `manifest.json`.

## Consequences

* Skills, Roles, and production intents are model-visible and reconstructable from the Session log; the workspace route is the narrow editor surface with loopback-or-`trustedHosts` trust and `FsVersion` conflict reporting.
* `dsh-creative` is `client-host` in `scripts/package-dependency-policy.ts:32` (`SAFE_HOST_DEPENDENCY_EXPORTS` covers `FsError`, `createUserMessage`, `SessionId`, `BUNDLED_SKILL_RANK`, `defineTool`) and uses `ctx.effect()` for every provider registration.
* Knowledge and the Jin Ping Mei demo enlarge the clone; a future iteration can move them to on-demand fetch without changing the provider contracts.
