# Agent Note: 游戏工作室模式

Status: implemented

[English](2026-09-01-game-studio-mode.md) | 中文

## Problem

`oh-story-dsh` 仓库已经实现了一套完整的小说转游戏管线，但 DeepSeek Harness 尚未提供对应的游戏创作模式。用户若要将小说改编为可交互游戏，无法在 DSH Web UI 中使用那七个 bundled skills、遵循工作区约定，或查看可玩预览。

## Decision

为 DSH 添加完整的游戏工作室模式，仅在选择 `game-studio` Agent Preset 时激活。

### 包布局

- `packages/host/game-studio`（`@deepseek-ai/dsh-host-game-studio`）：Host 插件，打包七个 `novel-to-game` skills，暴露 `/game-studio/*` 工作区 API，并追踪预览/验证新鲜度。
- `packages/client/ui-game-studio`（`@deepseek-ai/dsh-client-ui-game-studio`）：浏览器插件，注册名为 `game-studio` 的 `conversation.view` 入口，渲染带文件浏览器、QA 状态与沙盒 iframe 预览的标签页。
- `packages/preset/agent-presets/presets/game-studio`：新的 Agent Preset，引入 `@deepseek-ai/dsh-host-game-studio`，使该模式仅在选中预设时激活。
- `packages/bundle/web-app/cordis.patch.yml` 与 `package.json`：将客户端 UI 插件加入 Web 应用包，标签在浏览器中可用；无游戏项目时渲染空状态。

### Skill Provider

`createNovelToGameSkillProvider()` 从 `knowledge/novel-to-game/skills/*/SKILL.md` 发现技能。每个技能保留原 oh-story-dsh 内容，并追加 DSH 桥接段，说明该技能如何作为 DSH skill 暴露、使用哪些工具、如何调用。

### 工作区 API

`/game-studio/workspace` 返回包含项目简介、设计文档、QA 验证与预览资源路径的 `GameWorkspaceSnapshot`。`/game-studio/files/:path` 读取并列出项目文件。`/game-studio/media/:path` 在限制性 `Content-Security-Policy` 下提供媒体。`/game-studio/preview/:projectId` 返回可玩构建入口。`/game-studio/qa/:projectId` 返回验证记录。API 作用域限定为工作区根目录下的 `game-adaptations/<project>/`。

### 预览新鲜度

`WorkspaceVerificationTracker` 观察（QA revision, preview version）二元组。`UNBOUND` 表示尚无 QA 绑定到当前预览；`CURRENT` 表示预览与最新 QA 一致；`STALE` 表示预览在上一次通过 QA 后发生变化。

### 客户端 UI

`GameStudioView` 渲染项目选择器、标签切换（预览/QA/文件）以及 `GamePreview`。`GamePreview` 在沙盒 iframe 中加载 `/game-studio/preview/:projectId`，每个响应附带新的 CSP，并提供刷新/重载/全屏控制。文案通过 `ui-game-studio` 命名空间进行本地化管理。

## Alternatives considered

**将游戏工作室 Host 插件合并进现有预设。** 拒绝，因为需求要求只有在明确选择该模式时才激活游戏创作能力。专用 Preset 是 DSH 中实现此需求的最自然机制。

**仅在 Host 插件激活时显示客户端 UI。** 拒绝，因为 `conversation.view` slot 属于全局 Web 应用包；更简单的设计是始终注册该标签，并在无游戏项目时渲染空状态。这也避免了客户端包对按会话 Host 插件的运行时依赖。

**为预览使用独立运行时。** 拒绝，改为使用同源的沙盒 iframe 提供预览，这样预览保留在工作区内，且 CSP 默认拒绝外部来源。

## Consequences

用户选择 `game-studio` 预设后，即可获得七个 bundled skills、工作区 API 与浏览器面板。Web 应用包增加了一个客户端插件，未使用时无影响。Host 端能力受 Preset 选择限制。未来工作包括让文件浏览器可编辑，以及增强 QA 证据可视化。
