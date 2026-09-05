---
description: "Creative production plugin for fiction, short-drama, interactive-game, and video-recap workbenches."
kind: "package-bundle"
---

# @deepseek-ai/dsh-creative

English | [中文](README.zh.md)

## Summary

The creative plugin bundles fiction, short-drama, interactive-game, and video-recap workbenches on DeepSeek Harness. It ships pinned Skills and specialist Roles plus Host hooks/tools/route and Browser workbenches while DSH owns workspace, session, model, tools, and permissions.

The four domains stay in one plugin deliberately: the real pipelines cross domains (novel-to-game adaptation, video recaps of drama episodes, storyboard `SHOT-` ids shared by image and video jobs), so per-domain packages would cut the seam where the product flows. Shared Host route, trust, credential forwarding, confirmation gate, and Client store are the owned assets; per-domain Skills, studios, and adapters are the seams. Split only on two tripwires: single-mode lifecycle state accumulating in the shared store (split store slices), or the settings namespace outgrowing one card (split namespaces). Presence stays workspace-level, never per-mode, so mixed workspaces keep all tabs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

---

<a id="use-this-package"></a>
## Use this package

Mount `creative` in a DSH profile to enable the creative workbenches; the shipped `web` profile already includes it. The plugin registers four bundled skill providers (`creative`, `short-drama`, `novel-to-game`, `video-recap`), specialist Roles via `creative_role`, production intents via `creative_production`, and a session-scoped workspace route under `/creative`.

```yaml
- id: creative
  name: '@deepseek-ai/dsh-creative'
```

| Field | Default | Meaning |
|---|---|---|
| `editorMaxBytes` | `2097152` | Maximum editable text file size for the workbench editor (bytes). |
| `trustedHosts` | `[]` | Additional `host[:port]` authorities allowed to reach the workbench API beyond loopback. |

---

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| `src/skill-provider.ts` | Four bundled `SkillProvider` implementations with DSH bridge injection. |
| `src/role-tool.ts` | `creative_role` subagent delegation with per-role tool filtering. |
| `src/reference-tool.ts` | Pinned bundled reference reader for `story-setup` agent references. |
| `src/production-tool.ts` | `creative_production` projection intents. |
| `src/workspace-route.ts` | Session-scoped `/creative` HTTP API for listing/reading/writing creative files and media previews. |
| `src/native-hooks.ts` | Tool waterfall guards for long-form prose invariants. |
| `src/client/` | Browser workbench UI (file tree, markdown/jsonl preview, drama production, game/video studios). |

The workbench claims the conversation layout only for a workspace that actually holds creative work (story/drama files, workspace game projects, or video projects; the bundled game example never counts). Any workbench collapses to a launcher that returns the conversation to DSH untouched, and an explicit open/closed choice wins over auto-detection and persists per workspace in browser storage.

No runtime invariant companion is published. The plugin owns no cross-process event sequence or independently maintained mutable relation for a Cordis listener to compare; state is derived from the Session, Skill registrations, and file system within each operation.

</details>

---

<a id="further-exploration"></a>
## Further Exploration

- [Creative group map](../README.md) — package family overview.
- [DeepSeek Harness Architecture](../../../docs/architecture.md) — composition and extension points.

---

<a id="model-experience"></a>
## Model Experience

### Creative skills and roles

#### What the model sees

Skills are surfaced via `ctx.skills` and the `skill` tool; specialist Roles via `creative_role`; production projection via `creative_production`. The four bundled providers inject DSH-owned bridges (`DSH_*_BRIDGE`) and per-skill overrides declared in `src/skill-provider.ts:15`.

#### Token effect

Each `skill` load replaces a short catalog entry with the full instruction body; `creative_role` adds a nested turn whose prompt carries the selected Role persona. Only the requested skill or role body enters the context window.

#### KV Cache effect

No direct prompt effect from this package alone. The `skill` catalog message and tool results are durable context; subagent delegation via `creative_role` adds a nested turn whose KV entries are scoped to that child.

### Production projection tool

#### What the model sees

`creative_production` exposes four projection intents (`open_section`, `focus_target`, `set_sequence`, `track_job`) with validated `episode` and `targetId` fields. The tool never mutates creator documents and does not authorize paid media generation.

#### Token effect

A `track_job` call records the job the agent is actually executing; other intents move the Browser workbench focus without adding document content to the model context.

#### KV Cache effect

Projection intents are tool calls whose results carry the confirmation message; they do not add persistent context beyond the Session's tool history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Client UI copy is product-specific and locale-owned** — the workbenches intentionally render Chinese copy; a future locale pass will extract strings into `locales/`.
- **Large knowledge and demo assets are bundled** — the `knowledge/` tree and `jin-ping-mei` demo increase clone size; a future iteration may fetch them on demand.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep `knowledge/` pinned to upstream commits via `manifest.json` and note upstream SHAs in the file header where applicable. The `production-tool` changes only the Session projection and never mutates creator documents or counts as paid-production confirmation.

</details>
