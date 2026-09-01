# Agent Note: Game-studio mode

Status: implemented

English | [中文](2026-09-01-game-studio-mode.zh.md)

## Problem

The `oh-story-dsh` repository already implements a complete novel-to-game pipeline, but DeepSeek Harness has no matching game-creation mode. Users who want to turn a novel into an interactive game cannot access the seven bundled skills, the workspace conventions, or a playable preview from inside the DSH web UI.

## Decision

Add a complete game-studio mode to DSH that is only active when the `game-studio` agent preset is selected.

### Package layout

- `packages/host/game-studio` (`@deepseek-ai/dsh-host-game-studio`): host plugin that bundles the seven `novel-to-game` skills, exposes a `/game-studio/*` workspace API, and tracks preview/verification freshness.
- `packages/client/ui-game-studio` (`@deepseek-ai/dsh-client-ui-game-studio`): browser plugin that registers a `conversation.view` entry named `game-studio`, rendered as a tabbed panel with a file browser, QA status, and a sandboxed iframe preview.
- `packages/preset/agent-presets/presets/game-studio`: an new agent preset that pulls in `@deepseek-ai/dsh-host-game-studio` so the mode is active only when the preset is chosen.
- `packages/bundle/web-app/cordis.patch.yml` and `package.json`: include the client UI plugin in the web-app bundle so the tab is available in the browser; it renders an empty state when no game project exists.

### Skill provider

`createNovelToGameSkillProvider()` discovers the skills shipped under `knowledge/novel-to-game/skills/*/SKILL.md`. Each skill keeps the original oh-story-dsh content and adds a DSH bridge section that explains how the skill is exposed as a DSH skill, what tools it uses, and how to invoke it.

### Workspace API

`/game-studio/workspace` serves a `GameWorkspaceSnapshot` with the project brief, design document, QA verification, and preview asset paths. `/game-studio/files/:path` reads and lists project files. `/game-studio/media/:path` serves media with a restrictive `Content-Security-Policy`. `/game-studio/preview/:projectId` returns the playable build entry. `/game-studio/qa/:projectId` returns the verification record. The API is scoped to `game-adaptations/<project>/` under the workspace root.

### Preview freshness

`WorkspaceVerificationTracker` observes pairs of (QA revision, preview version). `UNBOUND` means no QA has bound to the current preview; `CURRENT` means the preview matches the latest QA; `STALE` means the preview changed after the last passing QA.

### Client UI

`GameStudioView` renders the project selector, tab switcher (preview/QA/files), and `GamePreview`. `GamePreview` loads `/game-studio/preview/:projectId` in a sandboxed iframe with a fresh CSP per response, plus refresh/reload/fullscreen controls. Copy is locale-owned through the `ui-game-studio` namespace.

## Alternatives considered

**Inline the game-studio host plugin into an existing preset.** Rejected because the requirement is that game-creation capabilities are only available when the mode is explicitly selected. A dedicated preset is the natural DSH mechanism for this.

**Make the client UI visible only when the host plugin is active.** Rejected because the `conversation.view` slot is part of the global web-app bundle; the simpler design is to always register the tab and let it render an empty state when no game project exists. This also avoids a runtime dependency from the client bundle to a per-session host plugin.

**Use a separate runtime for previews.** Rejected in favor of a sandboxed iframe served from the same host, which keeps the preview inside the workspace and lets the CSP reject external origins by default.

## Consequences

Users can select the `game-studio` preset and get the seven bundled skills, the workspace API, and the browser panel. The web-app bundle grows by one client plugin, which is harmless when unused. Host-side capabilities are gated by preset selection. Future work includes making the file browser editable and adding richer QA evidence visualization.
