# Creative

English | [中文](creative.zh.md)

The fiction, short-drama, novel-to-game, and video-recap production workbench owned by [`@deepseek-ai/dsh-creative`](../../packages/creative/creative/README.md). One in-process plugin bundles four pinned upstream skill trees, specialist roles, production tools, session-scoped workbench routes, and a browser workbench, while DSH retains models, sessions, tools, permissions, and roots. Package composition, tool inventory, and configuration are on the [package README](../../packages/creative/creative/README.md).

Source: [`packages/creative/creative/src/index.ts`](../../packages/creative/creative/src/index.ts)

## The four seams

**Skill and role supply.** Four `SkillProvider`s serve the pinned `knowledge/` trees and inject a DSH bridge into every skill body, so upstream workflows never start a second dashboard, agent runtime, or transport. `creative_role` runs the seven upstream roles as `subagents.spawn` children with per-role tool filters; `creative_bundled_reference` is the only reader for packaged reference files.

**Paid production.** `creative_produce_run` is the only path from a model to the pinned Python production scripts and their provider keys. Keys live in the credentials store as references; the settings namespace holds references and non-secret profile fields; the tool resolves them per call and forwards them as explicit environment variables, because every other subprocess starts from a scrubbed environment. Contract verdicts drive bounded key rotation and backoff.

**Projection intents.** `creative_production` is a concurrency-safe, side-effect-free tool whose tool call lands in the session log; the browser workbench replays it to drive the short-drama production views. It never edits creator documents or authorizes paid generation. Pending input belongs to the session's `inbox` projection, durable production results to the Conversation projection, and presentation drafts to the workbench store.

**Workbench routes.** `/creative` is a session-scoped HTTP surface with loopback-or-`trustedHosts` trust, directory allowlists, version-cas file writes, ranged media streaming, and CSP-isolated game previews. The browser workbench consumes it plus the session store, and dispatches production only by sending chat prompts through the normal approval flow.

## Workbench presentation

The browser workbench is the `creative` page in the [right Sidebar](sidebar-right.md), opened from its guide or supported Chat file links. Its keyed `sidebar.right.pane.tab` body uses the existing Session store for drafts and production preparation; the Sidebar owns layout and tab lifetime. [The package README](../../packages/creative/creative/README.md#use-this-package) describes entry points and preview lifetime.

## Language seam

Workbench UI copy is locale-owned through the `creative` namespace (zh source of truth, key-identical `en`), including the protocol diagnostics the production views render by code. Workspace-protocol identifiers (`正文/`, `剧集/EP001`, `SHOT-*`), the agent-facing prompt builders, and operational failure text (server error bodies, runtime diagnostics) stay zh-Hans: they are part of the creator protocol the skills and host guards share, not browser chrome.
