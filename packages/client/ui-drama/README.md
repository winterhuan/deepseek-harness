---
description: "Short-drama creation mode reading panel for the dsh web client: the 「短剧」conversation view over the drama preset's workspace conventions and the five-document short-drama/v1 projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-drama

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-drama` is the reading panel of the short-drama creation mode: its browser half registers a `drama` entry in the `conversation.view` slot, so a session mounted on the `drama` agent preset can switch to the 「短剧」 view to read the project. The view lists episodes on the left, opens each episode's five creator documents into a reading pane, and previews a read-only projection over the owned Markdown — shot / asset / prompt counts, navigable diagnostics (duplicate ids, unresolved references) and the media delivered under `剧集/<EP>/制作成果/`. Its host half registers three read-only HTTP routes (`/drama/overview`, `/drama/episode`, `/drama/document`) that serve the calling session's workspace; the panel fetches them same-origin. The on-disk project conventions (`剧集/EPxxx/剧本.md` · `视觉设定.md` · `分镜.md` · `图片提示词.md` · `视频提示词.md`, `.drama/board.json`) are owned by the `drama` preset and its tools; this package only reads them.

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

Open the 「短剧」 view from the view switcher of any session whose workspace holds a short-drama project. The header line summarizes the project (episode count and pending-production count), and 刷新 re-reads the workspace — click it after the agent writes or revises creator documents, since the panel does not subscribe to file changes. The left pane lists episodes (with their board stage and present-document count); clicking an episode loads its projection and its present five creator documents in the sub-list, which open into the reading pane. An empty workspace shows guidance to ask the agent to run `drama_scaffold` first.

This package is a viewer, never an author: it cannot create creator documents or advance board stages. Those belong to the `drama` preset's tools (`drama_scaffold`, `drama_board`, `drama_episode`, `drama_track`).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/board.ts` is the workspace-facing reader shared by the host routes. It normalizes `.drama/board.json` (`normalizeBoard`), reads the board and episode directories, derives the overview, and validates + reads one episode document with a byte cap (`sanitizeEpisodeDocumentPath` / `readDocument`). `src/projection.ts` (`parseEpisodeProjection`) derives the `short-drama/v1` projection pure over the present documents: shots, visual assets, image/motion prompts, cross-document targets, and diagnostics. `src/routes.ts` mounts the three GET routes over `sessions` + `fs`; `src/index.ts` (node half) registers them on the optional webserver in an effect. `src/client/DramaView.tsx` (browser half) fetches the overview/episode/document values and renders the panel; `src/client/locale.ts` owns all product copy under the `ui-drama` namespace.

### Data source

Routes resolve the calling `sessionId` to its workspace root and read the `drama` preset's conventions there. Nothing is cached; each fetch re-reads the workspace, so the panel reflects the latest agent writes after a manual refresh.

### Loader flow

The node half `apply` reads the webserver through `ctx.get('webServer')` and registers the routes in a lifetime effect; a deployment without HTTP transport simply leaves the routes absent and the browser view shows its error state.

## Further Exploration

- The `drama` agent preset and its `drama-tools.js` define the workspace conventions this package reads.
- The `drama` five-document skills (`short-drama-develop`, `short-drama-write`, `short-drama-assets`, `short-drama-storyboard`, `short-drama-image-prompts`, `short-drama-video-prompts`, `short-drama-produce`, `short-drama-review`) own the creator-first grammar the projection parses.

## Model Experience

- Model-to-user, read-only: this package never modifies workspace files and never writes a parallel creator truth, so it cannot corrupt the project the agent is authoring.
- The projection is non-authoritative: it is a fast preview of necessary IDs and health markers, not an audit. `drama_track` remains the tool of record; the panel defers to it and never pre-creates missing documents.
- Determinism: identical workspace content yields an identical panel value; the parser only reports what the owned Markdown declares.

## Known Limitations and Deferred Work

- The projection is a read-only preview; the full oh-story workbench behaviors (media gallery, relationship canvas, production job confirmation) are not implemented here.
- The classification of assets (character/scene/prop) is best-effort from the anchored title and may misclassify unusual names; the raw id always wins.
- The panel does not subscribe to file changes; refresh is manual.

## Dev note
