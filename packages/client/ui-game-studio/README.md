---
description: "Game studio browser panel: live preview, project browser, and QA status for the novel-to-game pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-game-studio

Game-studio mode panel for the DSH Web GUI. It registers a `conversation.view` entry named `game-studio` that renders the playable preview, project file browser, and QA status for game adaptations produced by the novel-to-game pipeline.

## Summary

This package provides the browser-side half of the game-studio experience. It fetches the workspace state from the `/game-studio/workspace` API provided by `@deepseek-ai/dsh-host-game-studio` and renders an isolated, sandboxed iframe preview plus project/QA tabs. The node half is a no-op placeholder; the host plugin is supplied by `@deepseek-ai/dsh-host-game-studio`.

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

Mount the plugin in the web-app bundle when the game-studio conversation view should be available.

```yaml
- id: ui-game-studio
  name: '@deepseek-ai/dsh-client-ui-game-studio'
```

The plugin requires `ctx.slots` and `ctx.locale`.

## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Registers dictionaries and the `game-studio` conversation view entry |
| [`src/client/GameStudioView.tsx`](src/client/GameStudioView.tsx) | Main panel: project selector, tabs, file browser, QA panel |
| [`src/client/GamePreview.tsx`](src/client/GamePreview.tsx) | Isolated iframe preview with refresh/fullscreen/pending-build controls |
| [`src/client/stores.ts`](src/client/stores.ts) | Panel state store |
| [`src/client/locales.ts`](src/client/locales.ts) | `ui-game-studio` locale namespace |

## Further Exploration

- [Web Client architecture](../../docs/subsystems/web-client.md)
- [Slots reference](../../docs/subsystems/slots.md)

## Model Experience

No model-visible impact beyond the standard conversation view slot label.

## Known Limitations and Deferred Work

- The file editor is currently read-only; save/conflict-resolution will be added once the workspace API stabilizes.
- Preview iframe sandboxing deliberately blocks external origins; media assets served from other hosts require explicit CSP allowance.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
