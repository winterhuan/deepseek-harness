---
description: "Game studio host plugin: bundled novel-to-game skills and workspace API for playable game production."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-game-studio

Bundled novel-to-game skill provider and workspace HTTP API for the DSH Web game-studio panel.

## Summary

This package provides the host-side half of the game-studio experience. It registers a bundled skill provider that serves the seven novel-to-game skills, and it mounts a workspace HTTP API that the browser panel uses to list projects, read and write source files, serve media, and preview the playable build in an isolated, sandboxed iframe.

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

Mount the plugin when a session should have access to the novel-to-game pipeline and the game-studio workspace API.

```yaml
- id: game-studio-host
  name: '@deepseek-ai/dsh-host-game-studio'
```

The plugin requires `ctx.skills`, `ctx.webServer`, `ctx.sessions`, `ctx.fs`, and `ctx.typert`.

## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: registers the skill provider and workspace routes |
| [`src/skill-provider.ts`](src/skill-provider.ts) | Bundled novel-to-game skill discovery |
| [`src/workspace-route.ts`](src/workspace-route.ts) | `/game-studio/*` HTTP routes |
| [`src/verification-tracker.ts`](src/verification-tracker.ts) | QA verification freshness tracking |

## Further Exploration

- [Skill subsystem reference](../../docs/subsystems/skills.md)

## Model Experience

Indirectly, through the `dsh-tool-skill` catalog and the `/novel-to-game` user invocation, which inject the bundled skill instructions into the conversation.

## Known Limitations and Deferred Work

- No built-in media generation adapters (GPT Image 2, Seedance, MiniMax Music) are bundled; project-specific adapters can be added later as separate plugins.
- The bundled example project is a minimal placeholder for offline regression, not a full playable adaptation.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
