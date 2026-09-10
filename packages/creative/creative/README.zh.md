---
description: "面向小说、短剧、互动游戏与视频解说生产的工作台插件。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-creative

[English](README.md) | 中文

## 概述

Creative 为 DeepSeek Harness 提供小说、短剧、互动游戏与视频解说工作流。内置 Skill 与专家 Role 使用 DSH 的工作区、Session、模型、工具和权限；Web profile 还在右侧 Sidebar 提供编辑器、媒体预览与生产卡片。

一个 Creative 页面让混合工作区可以使用全部四个域。跨域工作流共享项目文件和生产设置，无需另开应用（[决策](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.zh.md)）。

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

随附的 `web` profile 包含本 bundle，其 [profile 补丁](cordis.patch.yml)挂载 `creative`。插件注册四个内置 Skill 提供方（`creative`、`short-drama`、`novel-to-game`、`video-recap`）、通过 `creative_role` 提供的专家 Role，以及生产工具。这些注册依赖技能、子代理和工具注册表，不依赖 Web 服务；Session 级 `/creative` API 只在 `webServer` 和 `typert` 可用时注册。

在 Session 中展开右侧 Sidebar，然后在引导页选择**创作工作台**。空工作区也可以打开该页面。从 Chat 打开受支持的 Creative 文件会显示同一个工作台；普通文件链接使用 Sidebar 的文件预览。创建项目文件不会自动打开面板。

小说面板识别工作区根目录、`<book>/`、`长篇/<book>/` 和 `短篇/<book>/` 下的项目。短篇只要存在 `设定.md`、`小节大纲.md` 或 `正文.md` 中的任一文件就会显示。默认文档依次优先选择正文、大纲和其他 Markdown 文件。

```yaml
- id: creative
  name: '@deepseek-ai/dsh-creative'
```

| Field | Default | Meaning |
|---|---|---|
| `editorMaxBytes` | `2097152` | 工作台编辑器可编辑文本文件的最大体积（字节）。 |
| `trustedHosts` | `[]` | 除 loopback 外允许访问工作台 API 的额外 `host[:port]` 授权。 |
| `produce` | `{}` | 初始生产配置与凭据引用；`creative-produce` 设置命名空间提供用户覆盖值。 |

生产设置填写凭据引用，不存放密钥。`AGNES_POOL` 等自定义引用仍向 adapter 提供规范环境变量 `AGNES_API_KEY`；引用改名不会改变子进程变量名。逗号分隔的引用与存储值中按行分隔的密钥组成轮换池（[执行策略](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.zh.md#production-and-credentials)）。

Agnes 视频在未配置模型或解析值为空白时使用免费的 `agnes-video-2.5-flash`。通过 `produce.agnesVideoModel`、对应的 Creative 生产设置或 `AGNES_VIDEO_MODEL` 显式选择模型；`agnes-video-2.5` 按秒计费。

短剧生产要求先通过内置 `production_tool.py` 准备并明确确认任务。向 `creative_produce_run` 传入其 `job_id`、匹配的 `adapter` 和项目 `workdir`；执行器创建已确认输入的快照，在执行前只消费该确认一次，校验并发布产物，然后记录运行。通过 `stdin` 替换任务 JSON 或附加短剧参数都会被拒绝；`argv: ["--selftest"]` 是唯一短剧诊断入口，不接受任务、stdin 或生产上下文。工作台请求或作业绑定不能代替确认。

内置 Agnes 视频执行器在消费确认前校验模型、参数和参考输入。本地校验错误报告具体原因，保留未使用回执，且不创建生产尝试。校验通过后，在启动 adapter 前消费确认，此后无论成功或失败，确认都保持已消费。任务输入变化仍须重新准备并确认。

编辑草稿和冲突在刷新、Sidebar 标签切换后保留。完整列表可以把草稿对应的文件标为缺失，但不会丢弃未保存文字；截断列表不能证明文件已删除。保存以最后确认的文件版本为基础，并发磁盘修改需要解决冲突，不会被直接覆盖。

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
| `src/client/index.ts` | 浏览器插件入口；`workbench.tsx` 负责工作台 UI 与注册。 |

Creative 以 `@deepseek-ai/dsh-creative` 为键，注册 `creative` 页面类型及其 `sidebar.right.pane.tab` 内容。[右侧 Sidebar](../../client/ui-sidebar-right/README.zh.md)拥有布局，并通过参数和 revision 传递文件导航。Session 级 `creative.workbench.v2` store 保留编辑缓冲区、冲突、选中项和生产草稿；进行中的保存锁属于 Session 的非持久化 inject face，因此标签重新挂载不会重复保存，刷新也不会恢复过期的保存中标记。[编辑器协调逻辑](src/client/editor-buffer.ts)按观测到的文件版本读取内容。样式通过 Client 样式表导入加载一次。Chat 与 Composer 保持在自己的列中（[决策](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.zh.md#workspace-and-sidebar)）。

Host 与 Client 共用 [project-path.ts](src/project-path.ts) 解析项目根、相对路径、领域和文件角色。工作区 API 按项目返回元数据；一本书的 `short-drama.json`、大纲和追踪文件属于该书。剧集选择、镜头选择、草稿和素材筛选使用完整的工作区相对项目/剧集路径，因此重名的 `EP001` 或 `SHOT-001` 不共享状态。Host 读写另行检查扩展名白名单和解析后的文件系统包含关系，包括符号链接目标；正文、对应大纲和追踪文件必须属于同一项目。

工作区列表先排除依赖、Python 缓存、隐藏目录及视频工作目录，再应用文件预算。媒体属于 Session 的文件系统 provider：只有 provider 明确把 Host 路径映射到执行环境中的同一文件时，才允许 Host 直接流式读取；否则通过 provider 读取字节。仅有相同的 Host 路径名并不足够（[归属决策](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.zh.md#project-and-file-ownership)）。

生产卡片按 Session 持久化请求草稿，不保存执行状态。每张卡片拥有 `ProductionRequestId`；准备消息拥有独立的 `SessionRequestId`，通过 `rpcId` 关联队列中的消息实例。确认后的后台执行返回真实的 `{ jobId, startedAt }` 引用。增量 Conversation 投影从 Native 结果元数据或 PTC 同样保留的小型 JSON 内容恢复绑定。完整控制基线到达后，只有 Session Controller 的 `jobsBySession` 提供运行、停止中和终态。一张卡片可包含多个作业；已登记作业结束不证明全部计划素材成功。素材库仍是独立的文件视图。

停止操作使用受信任的 `/creative/job/stop` 入口；该入口验证 Session 所有权和精确作业引用后调用 `jobs.kill`，界面等待真实状态更新。撤回准备消息只移除已识别的队列实例。已受理但未绑定作业的请求没有停止生成操作。这两项操作都不取消对话，也不消费作业输出。

Role 继承调用方的 DSH 模型，`creative_role` 只接受 `role` 与 `prompt`。资料研究使用可见的 `web_search`、`web_fetch` 或调用者提供的材料。需要浏览器交互的页面交回调用方，由其加载 `browser-cdp` 并提供获取的内容；研究 Role 不假设浏览器端口或会话。

Role 通过 `creative_bundled_reference` 读取内置参考资料，不访问工作区部署目录。小说检查在技能本地入口后共用打包的[小说脚本](knowledge/creative/scripts/)；JavaScript 按 ESM 运行，质量检查不可用或结果格式无效时阻止章节交付，不视为通过。

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

技能通过 `ctx.skills` 发现，由 `skill` 加载。四个领域共用调用说明：工作流名称及 `$name`、`/name` 引用表示 Skill；`creative_role` 只委派七个内置小说专家。委派阶段任务时使用 `subagent`，在自包含任务中要求子 Agent 加载指定 Skill。生产投影由 `creative_production` 提供。[四个内置 provider](src/skill-provider.ts) 从 `SKILL.md` 读取描述和完整正文，在正文前附加共用调用说明与各域的 DSH 集成说明；逐技能行为写在 Markdown 中，不由运行时替换（[决策](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.zh.md#composition-and-knowledge)）。

#### Token effect

发现阶段提供简短描述；36 个条目都符合默认目录的 500 字符限制。`skill` 加载时才把对应正文作为工具结果加入上下文，不替换目录消息，也不预载全部正文；`creative_role` 在子回合中加入所选 Role 的 persona。

#### KV Cache effect

No direct prompt effect from this package alone. The `skill` catalog message and tool results are durable context; subagent delegation via `creative_role` adds a nested turn whose KV entries are scoped to that child.

### Production projection tool

#### What the model sees

`creative_production` 提供四种投影意图（`open_section`、`focus_target`、`set_sequence`、`track_job`），校验包含完整项目路径的 `episode` 及 `targetId` 字段。`track_job` 要求作业已经存在、归当前 Session 所有，并携带生产请求身份；合成命令先在后台启动，再登记。`creative_produce_run` 只在显式后台模式下接受可选生产上下文，并返回实际作业绑定。前台结果保留 `exitCode`、`timedOut`、终止 `signal` 和有界 stdout/stderr。Produce 将非零或未知退出码记为失败。通用命令的 `completed` 状态只表示进程结束，不表示素材生成成功。两个工具的生产上下文都不授权付费生成。

#### Token effect

成功的生产结果向工具历史添加小型请求、目标和作业引用 JSON；其他意图移动浏览器工作台焦点，不向模型上下文添加文档内容。

#### KV Cache effect

Projection intents are tool calls whose results carry the confirmation message; they do not add persistent context beyond the Session's tool history.

### 生产凭证状态

#### What the model sees

`creative_produce_status` 报告短剧适配器（包括 `agnes-image`、`agnes-video`）及 MiMo、Fish 视频提供方的凭证状态。它使用生产执行配置的凭证解析顺序，不返回密钥，也不启动进程。普通 shell 环境检查不能查看受管理的凭证库；缺失密钥应在 Creative 生产设置中填写，不放入聊天。

#### Token effect

每次调用追加一份小型 JSON 状态结果，不请求模型或媒体供应商。

#### KV Cache effect

状态按普通工具历史记录。每次检查重新解析当前凭证，不修改既有消息；凭证存在不证明供应商连通，也不授权生产。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Client UI 文案归 locale 所有；操作性失败文本保持 zh-Hans** — 工作台界面文案经 `creative` locale 命名空间渲染（中英双语），而服务端错误体、运行时诊断与抛出的错误在 `/creative` 路由提供稳定错误码之前保持 zh-Hans 协议文案。
- **大型知识库与 Demo 资源被打包** — `knowledge/` 树与 `jin-ping-mei` Demo 增大了克隆体积；未来迭代可能改为按需获取而不改变 provider 契约。
- **浏览器自动化依赖外部程序** — `browser-cdp` 要求会话的执行环境中存在兼容的 `agent-browser` 与 Lightpanda，二者均未打包。它不复用 Chrome profile，也不提供游戏 QA 所需的完整视觉渲染。版本、启动与会话说明由技能持有。
- **作业只在当前进程内存在** — 刷新和重连等待完整控制基线。Host 重启后，无法匹配实时作业的日志绑定显示状态不可用，绝不自动重跑。没有真实绑定的历史 `track_job` 记录只保留为请求，不作为执行证据。
- **预览运行状态跟随标签页挂载** — 切离 Creative 时可能卸载游戏和视频预览。返回后恢复持久化编辑状态并重新加载预览，不恢复其内存运行状态。项目首次出现可用视频时会填充空预览；后续版本等待用户明确切换。Sidebar 布局与可见性遵循上游的页面生命周期策略。

- **远端执行有明确的资源限制** — 通过 provider 回退读取的媒体每个文件最多为 256 MiB。Skill 暴露打包资源路径；远端 shell 需要将这些资源挂载或复制到自己的文件系统。工作区读取遵循 provider，并不代表内置脚本已传入远端沙箱。

- **视频确认仍由指令约束** — 视频入口保留脚本参数，由 Skill 要求创作者确认；不使用短剧执行器的一次性确认和账本。工具每次调用只执行一次视频脚本，密钥池只在调用之间轮换。
- **生产重试需要明确的拒绝证据** — 单次已确认短剧运行中，只有标记为 `submission_rejected` 的首次提交鉴权、权限或限流拒绝才能触发密钥轮换。已受理的提交、轮询、下载和结果不确定的失败均不自动重新提交，也没有外层进程重试。[执行决策](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.zh.md#production-and-credentials)定义拒绝条件和密钥池限制。
- **视频阶段入口有限** — 工具提供完整 recap、配音与诊断入口，没有独立理解或语义评审入口。已有下游输入时，不能为单独分析而启动会继续生成的完整流程。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

知识库清单列出技能、角色和示例，可附备注；Git 记录内容与变更（[决策](../../../.agents/notes/implemented/feature/2026-09-03-creative-workbench.zh.md#composition-and-knowledge)）。内置游戏示例使用稳定的 `bundled` 预览标识，不使用上游提交号或内容摘要。`production-tool` 仅改变 Session 投影，永不变更创作者文档或被视为付费生产的确认。

</details>
