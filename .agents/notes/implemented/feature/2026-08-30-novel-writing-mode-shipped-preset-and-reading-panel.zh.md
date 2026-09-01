# Agent Note：小说创作模式 = shipped 预设 + 阅读面板

Status: implemented

[English](2026-08-30-novel-writing-mode-shipped-preset-and-reading-panel.md) | 中文

## Problem

Harness 已经随附 Agent 预设（见 [per-session agent presets](../architecture/2026-08-03-per-session-agent-presets.zh.md)），但每个 shipped 预设组合的都是同一条工程回路：shell、文件系统、规划、委派。写长篇小说是另一条回路——工作产物是手稿与账本而不是代码，而且作者要在会话记录之外阅读它们。需求是一个小说创作模式：在一台新机器上只凭仓库本身就能用——clone、`pnpm install`、`pnpm dsh web`，模式即存在，带着写作技艺 skill、它的工具，以及阅读小说的方式。

三个设计问题此前没有 shipped 答案：

1. 只属于一个预设的模型工具应该放在哪里？
2. 浏览器界面如何读取某个会话的手稿，而不新造一条传输接缝？
3. 写作状态——章节状态、伏笔账本——由什么持有，才能让面板与工具永不互相矛盾？

## Decision

**模式 = 一个 shipped 预设 + 一个 client 包，别无其他。** `packages/preset/agent-presets/presets/novelist/` 组合写作回路：persona、经 `customSkillDirs` 的 `!!js baseUrl` 模式从预设自己的 `skills/` 目录加载的十三门写作技艺 skill、有意去掉的 planning 组（plan-mode 语义是工程回路），以及为一处模式内用途保留的 delegation 组——多视角审查并行派发四个角色视角。skill 集覆盖完整生命周期：扫榜选题、拆解已有作品、立项、大纲、人物、分章写作、修订、连续性审查、多视角审稿、去 AI 味、稿件导入、短篇写作、封面简报。跨机器分发就是仓库本身；没有安装器。

**Preset 相对文件插件是 preset 专属模型工具的家。** `plugins/novel-tools.js` 位于预设目录内，以相对行（`./plugins/novel-tools.js`）引用。因为预设目录不带 `node_modules`，该文件零 npm 依赖——Node 内建经 `process.getBuiltinModule` 获得，仅有的服务是注入的 `tools` 注册表与 `ctx.fs`。工具路径按调用 agent 的会话工作区解析（`exec.agent?.session.header.cwd`，与 `dsh-tool-fs` 同一规则），绝不 `process.cwd()`；文件操作走 `ctx.fs`，沙箱后端继续执行其策略。未来的 preset 专属工具应照抄此模式；`customSkillDirs` 技巧与这一行共同构成一个约定。

**写作状态放在工具持有的唯一持久账本里。** `.novel/board.json` 是单一事实来源，只能经 `novel_board_read` / `novel_board_update` / `novel_track` 以版本守卫写入。除章节状态与伏笔账本（`F01`… 编号，已埋/已推进/已回收状态、重要度、计划回收章）外，状态板承载追踪协议：角色快照（身份、位置、目标、状态、能力、关系、认知、未决线）、双时间线（作者真相事件带读者可见揭示状态；读者视图绝不显示未揭示事件）、逐章记录，以及七栏上下文卡（位置、长期约束、活跃角色、连续性风险、近章、下一章承诺）。事务化的 `novel_track commit` 重读正文文件、按可见字符计字（与 `novel_wordcount` 同口径）、执行字数带（内带 ±12%、用户带 ±15%；带外提交需作者显式 `acceptCurrentLength`）、递增 `stateRevision`，并重建 `.novel/` 下全部派生视图——派生视图工具持有、绝不手改；`novel_track check` 比对渲染内容，手改经 revision 事务治愈。作者记忆（`.story/author-memory.json`，prose_style/story_design/workflow 三类）经 `novel_memory` 以记录→回执契约跨会话存活。`outline.md` 是人写的那一半，skill 固定裁决规则：两者冲突时以状态板为准。读取侧（`packages/client/ui-novel/src/board.ts`）把 `chapters/*.md` 字数与状态板状态连接成章节行，未知状态板形态降级为默认值而不是让面板失败——状态板是作者会手改的持久文件内容。

**面板经两条 webserver 路由读取，不新造传输。** `@deepseek-ai/dsh-client-ui-novel` 的 node 半部注册 `/novel/overview` 与 `/novel/document` 两条只读精确路由，工作区经 `ctx.sessions.get(id)?.header.cwd` 解析；webserver 是可选读取，因为无传输的启动（headless、CLI 测试脚手架）必须照常挂载面板条目，只是没有路由。`/novel/document` 服务一个经净化的工作区相对 `.md` 文件（拒绝穿越、拒绝非 `.md`、200 KiB 上限），同一个端点覆盖章节、大纲、人物小传，以及工具生成的追踪视图（上下文卡、角色快照、伏笔表、双时间线、逐章记录），面板以「追踪」标签列出。浏览器半部经 `slots.inject` 把名为 `novel` 的条目装进 `conversation.view`——贡献随槽位声明消失而回收；不建 store：挂载时一次 overview 请求、每个打开行一次文档请求，手动刷新，因为面板有意不订阅文件事件。

**有真实 node 半部的 client 包拆分编译面。** ui-novel 是第一个 `src/index.ts` 做实事（经 `webserver`/`sessions`/`fs` 注册路由）的功能插件，因此单 `tsconfig.base.client.json` 叶子不再成立：node 文件引入 `node:http` 与 client 程序不得编译的 host 服务。沿 `client/connection` 先例，该包现在带 `tsconfig.host.json` 与 `tsconfig.client.json` 两叶（host：`board`/`routes`/`index`/`invariant`；client：`board`/`client/**`）加 solution-only 根，聚合直接引用叶子。`board.ts` 是共享文件并刻意浏览器安全——截断用 `TextEncoder` 逐字节回退，不用 `Buffer`。这是下一个长出 node 半部的功能插件的现成范例。

## Alternatives considered

**独立 `novel-kit` 目录加安装器。** 最初方案把预设与面板做成仓库外的 kit，配 `install.sh` 与自定义 npm scope。它输给仓库集成，输在用户在意的每一条：`pnpm install && pnpm dsh web` 之后一切自动加载，升级随 `git pull`，仓库门（constraints、typecheck、coverage、doc-sync）把新代码拉到同一标准。自定义 scope（`@winterhuan`）在仓库内本就不可行——工作区门硬编码 `@deepseek-ai/dsh-` 前缀——所以 kit 变体只是多了一个安装器，没换来独立性。

**共享状态板 schema 包。** 把状态板归一化导出成 npm 包、由预设文件与 client 包共同导入，可以只留一份形状。否决：preset 相对插件完全不能导入 npm 包，共享包只服务 TypeScript 侧，预设文件仍要自带一份——两处副本的结局不变，还多了一条依赖边。形状契约很小、经 `formatVersion` 版本化、两侧都有测试。

**deliverables 式会话记录表面而非视图。** 把章节渲染成 Chat 节点会把手稿文本送进会话日志，并把阅读耦合到会话窗口。否决：手稿本来就活在文件里；覆盖工作区的视图即刻读到任意章节、不占会话日志、KV-cache 故事为零（面板不添加任何模型可见内容）。

**事件驱动的面板刷新。** 让视图订阅 `tool/result` 以在每次 Agent 写盘后刷新，看似实时，却把面板耦合到它并不持有的工具词汇，且无关工具调用也会触发重渲染。手动「刷新」加视图重挂已覆盖阅读流；只有当作者把陈旧报告为真实摩擦时再回头。

## Consequences

写作模式的状态模型现在是三方依赖的契约：预设工具以版本守卫写 `.novel/board.json`，面板的 `src/board.ts` 以形状容忍读取（并共享可见字符计字口径），skill 固定裁决规则（状态板优先于 `outline.md`）。任何 schema 变更必须在同一个 PR 内移动这三者加 `formatVersion`。Preset 相对插件约定（零 npm 依赖、`process.getBuiltinModule`、会话 cwd 解析、变更走 `ctx.fs`）是下一个 preset 专属工具照抄的模板；ui-novel 的 split-face tsconfig 是下一个长出 node 半部的功能插件的现成范例——「普通两入口 client 插件不拆分」的规则现在有了 `client/connection` 之外的第二个成文例外形状。面板不添加任何模型可见内容，因此该模式的 token 与 KV-cache 故事恰好就是它的 persona 与 skill；作者在会话记录之外看到的一切都走那两条只读路由，传输接缝新增为零。接受的代价：状态板形状因必然而存在两份，靠测试与共享的 `formatVersion` 维持兼容；面板的新鲜度按设计是手动的，直到文件事件订阅证明自己的复杂度值得。

同一个变更还澄清了一个组合文件既有消费者的契约：webworker packer 的名册扫描把任何含 `/` 的行 `name` 读作包标识，于是预设的相对文件行 `./plugins/novel-tools.js` 以无法解析的名字 `.` 进入打包依赖闭包；扫描现在把 preset 相对行留给其预设目录（packer 测试固定），这是未来每个带文件工具的预设的长期规则。
