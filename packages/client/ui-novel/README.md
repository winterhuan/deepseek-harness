---
description: "Novel-writing mode reading panel for the dsh web client: the 「小说」conversation view over the novelist preset's workspace conventions."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-novel

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-novel` is the reading panel of the novel-writing mode: its browser half registers a `novel` entry in the `conversation.view` slot, so a session mounted on the `novelist` agent preset can switch to the 「小说」 view to read the project. The view shows chapter rows with board status and word counts, the foreshadow ledger summary, the outline and character sheets, and the tool-generated tracking views under `.novel/` (context card, character snapshots, foreshadow table, dual timeline, per-chapter records) behind a tracking tab, and renders the selected document as prose. Its host half registers two read-only HTTP routes (`/novel/overview`, `/novel/document`) that serve the calling session's workspace; the panel fetches them same-origin. The on-disk project conventions (`outline.md`, `characters/`, `chapters/`, `.novel/board.json`) are owned by the `novelist` preset and its tools; this package only reads them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the 「小说」 view from the view switcher of any session whose workspace holds a novel project. The header line summarizes the project (chapter count, total word count as visible characters of the visible body (frontmatter and the first heading excluded — the metric the preset's `novel_track` tool uses), open foreshadows), and 刷新 re-reads the workspace — click it after the agent writes or revises chapters, since the panel does not subscribe to file changes. The left pane lists chapters (with status 草稿/已修订/定稿 and per-chapter word counts), the outline, character sheets, and tracking views; clicking a row loads its text into the reading pane. An empty workspace shows guidance to run `novel_scaffold` first.

### Data source

Every read goes through the package's own routes against the current session's workspace root: `/novel/overview` derives chapter rows from `chapters/*.md` joined with `.novel/board.json` statuses and the foreshadow ledger, and `/novel/document` serves one validated workspace-relative `.md` file truncated at 200&nbsp;KiB. Documents outside the workspace, non-`.md` paths, and traversal paths (`..`, absolute, backslash) are rejected.

<a id="understand-the-implementation"></a>
## Understand the implementation

The node half (`src/index.ts`) injects `sessions` and `fs`, reads the webserver optionally, and registers both routes as one effect when HTTP transport exists — transport-less deployments mount the panel without routes; the route handlers resolve the session through `sessions.get`, read the workspace through the `fs` backend (so a sandboxing backend keeps enforcing its policy), and degrade unknown board shapes to defaults rather than failing the panel. The browser half (`src/client/`) injects `slots` and `locale`, registers the dictionaries under the `ui-novel` namespace, and seats the view into `conversation.view` through `slots.inject`, so the contribution follows the slot's declaration. The view holds only local component state: one overview fetch on mount, one document fetch per opened row, no store and no session-event subscription. `src/board.ts` owns the derived-value logic and is shared shape-compatible with the writing side in the preset's `novel-tools.js`.

<a id="further-exploration"></a>
## Further Exploration

- [novelist preset](../../preset/agent-presets/README.md) — the novel-writing mode that owns the workspace conventions and the board tools.
- [ui-conversation](../ui-conversation/README.md) — the `conversation.view` slot owner and the view switcher.
- [dsh-host-webserver](../../host/webserver/README.md) — the route registry these handlers register into.
- [dsh-fs](../../fs/fs/README.md) — the filesystem backend seam the routes read through.

-----

<a id="model-experience"></a>
## Model Experience

### Read-only panel routes

#### What the model sees

Nothing directly — the package registers no tools, prompt sections, or session events, and the two HTTP routes are read-only browser surfaces the model never calls; the novel project itself is written by the agent through the `novelist` preset's `novel_scaffold` and `novel_board_*` tools.

#### Token effect

None; no prompt content of any kind is added while the package is mounted.

#### KV Cache effect

No prompt content enters the reusable prefix, so there is no cache effect across Turns.

## Known Limitations and Deferred Work

These limits define panel freshness and scope; they are current package constraints.

- **The panel reads on demand, not on change** — it does not subscribe to workspace file events, so content written by the agent appears after 刷新 or a view remount.
- **Read-only surface** — the panel presents and navigates but writes nothing; all authoring flows through the agent and the preset's `novel_scaffold` / `novel_board_*` tools.
- **One session workspace per view** — the routes resolve the project from the active session's workspace only; there is no cross-workspace or multi-project switcher.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The board document shape in `src/board.ts` is the reading mirror of the writing side in the `novelist` preset's `plugins/novel-tools.js`; change them together and bump `formatVersion` on shape changes. The panel stays store-free on purpose — if a future feature needs cross-entry state, that is a store declaration, not module-level handles. `/novel/document` deliberately serves any workspace-relative `.md` (outline, character sheets, chapters) so the reading pane stays one endpoint.

</details>
