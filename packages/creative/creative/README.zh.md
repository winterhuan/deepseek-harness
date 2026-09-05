---
description: "面向小说、短剧、互动游戏与视频解说生产的工作台插件。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-creative

[English](README.md) | 中文

## 概述

creative 插件在 DeepSeek Harness 上聚合了小说、短剧、互动游戏与视频解说工作台。它打包了固定的 Skill 与专家 Role、Host 侧的钩子/工具/路由以及 Browser 工作台，而 DSH 负责工作区、会话、模型、工具与权限。

四个域刻意放在一个插件里：真实管线是跨域的（小说改游戏、短剧的视频解说、图片与视频共用的分镜 `SHOT-` 编号），按域拆包会正好切在产品流动的地方。共享的 Host 路由、信任、密钥透传、确认门和 Client store 是自有资产；按域划分的 Skill、工作室、adapter 是接缝。只有两条绊线才拆：单 mode 生命周期状态在共享 store 里堆积（拆 store 切片），或设置命名空间撑满一张卡片（拆命名空间）。存在性判定保持 workspace 级，绝不按 mode 细分，混合 workspace 保留全部 tab。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

---

<a id="use-this-package"></a>
## 使用本包

在 DSH profile 中挂载 `creative` 以启用创作工作台；随附的 `web` profile 已默认包含它。插件注册四个捆绑的 Skill 提供方（`creative`、`short-drama`、`novel-to-game`、`video-recap`）、通过 `creative_role` 提供的专家 Role、通过 `creative_production` 提供的生产意图，以及挂载于 `/creative` 的会话级工作区路由。

```yaml
- id: creative
  name: '@deepseek-ai/dsh-creative'
```

| Field | Default | Meaning |
|---|---|---|
| `editorMaxBytes` | `2097152` | 工作台编辑器可编辑文本文件的最大体积（字节）。 |
| `trustedHosts` | `[]` | 除 loopback 外允许访问工作台 API 的额外 `host[:port]` 授权。 |

---

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| `src/skill-provider.ts` | 四个捆绑的 `SkillProvider` 实现与 DSH 桥接注入。 |
| `src/role-tool.ts` | 通过按 Role 的工具过滤进行 `creative_role` 子代理委托。 |
| `src/reference-tool.ts` | 针对 `story-setup` 代理参考资料的固定捆绑参考资料读取器。 |
| `src/production-tool.ts` | `creative_production` 投影意图。 |
| `src/workspace-route.ts` | 会话级 `/creative` HTTP API，负责列举/读取/写入创意文件与媒体预览。 |
| `src/native-hooks.ts` | 针对长篇写作不变量的工具瀑布守卫。 |
| `src/client/` | 浏览器工作台 UI（文件树、Markdown/JSONL 预览、短剧生产、游戏/视频工作室）。 |

工作台只在 workspace 真有创作内容（小说/短剧文件、工作区游戏项目或视频项目；内置游戏示例不算）时才占用会话布局。任何工作台都可以收起到只剩一个浮动入口，把会话原样交还给 DSH；显式的打开/收起选择优先于自动判断，并按 workspace 记在浏览器本地存储里。

No runtime invariant companion is published. 插件不拥有可通过 Cordis 监听器比较的跨进程事件序列或独立维护的可变关系；状态在每个操作内由 Session、Skill 注册与文件系统派生。

</details>

---

<a id="further-exploration"></a>
## 进一步探索

- [Creative group map](../README.zh.md) — 包族概览。
- [DeepSeek Harness Architecture](../../../docs/architecture.zh.md) — 组合与扩展点。

---

<a id="model-experience"></a>
## 模型体验

### Creative skills and roles

#### What the model sees

Skills are surfaced via `ctx.skills` and the `skill` tool; specialist Roles via `creative_role`; production projection via `creative_production`. The four bundled providers inject DSH-owned bridges (`DSH_*_BRIDGE`) and per-skill overrides declared in `src/skill-provider.ts:15`.

#### Token effect

Each `skill` load replaces a short catalog entry with the full instruction body; `creative_role` adds a nested turn whose prompt carries the selected Role persona. Only the requested skill or role body enters the context window.

#### KV Cache effect

No direct prompt effect from this package alone. The `skill` catalog message and tool results are durable context; subagent delegation via `creative_role` adds a nested turn whose KV entries are scoped to that child.

### Production projection tool

#### What the model sees

`creative_production` exposes four projection intents (`open_section`, `focus_target`, `set_sequence`, `track_job`) with validated `episode` and `targetId` fields. The tool never mutates creator documents and does not authorize paid media generation.

#### Token effect

A `track_job` call records the job the agent is actually executing; other intents move the Browser workbench focus without adding document content to the model context.

#### KV Cache effect

Projection intents are tool calls whose results carry the confirmation message; they do not add persistent context beyond the Session's tool history.

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Client UI 文案为产品特定且归 locale 所有** — 工作台有意渲染中文文案；未来的 locale 过程会将字符串抽取到 `locales/`。
- **大型知识库与 Demo 资源被打包** — `knowledge/` 树与 `jin-ping-mei` Demo 增大了克隆体积；未来迭代可能改为按需获取而不改变 provider 契约。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

保持 `knowledge/` 通过 `manifest.json` 的上游提交固定，并在文件头部注明上游 SHA。`production-tool` 仅改变 Session 投影，永不变更创作者文档或被视为付费生产的确认。

</details>
