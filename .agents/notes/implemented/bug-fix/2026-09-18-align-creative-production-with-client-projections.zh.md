# Agent Note: 让 Creative 生产流程对齐当前 Client 投影

Status: implemented

[English](2026-09-18-align-creative-production-with-client-projections.md) | 中文

## 问题

当前 DSH 已把对应状态交给 Session 投影、submission handle 和组装后的 Chat 节点，但 Creative 生产看板仍在适配若干已退役或仅供兼容的 Client 表示。`productionQueueFromInbox` 同时折叠两个待处理 Inbox 列表，而生产准备使用 `queue` delivery；它会在创建本地 prompt 回显后丢弃 `SubmissionHandle.abandon()` 逃生入口；`creative.workbench.v2` 会永久保存每个已消费生产调用的 id；活动工具则来自 `ChatSnapshot.legacy.runningCalls`。这些路径会为 steering 消息暴露撤回入口、在 prompt dispatch 于正常结算前抛错时残留本地 submission 回显、让本地存储随 Session 历史增长，并让 Creative 耦合兼容投影。

现有身份与归属区分仍然成立。生产卡片拥有 `ProductionRequestId`，一次 prompt admission 拥有独立的 `SessionRequestId`，一条待处理 Inbox occurrence 拥有 `MessageId`，一次执行绑定拥有 `{ jobId, startedAt }`。Session 日志继续作为生产意图与绑定的权威来源；Job 控制基线继续作为实时执行状态的权威来源；Creative store 仅作为草稿和用户展示选择的权威来源。[Creative 工作台决策](../feature/2026-09-03-creative-workbench.zh.md#production-and-credentials)定义这些规则。

## 决策

Creative 生产读写当前 DSH Client API，不改变生产授权、作业归属、工具 schema、Session 事件或已持久化的 Session 格式。

### 队列对账只折叠 `next-turn`

`productionQueueFromInbox` 只从待处理的 `next-turn` 消息派生 `ProductionQueueEntry`。生产准备使用 `queue` delivery，因此 `next-step` steering 消息永不显示为排队准备项。每行保留其 occurrence 的 `MessageId`；`rpcId` 只从浏览器提交的 user source 复制，并使用标准 QueueDock 对 wire 行执行的同样窄的类型断言。`queuedItemForRequest` 继续只按精确的 `SessionRequestId` 连接卡片与待处理 occurrence，绝不按 prompt 文本、目标标签、顺序或时间推断。投影缺失不产生任何行，也不推断 pending 项或 admission 失败。

任务看板在相关 `next-turn` occurrence 仍待处理时把准备项显示为排队中，只为该 occurrence 提供撤回入口，并在 Host 移除该 occurrence 后回到已受理状态。

### 一个 Session 级操作完整拥有 submission handle

注入 face 把 `beginSubmission()` 返回的整个 `SubmissionHandle` 保存在按请求索引的映射里。生产视图同步读取 handle 的 `requestId`，以便在 dispatch 前持久化卡片，但只有所有者能撤销本地回显。当 Session 查找、序列化、传输或其他异常阻止正常 prompt 结算时，`sendProductionPrompt` 在继续抛出失败前调用 `abandon()`；`RemoteResult` 拒绝属于一次结算，继续使用 `Session.prompt()` 的具名 submission 淘汰逻辑。失败卡片仍然保留并记录诊断，Creative store 中没有重新实现任何 pending-submission 状态机。

### 单调 sequence 游标取代已消费 call-id 台账

每条投影生产结果把自身 Session sequence 贯穿 `productionDefinition`、`productionCallDefinition` 和 `creative-production` view。`creative.workbench.v2` 用最后应用的最高 sequence `productionIntentSeq` 替换 `productionIntentCalls: Record<callId, boolean>`。第一次 materialization 按 Session 顺序应用成功的导航与顺序意图；后续 publication 只应用游标以上的结果，`track_job` 结果在贡献其持久请求与绑定数据后仍推进游标。旧台账先从匹配的投影结果播种游标再被删除，当事件位于已加载窗口之外时退化为当前投影的最高 sequence；没有消费证据的 store 应用当前投影一次。persistence key 未变更，编辑缓冲区、冲突、生产草稿、选择、引用、画布位置和布局选择全部保留。

### 活动工具根来自正式 Chat 节点

`runningRootCalls` 一次性读取 `snapshot.nodes.values()`，用导出的 `isRunningTool` 判别器派生可见的、仍在运行的工具根，并按 Chat anchor sequence 排序。嵌套 PTC 遍历、流式 mutation 预览、跳过 live render 的调用所需 settled-result 降级、脏草稿冲突行为与结算后工作区刷新均未改变。Creative 中没有复制任何 legacy slice builder。

## 保留的实现

继续区分 `ProductionRequestId`、`SessionRequestId`、`MessageId` 与 `{ jobId, startedAt }`。保留 Native metadata 与 PTC JSON 解码、`jobsBySession` 加 `sessions.jobsBaseline` 就绪订阅面、进程丢失后的 `unavailable` 状态、CAS 编辑缓冲区和不消费输出的定向停止作业端点。这些实现都不重复本笔记所替换的 Client 投影。

Creative 继续拥有其工作区 HTTP 路由。通用 `workspaceFiles` Remote 没有 CAS 写操作，也无法替换 Creative 的按领域过滤的递归清单、项目摘要、可配置编辑上限、大 Range 媒体响应、视频预检和 CSP 隔离的游戏预览。live 工具参数投影对结算前的编辑器预览仍然有用；文件观测只能替换后续失效信号，而不是该预览。

## 结论

- 由 `SessionRequestId` 关联的生产准备项从 `inbox` 投影显示为排队中，且只能移除自身的待处理 occurrence；steering 消息永不提供撤回入口。
- 每次生产提交要么到达 `session.prompt()` 结算，要么调用 `SubmissionHandle.abandon()`，抛错的派发不残留本地回显。
- `creative.workbench.v2` 用一个数字取代每个生产调用的布尔值，既有持久化草稿、选择项、引用、画布位置与布局选择在就地迁移后全部保留。
- 生产导航对每个新投影 sequence 只应用一次，标签重新挂载时不重放已消费的历史。
- Creative 从正式 Chat 节点读取活动调用，生产路径不依赖 `ChatSnapshot.legacy.runningCalls`；被 Chat store 标记为 hidden 的行不再参与派生，因此工作台显示的活动调用可能少于被替换的兼容切片。
- 生产授权、prompt 模式、工具 schema、Session 事件、作业绑定身份、作业状态归属、文件 CAS 行为与预览安全均未改变。

## 测试

聚焦 Client 测试覆盖 Inbox 投影映射、`next-turn` 中精确的 `rpcId` 关联、排除 `next-step`、投影缺失、只作用于精确 occurrence 的成功撤回、抛错 prompt 与正常 `RemoteResult` 拒绝（两者都保留失败卡片，只有抛错留下需要 `abandon()` 撤销的本地回显）、严格 sequence 排序、一次性初始应用、游标之上的增量应用、重新挂载不重放导航、保留全部字段的旧 call-id 迁移、替换窗口、同一请求的多个作业绑定，以及覆盖根 mutation、嵌套 PTC mutation、快速结算 mutation、hidden 行的排除和非 mutating 调用的正式 Chat 节点派生，全程不读取 `snapshot.legacy`。由于本次改动同时改变产品可见的 GUI 行为，实现 PR 需附加来自真实 Web profile 的必需录制 GIF，并更新录制的 Web Session 与 ARIA 期望。

## 已考虑的替代方案

- **保留空队列，直到出现新的队列专属 Client store** —— 拒绝：持久 Inbox 投影已经承载 Host 寻址的待处理 occurrence，并且是标准 QueueDock 使用的来源。第二个队列镜像会恢复 DSH 已移除的重复状态。
- **通过 Conversation composer 服务提交生产** —— 拒绝：工作台需要在派发前持久化自己的 `ProductionRequestId` 与 prompt 规格，而 composer 服务拥有编辑器草稿与附件。共享 Session 提交生命周期已经足够；共享整个 composer 会混淆无关的状态所有者。
- **持久化每个已应用 call id** —— 拒绝：Session sequence 已经提供单调游标，而 call-id 集合随历史增长并需要永久的逐结果记账。
- **从 timeline 重建运行调用或复制 legacy builder** —— 拒绝：正式 Chat 工具节点已经承载组装后的运行/已结算树。再推导出第三份工具生命周期表示是不可接受的。

## 风险

Inbox 投影值以 JSON 安全数据穿越 Remote，需要与当前 Conversation 使用者同样的窄类型断言；把任意 `source` 数据当作浏览器提交，可能为无关消息暴露撤回入口。精确的 `source.kind` 与 `rpcId` 检查限制了该风险。

用 sequence 游标替换 call-id 台账时，如果迁移从不完整的历史窗口猜测，可能重放或跳过导航。因此迁移区分空的全新状态与先前的非空消费证据，并只对无法匹配的旧证据使用可见的最高 sequence；测试覆盖裁剪与前插窗口。

迁出兼容 running-call 切片会改变更新身份与副作用频率，而且其可见根过滤是一次刻意的行为变更，而非等价翻译：被替换的切片会发布它收集到的每个运行根，包括 hidden 行。现在隐藏的运行调用不再贡献工作台 mutation，而 Chat 会话流仍然渲染该调用，因此被折叠或过滤的行可能使其活动 mutation 在此处不被显示。把 Chat 节点集合作为单个稳定快照值读取，使结算触发恰好一次权威刷新并保留流式预览；聚焦的 Chat 节点测试已把该排除行为钉住，避免其被静默改回。

Creative 继续拥有部分读取与失效代码，直到标准 Workspace Files API 能在不丢失 CAS、配额限制、远程文件系统行为或预览安全的前提下替换完整职责。
