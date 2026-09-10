---
description: "Creative production plugin for fiction, short-drama, interactive-game, and video-recap workbenches."
kind: "package-bundle"
---

# @deepseek-ai/dsh-creative

English | [中文](README.zh.md)

## Summary

Creative adds fiction, short-drama, interactive-game, and video-recap workflows to DeepSeek Harness. Bundled Skills and specialist Roles work through DSH's workspace, Session, models, tools and permissions; the Web profile also provides an editor, media previews and production cards in the right Sidebar.

One Creative page keeps all four domains available in mixed workspaces. Cross-domain workflows share project files and production settings without requiring separate applications ([decision](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.md)).

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

The shipped `web` profile includes this bundle; its [profile patch](cordis.patch.yml) mounts `creative`. The plugin registers four bundled skill providers (`creative`, `short-drama`, `novel-to-game`, `video-recap`), specialist Roles via `creative_role` and production tools. These registrations require the skill, subagent and tool registries, not Web services; the Session-scoped `/creative` API registers only when `webServer` and `typert` are available.

In a Session, expand the right Sidebar and choose **Creative workbench** on its guide page. The page is also available in an empty workspace. Opening a supported Creative file from Chat reveals the same workbench; ordinary file links use the Sidebar's file preview. Creating project files does not open the panel automatically.

The fiction pane recognizes projects at the workspace root, under `<book>/`, or under `长篇/<book>/` and `短篇/<book>/`. A short story appears as soon as `设定.md`, `小节大纲.md` or `正文.md` exists. The default document is prose, then an outline, then another Markdown file.

```yaml
- id: creative
  name: '@deepseek-ai/dsh-creative'
```

| Field | Default | Meaning |
|---|---|---|
| `editorMaxBytes` | `2097152` | Maximum editable text file size for the workbench editor (bytes). |
| `trustedHosts` | `[]` | Additional `host[:port]` authorities allowed to reach the workbench API beyond loopback. |
| `produce` | `{}` | Initial production profile and credential references; the `creative-produce` settings namespace supplies user overrides. |

Production settings name credential references, not secrets. A custom reference such as `AGNES_POOL` still supplies the adapter's canonical `AGNES_API_KEY`; renaming a reference does not rename the child-process variable. Comma-separated references and newline-separated stored keys form rotation pools ([execution policy](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.md#production-and-credentials)).

Agnes video uses the free `agnes-video-2.5-flash` model when no model is configured or the resolved value is blank. Set `produce.agnesVideoModel`, the corresponding Creative production setting, or `AGNES_VIDEO_MODEL` to select a model explicitly; `agnes-video-2.5` bills per second.

Drama production requires a job prepared and explicitly confirmed with the bundled `production_tool.py`. Pass its `job_id`, matching `adapter` and project `workdir` to `creative_produce_run`; the runner snapshots the confirmed inputs, consumes the confirmation once before execution, validates and publishes outputs, and records the run. Replacement job JSON on `stdin` and extra drama arguments are rejected; `argv: ["--selftest"]` is the sole drama diagnostic and accepts no job, stdin or production context. A workbench request or job binding cannot replace confirmation.

The bundled Agnes video runner validates its model, parameters and reference inputs before consuming confirmation. A local validation error reports its cause, preserves the unused receipt and creates no production attempt. After validation, confirmation is consumed before adapter launch and remains consumed on success or failure. Changed job inputs still require preparation and confirmation again.

Editor drafts and conflicts survive refresh and Sidebar tab changes. A complete listing can mark a draft's file as missing, but never discards the unsaved text; a truncated listing is not evidence of deletion. Saves use the last acknowledged file version, and a concurrent disk change requires conflict resolution rather than an overwrite.

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
| `src/client/index.ts` | Browser plugin entry; `workbench.tsx` owns the workbench UI and registration. |

Creative registers the `creative` page type and its keyed `sidebar.right.pane.tab` body under `@deepseek-ai/dsh-creative`. The [right Sidebar](../../client/ui-sidebar-right/README.md) owns layout and carries file navigation through its parameters and revision. The Session-scoped `creative.workbench.v2` store retains editor buffers, conflicts, selection and production drafts; in-flight save locks belong to the Session's nonpersistent inject face, so tab remounts cannot duplicate a save or restore a stale saving flag after refresh. [Editor reconciliation](src/client/editor-buffer.ts) keeps content reads tied to observed file versions. Styles load once through the Client stylesheet import. Chat and Composer remain in their own column ([decision](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.md#workspace-and-sidebar)).

Host and Client share [project-path.ts](src/project-path.ts) for project roots, relative paths, domains and file roles. The workspace API returns metadata per project; a book's `short-drama.json`, outline and tracking files belong to that book. Episode selection, shot selection, drafts and asset filters use full workspace-relative project/episode paths, so repeated `EP001` or `SHOT-001` names do not share state. Host reads and writes also enforce extension allowlists and resolved filesystem containment, including symlink targets; a chapter, its outline and tracking files must belong to the same project.

Workspace listings exclude dependency, Python-cache, hidden and video-working directories before applying their file budget. Media belongs to the Session's filesystem provider: direct Host streaming requires that provider to map the Host paths to the same execution-world files; otherwise bytes are read through the provider. A matching Host pathname alone is insufficient ([ownership](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.md#project-and-file-ownership)).

Production cards persist request drafts per Session, not execution state. Each card has a `ProductionRequestId`; its preparation message has a separate `SessionRequestId` matched to queue occurrences by `rpcId`. Confirmed background executions return real `{ jobId, startedAt }` references. Incremental Conversation projection restores bindings from Native result metadata or the compact JSON content also retained by PTC. Only the Session Controller's `jobsBySession` supplies running, stopping and terminal states, after its complete control baseline arrives. A card can contain multiple jobs; ended registered jobs do not prove that every planned asset succeeded. The media library remains an independent file view.

Stopping uses the trusted `/creative/job/stop` endpoint, which verifies the Session owner and exact job reference before calling `jobs.kill`; the UI waits for the real status update. Withdrawing preparation removes only its identified queue occurrence. An admitted request without a bound job has no generation-stop action. Neither operation cancels the conversation or consumes job output.

Roles inherit the calling DSH model; `creative_role` accepts only `role` and `prompt`. Research uses the visible `web_search` and `web_fetch` tools or caller-provided material. Pages requiring browser interaction return to the caller, which can load `browser-cdp` and supply the retrieved content; the research Role assumes no browser port or session.

Roles read packaged references through `creative_bundled_reference`, not workspace deployment directories. Novel checks share the packaged [novel scripts](knowledge/creative/scripts/) behind their skill-local entry paths; JavaScript runs as ESM, and an unavailable or malformed quality-check result blocks chapter delivery rather than counting as a pass.

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

Skills are discovered through `ctx.skills` and loaded with `skill`. All four domains share invocation guidance: workflow names, including `$name` and `/name` references, identify Skills; `creative_role` delegates only the seven bundled novel specialists. A delegated stage uses `subagent` with a self-contained task directing the child to load the named Skill. Production projection uses `creative_production`. The [four bundled providers](src/skill-provider.ts) read descriptions and complete bodies from `SKILL.md`, prepending shared invocation and domain integration instructions. Skill-specific behavior lives in Markdown, not runtime replacements ([decision](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.md#composition-and-knowledge)).

#### Token effect

Discovery supplies concise descriptions; all 36 entries fit the default catalog limit of 500 characters. A `skill` load adds that body as a tool result without replacing the catalog message or preloading other bodies; `creative_role` adds the selected Role persona in a child turn.

#### KV Cache effect

No direct prompt effect from this package alone. The `skill` catalog message and tool results are durable context; subagent delegation via `creative_role` adds a nested turn whose KV entries are scoped to that child.

### Production projection tool

#### What the model sees

`creative_production` exposes four projection intents (`open_section`, `focus_target`, `set_sequence`, `track_job`) with validated full-project `episode` paths and `targetId` fields. `track_job` requires an existing job owned by the current Session and a production request identity; a composition command starts in the background before registration. `creative_produce_run` accepts optional production context only in explicit background mode and returns its actual job binding. Foreground results retain `exitCode`, `timedOut`, termination `signal` and bounded stdout/stderr. Produce records nonzero or unknown exit codes as failed. A generic command's `completed` state means that its process ended, not that media generation succeeded. Neither tool's production context authorizes paid media generation.

#### Token effect

A successful production result adds compact request, target and job-reference JSON to tool history; other intents move the Browser workbench focus without adding document content to the model context.

#### KV Cache effect

Projection intents are tool calls whose results carry the confirmation message; they do not add persistent context beyond the Session's tool history.

### Production credential status

#### What the model sees

`creative_produce_status` reports credential presence for the drama adapters, including `agnes-image` and `agnes-video`, and the MiMo and Fish video providers. It uses the execution profile's credential lookup order, returns no keys, and launches no process. Ordinary shell environment checks cannot inspect the managed credential store; missing keys belong in the Creative production settings, not chat.

#### Token effect

Each invocation adds one small JSON status result. The tool makes no model or media-provider request.

#### KV Cache effect

Status follows normal logged tool history. Each new check resolves current credentials without changing earlier messages; presence does not prove provider connectivity or authorize production.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Client UI copy is locale-owned; operational failure text stays zh-Hans** — workbench chrome renders through the `creative` locale namespace (zh/en), while server error bodies, runtime diagnostics, and thrown errors remain zh-Hans protocol copy until the workspace route ships stable error codes.
- **Large knowledge and demo assets are bundled** — the `knowledge/` tree and `jin-ping-mei` demo increase clone size; a future iteration may fetch them on demand.
- **Browser automation uses external binaries** — `browser-cdp` requires compatible `agent-browser` and Lightpanda binaries in the session's execution environment; neither is bundled. It does not reuse Chrome profiles or provide full visual rendering for game QA. The skill owns version, startup and session instructions.
- **Jobs are process-local** — refresh and reconnect wait for a complete control baseline. After a Host restart, logged bindings without a matching live job show unavailable status and never restart automatically. Historical `track_job` records without real bindings remain requests, not execution evidence.
- **Preview runtimes follow tab mounting** — switching away from Creative can unmount game and video previews. Returning restores persistent editor state and reloads previews, not their in-memory runtime state. A project's first available video opens its empty preview; later versions wait for an explicit switch. Sidebar layout and visibility follow the upstream page-lifetime policy.

- **Remote execution has explicit resource limits** — provider-backed media fallback accepts at most 256 MiB per file. Skills expose packaged resource paths; a remote shell needs those resources mounted or copied into its own filesystem. Provider-correct workspace reads do not transfer bundled scripts into a remote sandbox.

- **Video confirmation remains instruction-level** — video entries retain their script arguments and require creator confirmation through their Skills; they do not use the drama runner's single-use confirmation or ledger. The tool invokes a video script once per call, with key-pool rotation only between calls.
- **Production retries require explicit rejection evidence** — within one confirmed drama run, key rotation requires an initial-submission authentication, permission or rate-limit rejection marked `submission_rejected`. Accepted submissions, polling, downloads and uncertain failures are never automatically resubmitted; there is no outer process retry. The [execution decision](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.md#production-and-credentials) owns the rejection and key-pool limits.
- **Video stage entries are limited** — the tool exposes full recap, voiceover and diagnostics, not standalone understanding or semantic review. Existing downstream inputs must not turn an analysis-only request into a full production run.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Knowledge manifests list skills, roles and examples, with optional notes; Git tracks content and changes ([decision](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.md#composition-and-knowledge)). The bundled game example uses a stable `bundled` preview identifier, not an upstream commit or content digest. The `production-tool` changes only the Session projection and never mutates creator documents or counts as paid-production confirmation.

</details>
