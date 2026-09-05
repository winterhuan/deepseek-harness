# Agent Note: 创作工作台 — 小说、短剧、游戏与视频解说生产

Status: implemented

English | [中文](2026-09-03-creative-workbench.md)

## Problem

DeepSeek Harness 已承载编程 Agent，但对长篇创作尚无一等支持：长篇需要章节/细纲/追踪的不变量，短剧需要创作者优先的文档契约与生产投影，小说改游戏需要可试玩预览与 QA 绑定，视频解说需要服务端流水线与可信媒体预览。上游的 Oh Story、Drama、NovelToGame、VideoRecap 以独立 CLI、Dashboard 与 git 嵌入式 Skill 分发，直接移植会启动并行运行时、重复权限与 Session 归属，并让模型输出与 Session Log 分叉。

## Decision

`@deepseek-ai/dsh-creative`（`packages/creative/creative`，插件 `creative`）以单个 Harness 插件承载四域。

* 四个 `SkillProvider`（`creative`、`short-drama`、`novel-to-game`、`video-recap`，见 `src/skill-provider.ts:278`）以 `BUNDLED_SKILL_RANK` 提供 `knowledge/*/skills` 固定树。`get()` 校验 `relative(root, path)` 防逃逸，并向每个 Skill 注入 DSH 桥接（`DSH_*_BRIDGE`），使模型永不启动第二 Dashboard、Agent 运行时或 SSE 传输；并按 Skill 追加覆盖。
* `creative_role`（`src/role-tool.ts:34`）以 `subagents.spawn` 子进程承载七个 Creative Role，`maxDepth: 1`，按 Role `toolFilter.allow`，`persona` 由 `knowledge/creative/roles` 经 `loadBundledRole` 加载。`creative_bundled_reference`（`src/reference-tool.ts:44`）仅暴露 `story-setup/references/agent-references/*.md`，`bundledReferenceGuard` 拒绝同名遮蔽。
* `creative_production`（`src/production-tool.ts:19`）并发安全且仅投影。`validateProductionIntent` 强制 `剧集/EP\d{3,}`、`SHOT-*` 规范 ID 与任务边界；工具不改创作者文档亦不视为付费投产确认。
* 工具瀑布守卫（`src/native-hooks.ts:124`）在调用方 Agent 文件系统上以 `fs.resolve`+`contains` 强制 `正文/第XXX章` 需先有 `大纲/细纲_第XXX章`，并通过 `additionalContexts` 追加写后提醒。判定留在审批/工具 UI 与 Session Log 中可见。
* 会话级 HTTP（`src/workspace-route.ts:809` 挂载于 `webServer` `/creative`）以 `FsVersion` CAS（`replaceIfVersion`）、RFC 9110 的 `parseByteRange`、`relative(root,path)` 防逃逸与启动时校验的 `trustedHosts` 提供列表/读取/写入/媒体流。游戏预览以 `sandbox allow-scripts` CSP 与 `http://127.0.0.1`↔`http://localhost` 源隔离；校验新鲜度由 `WorkspaceVerificationTracker`（Current/Stale/Unbound/Pinned）跟踪。
* 浏览器工作台（`src/client/*`）以 `defineStore('creative.workspace', scope:'session')` 与 `Slots` 渲染小说/短剧/游戏/视频页签，处理脏/冲突状态与 Agent 驱动导航，且在首次进入游戏前不下载内置示例。

包 `files` 为 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`knowledge/**/*`、`lib/types/**/*.d.ts`（`scripts/check-workspace-constraints.ts:144`）。不发布 `src/invariant.ts` companion；不变量在做出判定的操作内 loud-fail。

## Alternatives considered

**每域一包。** 否决：四个 `dsh-<domain>` 会重复共享的 Host 路由、信任与 Client store，并为同一 UX 表面带来四次独立发版。单一 `creative` 组图（`packages/creative/README.md`）让四棵 `knowledge` 树同版，而四个 `SkillProvider.name` 保留独立发现。真实管线本来就是跨域的——小说改游戏、短剧的视频解说、图片与视频共用的分镜 `SHOT-` 编号——按域拆包会正好切在产品流动的地方。只有两条绊线才拆：单 mode 生命周期状态在共享 Client store 里堆积（拆 store 切片），或设置命名空间撑满一张卡片（拆命名空间）。存在性判定保持 workspace 级也是同一理由：混合 workspace 保留全部四个 tab。

**复用上游 Dashboard 与 `dashboard_server.py`。** 否决：第二 Web Server 会在 DSH 的 `sandboxPolicy` 与 `SessionId` 作用域之外拥有独立权限、文件写入与会话传输。原生 `/creative` 路由与 `VideoStudio`/`DramaProductionView` 通过 DSH 拥有的工具与审批投影同一产物。

**为每个 Role fork 一个 Agent 运行时。** 否决：外部运行时无法继承 DSH 的模型、工作区或取消。`subagents.spawn` 使七个 Role 成为当前 DSH Agent 的子进程，共享深度、工具与 UI 预算。

**把生产编码为持久文件变更。** 否决：此时 `creative_production` 将被视为付费媒体生成的创作者确认。保持其仅投影并在用户确认后才 `track_job`，保留归属契约。

**将 `knowledge` 置于 `vendor/`。** 否决：其为内容而非代码 vendoring；由 `knowledge/*/manifest.json` 的上游提交固定并作为包数据发布，避免 `vendor/README.md` 同步流程，同时仍可通过 `manifest.json` 审计。

## Consequences

* Skill、Role 与生产意图均模型可见且可由 Session Log 重建；工作台路由是窄编辑面，受 loopback 或 `trustedHosts` 信任并以 `FsVersion` 报告冲突。
* `dsh-creative` 在 `scripts/package-dependency-policy.ts:32` 中为 `client-host`（`SAFE_HOST_DEPENDENCY_EXPORTS` 覆盖 `FsError`、`createUserMessage`、`SessionId`、`BUNDLED_SKILL_RANK`、`defineTool`），并对每个 provider 注册使用 `ctx.effect()`。
* 知识库与金瓶梅 Demo 增大克隆体积；未来可改为按需拉取而不改变 provider 契约。
