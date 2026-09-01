---
description: "dsh Web 客户端的小说创作模式阅读面板：novelist 预设工作区约定之上的「小说」会话视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-novel

[English](README.md) | 中文

## 概述

`dsh-client-ui-novel` 是小说创作模式的阅读面板：浏览器半部在 `conversation.view` 槽位注册 `novel` 条目，挂载 `novelist` Agent 预设的会话可以切换到「小说」视图阅读项目。视图展示章节行（含状态板状态与字数）、伏笔账本摘要、大纲、人物小传，以及 `.novel/` 下工具生成的追踪视图（上下文卡、角色快照、伏笔表、双时间线、逐章记录，收在「追踪」标签后），并把选中文档渲染为正文。Host 半部注册两条只读 HTTP 路由（`/novel/overview`、`/novel/document`），服务调用会话的工作区；面板以同源 fetch 读取。磁盘上的项目约定（`outline.md`、`characters/`、`chapters/`、`.novel/board.json`）由 `novelist` 预设及其工具持有；本包只读。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在工作区已有小说项目的会话中，从视图切换器打开「小说」。标题行汇总项目（章节数、以可见正文计的总字数——frontmatter 与首个标题不计入，即预设 `novel_track` 工具的口径；未回收伏笔数），「刷新」按钮重读工作区——Agent 写完或修订章节后点它，因为面板不订阅文件变更。左栏列出章节（含 草稿/已修订/定稿 状态与各章字数）、大纲、人物小传与追踪视图；点击一行把文本载入右栏。空工作区显示先运行 `novel_scaffold` 的引导。

### 数据来源

每次读取都经过本包自己的路由，作用于当前会话的工作区根：`/novel/overview` 从 `chapters/*.md` 结合 `.novel/board.json` 的状态与伏笔账本推导章节行，`/novel/document` 服务一个经过净化的工作区相对 `.md` 文件，超过 200&nbsp;KiB 截断。工作区之外的文档、非 `.md` 路径与穿越路径（`..`、绝对路径、反斜杠）一律拒绝。

<a id="understand-the-implementation"></a>
## 理解实现

Node 半部（`src/index.ts`）注入 `sessions` 与 `fs`，可选读取 webserver，在存在 HTTP 传输时把两条路由作为一个 effect 注册——无传输的部署照样挂载面板，只是没有路由；路由处理通过 `sessions.get` 解析会话，经 `fs` 后端读取工作区（沙箱后端继续执行其策略），未知的状态板形态降级为默认值而不是让面板失败。浏览器半部（`src/client/`）注入 `slots` 与 `locale`，在 `ui-novel` 命名空间下注册字典，并经 `slots.inject` 把视图装进 `conversation.view`，贡献随槽位声明的消失而回收。视图只持有组件局部状态：挂载时一次 overview 请求、每个打开行一次文档请求，无 store、无会话事件订阅。`src/board.ts` 持有派生值逻辑，与预设 `novel-tools.js` 的写入侧保持形状兼容。

<a id="further-exploration"></a>
## 进一步阅读

- [novelist 预设](../../preset/agent-presets/README.zh.md) — 持有工作区约定与状态板工具的小说创作模式。
- [ui-conversation](../ui-conversation/README.zh.md) — `conversation.view` 槽位持有者与视图切换器。
- [dsh-host-webserver](../../host/webserver/README.zh.md) — 这些处理注册进的路由注册表。
- [dsh-fs](../../fs/fs/README.zh.md) — 路由读取所经的文件系统后端接缝。

-----

<a id="model-experience"></a>
## 模型体验

### 只读面板路由

#### 模型看到什么

什么都没有——本包不注册工具、提示词段落或会话事件，两条 HTTP 路由是模型不会调用的只读浏览器面；小说项目本身由 Agent 经 `novelist` 预设的 `novel_scaffold` 与 `novel_board_*` 工具写入。

#### Token 效果

无；包挂载期间不添加任何提示词内容。

#### KV Cache 影响

没有提示词内容进入可复用前缀，因此跨轮没有缓存效应。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义面板的新鲜度与范围；它们是当前的包约束。

- **面板按需读取，不随变更读取** —— 不订阅工作区文件事件，Agent 写入的内容在「刷新」或视图重挂后出现。
- **只读面** —— 面板只展示与导航，不写入；所有写作流程经 Agent 与预设的 `novel_scaffold` / `novel_board_*` 工具。
- **一个视图对应一个会话工作区** —— 路由只从活动会话的工作区解析项目；没有跨工作区或多项目切换器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`src/board.ts` 的状态板文档形状是 `novelist` 预设 `plugins/novel-tools.js` 写入侧的读取镜像；一起改并递增 `formatVersion`。面板有意不建 store——未来功能若需要跨条目状态，那是 store 声明，不是模块级句柄。`/novel/document` 有意服务任何工作区相对 `.md`（大纲、人物小传、章节），阅读栏因此只有一个端点。

</details>
