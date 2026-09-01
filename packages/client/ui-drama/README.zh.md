---
description: "短剧创作模式阅读面板：面向 drama 预设工作区约定与五文档 short-drama/v1 投影的「短剧」会话视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-drama

[English](README.md) | 中文

## 概述

`dsh-client-ui-drama` 是短剧创作模式的阅读面板：其浏览器半区在 `conversation.view` 槽位注册 `drama` 入口，使挂载在 `drama` 代理预设上的会话可切换到「短剧」视图阅读项目。左侧列出剧集，右侧打开每集的五份创作文档，并提供对所拥有的 Markdown 的只读投影预览——镜头/资产/提示词数量、可导航诊断（重复 ID、未解析引用）以及 `剧集/<EP>/制作成果/` 下的交付媒体。其主机半区注册三条只读 HTTP 路由（`/drama/overview`、`/drama/episode`、`/drama/document`），服务调用所属会话的工作区；面板同源请求它们。磁盘上的项目约定（`剧集/EPxxx/剧本.md` · `视觉设定.md` · `分镜.md` · `图片提示词.md` · `视频提示词.md`、`.drama/board.json`）归 `drama` 预设及其工具所有；本包只读取它们。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [进一步探索](#进一步探索)
- [模型体验](#模型体验)
- [已知限制与后续工作](#已知限制与后续工作)
- [开发说明](#开发说明)

-----

<a id="使用本包"></a>
## 使用本包

从任一持有短剧项目工作区的会话的视图切换器打开「短剧」视图。头部一行汇总项目（集数与待生产方式数），点「刷新」重读工作区——面板不订阅文件变更，请在 agent 写入或修改创作文档后自行刷新。左侧列表列出各集（带上板阶段与现有文档数）；点击某集加载其投影与现有五份创作文档到子列表，可点击进入阅读区。空工作区显示引导，提示先请 Agent 运行 `drama_scaffold`。

本包是纯查看器，永不承担创作职责：不能创建创作文档或推进板阶段。这些属于 `drama` 预设的工具（`drama_scaffold`、`drama_board`、`drama_episode`、`drama_track`）。

## 理解实现

`src/board.ts` 是主机路由共享的工作区读取器：它归一化 `.drama/board.json`（`normalizeBoard`）、读取板与剧集目录、推导概览、并带字节上限校验并读取单集文档（`sanitizeEpisodeDocumentPath` / `readDocument`）。`src/projection.ts`（`parseEpisodeProjection`）在既有文档之上纯函数推导 `short-drama/v1` 投影：镜头、视觉资产、提示词、跨文档目标与诊断。`src/routes.ts` 通过 `sessions` + `fs` 挂载三条 GET 路由；`src/index.ts`（主机半区）在可选 webServer 的效果中注册它们。`src/client/DramaView.tsx`（浏览器端）请求概览/单集/文档并渲染面板；`src/client/locale.ts` 以 `ui-drama` 命名空间持有全部产品文案。

## 进一步探索

- `drama` 代理预设及其 `drama-tools.js` 定义了本包读取的工作区约定。
- `drama` 的九份创作技能（`short-drama-develop`…`short-drama-review`）拥有投影解析的创作优先语法。

## 模型体验

- 对模型、对用户只读：本包从不修改工作区文件，也不写任何平行创作真值，因此不会破坏 Agent 正在创作的项目。
- 投影为非官方预览：它是对必要 ID 与健康标记的快速预览，并非审计。`drama_track` 仍是出处的工具；面板以此为准，且永不预建缺失文档。

## 已知限制与后续工作

- 投影为只读预览；oh-story 工作台的完整行为（媒体画廊、关系画布、制作任务确认）尚未实现。
- 资产类别（人物/场景/道具）由锚定标题尽力推断，对异常命名可能误分类；原始 ID 始终为准。

-----

<a id="开发说明"></a>
## 开发说明

包内含主机/浏览器两端与三种登记面（`tsconfig.host.json`/`tsconfig.client.json` 引用、`packages/bundle/web-app/cordis.patch.yml` 中 `dsh.client` 行、`packages/bundle/web-app/package.json` 依赖）。「重新运行 `pnpm --filter @deepseek-ai/dsh-client-ui-drama bundle`，然后刷新启用 `dsh web` 页面」以验证实时 GUI 的 bundle 指纹更新。
