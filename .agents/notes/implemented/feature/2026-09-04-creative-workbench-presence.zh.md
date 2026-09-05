# Agent Note: 创作工作台只在有创作内容时占用布局

Status: implemented

[English](2026-09-04-creative-workbench-presence.md) | 中文

## Problem

装上 creative 插件后，每个 Session 都变成写作台：`CreativeWorkbench` 无条件渲染 split surface（空文件树加一句“还没有小说文件”也算），样式表把含该 surface 的会话滚动容器一律改写成三栏网格。写代码、看普通回答、在毫无创作内容的 workspace 里，官方 Chat 被挤压且关不掉、没处收起。同类缺陷隔壁 `zenstory-ai/oh-story-dsh#30` 刚修过；本次把它的三条验收标准搬到 in-process 工作台。

## Decision

**存在性决定挂载。** `src/client/workbench-presence.ts` 收敛纯判定：小说/短剧文件、工作区游戏项目或视频项目任一存在即 `hasCreativeProject`；显式选择永远优先于自动判断；DSH Session Store 不持久化，所以选择按 workspace 记在 `localStorage`，读写都容忍站点数据被禁。bridge 把 workspace 请求上提，在得知 workspace 的同一 render 里算出 `open`，收起的工作台永远不会闪一下再关。

**收起即卸载。** 无创作内容、无 workspace 报错时直接返回 `null`；否则只渲染带 `data-open="false"` 的 launcher surface。所有布局接管选择器都要求 `.creative-split-surface[data-open="true"]`，收起在结构上就拆掉了网格；收起的 bridge 只发布会话列角落几何给浮动入口。文件链接捕获、Chat DOM 改写、存盘快捷键只在打开时挂载（脏草稿的 `beforeunload` 故意保持全局：卸载前不可见）。

**四个工作台都能收。** 小说/短剧品牌栏、游戏工具栏、视频工具栏各加一个收起控件写 `closed` 偏好；launcher 写 `open`。游戏/视频懒 mount 不变。

## Alternatives considered

**设置里加全局可见开关。** 否决：正确默认值因 workspace 而异（小说目录要工作台，代码 checkout 不要），全局开关答错了问题。按 workspace 记忆＋显式覆盖两者兼顾。

**CSS 隐藏但保持挂载。** 否决：观察者、监听器、workspace 轮询会在看不见的面板后继续跑，`:has()` 选择器还要另起一套门控词汇。卸载让“收起”是结构性的，不是化妆术。

## Consequences

- `src/client/workbench-presence.ts` 由 `tests/workbench-presence.client.spec.ts` 全覆盖；组装行为由 keyless 的 `snapshots/web/workbench-presence` 场景钉住（`workbench-presence.e2e.ts` 经 `workbench-presence.overlay.yml`）：空 workspace 原生会话、同会话 Agent 写首文件后接管、收起恢复、偏好过 reload，外加 `workspace.expected` 树 oracle。
- 非创作会话零创作 DOM、零 workspace 驱动监听器；Agent 写出第一个创作文件后，同会话内自动接管布局。
- README 已记录存在性规则；`test:web` replay 必须保持绿色，因为组装后的会话输出归它所有。
