# Agent Note: creative 分支加固与简化

Status: proposed

[English](2026-09-26-creative-branch-hardening.md) | 中文

## 问题

`creative` 分支在上游 `master` 之上承载了九个提交（约 950 个文件，[`packages/creative/creative`](../../../../packages/creative/creative/) 约 3.8 万行源码，外加 [`skill-viewer`](../../../../packages/skill/skill-viewer/) 与 [`ui-skill-viewer`](../../../../packages/client/ui-skill-viewer/)）。完整审查发现：已知未修复的覆盖率欠账会阻塞下一次上游合并、一处治标不治本的运行时修复、文档脱节、删除随包游戏示例留下的死代码，以及工作台 UI 的若干正确性问题。本笔记盘点分支内容、记录带证据的核实结论，并把优化工作排成有序的小批次。本笔记是对已落地的 [creative 工作台决策](../../implemented/feature/2026-09-03-creative-workbench.zh.md)与[客户端投影对齐](../../implemented/bug-fix/2026-09-18-align-creative-production-with-client-projections.zh.md)的延伸，不取代其中任何一份。

## 分支盘点

| 提交 | 范围 |
|---|---|
| `69d850bcfb` fix(tools) | 内部调度器键由 `Symbol()` 改为 `Symbol.for()`，让源码启动的 Host 与构建产物 Loader 插件对齐 |
| `0c5854a0bc` feat(client) | 在 `ui-chat` 增加 `conversation/open-file` waterfall 槽位；creative 借此拦截文件打开 |
| `a4768b93f1` feat(skills) | 新包 `skill-viewer` + `ui-skill-viewer`：会话级只读技能面板 |
| `3be366a74d` feat(creative) | 包本体：host 工具/路由、React 工作台、660 个文件的随包知识库 |
| `c92ffad26e` feat(web) | 把 creative 纳入 Web 发布 profile 及 tsconfig 接线 |
| `4352931d0a` test(creative) | 录制的工作台/生产快照夹具，host 与 client 规格测试 |
| `eb5ca75422` docs(creative) | 子系统文档与生成的配对记录 |
| `c74343da7c` fix(build) | `clean` 按 `outDir` 清理仅声明产物的夹具输出 |
| `0662c5527c` chore(creative) | 删除随包游戏示例与一个未使用的技能 |

## 实现问题

按严重度排序；每条均于 2026-09-26 对工作区树重新核实。

1. **creative 覆盖率门禁为红。** CI 的每文件 100% 门禁覆盖该包（它不在 `vitest.config.ts` 的覆盖率排除列表中），但没有任何测试渲染 `CreativeWorkspace`/`CreativeWorkbench`。最近测量（2026-09-22）：[`workbench.tsx`](../../../../packages/creative/creative/src/client/workbench.tsx) 5.58%、[`workbench-ui.ts`](../../../../packages/creative/creative/src/client/workbench-ui.ts) 23.8%、[`production-runtime.ts`](../../../../packages/creative/creative/src/client/production-runtime.ts) 89.55%。分支约定要求在转绿后才合并上游。
2. **拖拽监听泄漏。** [`drama-production-view.tsx`](../../../../packages/creative/creative/src/client/drama-production-view.tsx) 的 `startDrag` 注册全局 `pointermove`/`pointerup`，只在 `pointerup` 解绑；指针在窗口外释放或拖拽中卸载都会永久泄漏并逐次累积，且 `move` 闭包捕获的是旧的 `canvas` prop。
3. **调度器修复治标不治本。** `69d850bcfb` 通过全局 `Symbol.for` 注册表桥接分裂的模块实例，把 `@internal` 键击穿到包边界之外；其测试只断言 `=== Symbol.for(...)`（同义反复），从未真正构造两个模块实例，真正的模块分裂从此静默通过。
4. **解释器不一致。** [`produce-tool.ts`](../../../../packages/creative/creative/src/produce-tool.ts) 硬编码 `python3`，而 [`workspace-route.ts`](../../../../packages/creative/creative/src/workspace-route.ts) 的 preflight 依次探测 `python3`、`python`；在没有 `python3` 别名的 Windows 上 preflight 通过但运行失败。
5. **文档脱节。** `session-controller` README（双语）描述了 `sessions.jobsBaseline` 就绪信号；源码中不存在该字段——`0c5854a0bc` 只加了文字。
6. **知识库死链。** [`knowledge/novel-to-game/README.md`](../../../../packages/creative/creative/knowledge/novel-to-game/README.md) 与 `README_ZH.md` 仍链接已被 `0662c5527c` 删除的 `examples/` 目录。
7. **两份真相。** [`workbench-store.ts`](../../../../packages/creative/creative/src/client/workbench-store.ts) 持久化 `productionRequests`/`productionSequence`，而 [`production-intents.ts`](../../../../packages/creative/creative/src/client/production-intents.ts) 又从对话日志重建同一批卡片，`reconcileSequence` 每次渲染重算序列。
8. **渲染期重活与泄漏。** `workbench.tsx` 每次渲染做非 memo 的 `JSON.stringify` 构造读取键并在 effect 内解析回读；一个 effect 里的 `setTimeout(..., 0)` 没有清理；`video-studio.tsx` 两个 effect 写同一状态；`GameDesign` 初始状态双写。
9. **硬编码中文绕过 locales。** [`production-runtime.ts`](../../../../packages/creative/creative/src/client/production-runtime.ts) 的报错字符串、`workbench.tsx` 的一处异常、`drama-production-view.tsx` 的字形。`workbench.tsx` 里的 `GROUP_ORDER` 是磁盘目录名——属于数据标识符而非 UI 文案，必须排除在本地化之外但应加注说明。
10. **模块级可变状态。** `produce-tool.ts` 的密钥轮换与 `workspace-route.ts` 的 tracker/preflight 缓存是进程全局的，插件卸载时从不清理，跨会话泄漏。
11. **预览读取缺少 realpath 校验。** `workspace-route.ts` 的工作区预览路由只做词法 `contains` 校验，不像同文件的 host 文件路由那样解析符号链接——工作区内的符号链接可逃逸根目录。游戏预览的 `untoken` 是未签名的 base64url；只有在文档中明确其为防误触手段而非安全边界时才可接受。
12. **次要残留。** [`game-verification.ts`](../../../../packages/creative/creative/src/game-verification.ts) 的 `'PINNED'` 变体在游戏示例删除提交中失去了唯一的生产方；`ui-trajectory` 测试为 creative 的 view-target 打桩，构成反向依赖。

## 可简化项

1. **33 字段的重复 schema。** [`produce-settings.ts`](../../../../packages/creative/creative/src/produce-settings.ts) 与 [`produce-settings-entry.ts`](../../../../packages/creative/creative/src/produce-settings-entry.ts) 各自声明同一组字段（一个普通、一个 `.volatile()`）；应由单一字段表派生两份 schema 以杜绝漂移。
2. **三重校验重叠。** `production-intent.ts`、`production-binding.ts`、`production-context.ts` 重复校验相同的 episode/kind/expectedOutputs 字段；`track_job` 每次调用校验两遍。合并为一次解析。
3. **`workbench.tsx` 长达 1444 行。** 抽出 `GamePreview`/`GameDesign`/`GameStudio`（约 300 行）、`FileTreeNodes`、`PreviewProbe` 与两个工具视图；把文件读取、agent 预览、production 输入派生、编辑器位置、导航逻辑抽成 hook。`DramaProductionView` 有 30+ 个 props 透传给五个面板——改为容器/展示拆分。
4. **Game/Video 工作室同构。** `GameStudio`/`GamePreview` 与 `VideoStudio`/`VideoPreview` 共享选择、标签页、挂载闩、空态与重载逻辑——抽共享的媒体工作室外壳。
5. **会话作用域解析重复。** [`skill-viewer`](../../../../packages/skill/skill-viewer/src/index.ts) 的 `viewOf` 几乎逐行重复 `session-controller` 的 `skill-catalog`；抽共享辅助函数。
6. **`ui-skill-viewer` 镜像 `ui-skill`。** 控制器缓存层是手工维护的孪生（代码注释自认），远端签名也是手写；共享缓存层或加同步测试。`SkillViewerResourceBase` 与 `SkillResourceBase` 重复；`userInvocable` 恒为 true——死字段。
7. **死代码。** 仅测试使用的 `resolveProduceEnv`；`role-provider.ts` 不可达的 tool-free 分支；`mediaMimeTypeForPath` 纯包装；`gameRoot` 与 `videoProjectRoot` 重复的 slug 校验；重复的 MIME 表；`index.ts` 里冗余的默认值；七个未引用的 locale key。
8. **无生成机制的知识库镜像。** `creative/knowledge/creative/story-setup/references/agent-references/` 下有 58 组字节级重复文件镜像四个姊妹技能；video-recap 另有 11 组。应在打包时生成或单一来源化。
9. **`workspace-route.ts` 职责混杂。** 966 行混合 HTTP 路由、字节范围、目录遍历、游戏/视频投影与 preflight——按职责拆分。

## 方案

按分支惯例小步顺序提交（amend + `push --force-with-lease`），每批落地转绿后再开始下一批。

**批次 0 —— 重新测量（不改代码）。** 重跑 creative 包覆盖率刷新红色清单；用当前数字更新第 1 条。

```sh
pnpm run test:coverage
```

**批次 1 —— 正确性修复（每项一个提交）。**

1. 修拖拽泄漏：把全局指针处理移入 `useEffect`，处理 `pointercancel`/`lostpointercapture`，`canvas` 改从 ref 读取。用现有 drama client 规格验证。
2. 按 preflight 的 `python3` → `python` 顺序一次性解析 Python 解释器并传入 `produce-tool.ts`；用假 runner 加单元测试。
3. 从两份 session-controller README 删除 `sessions.jobsBaseline` 段落（无任何消费方）并重录配对 sidecar；实现该字段不在本方案范围。
4. 修复两份 `novel-to-game` README 的死链并重录 sidecar。
5. 删死代码：`'PINNED'` 变体、仅测试用的 `resolveProduceEnv` 导出、不可达的 tool-free 分支、七个未用 locale key、`userInvocable`。
6. `produceKeyRotation` 改为按会话键控；路由级缓存在插件卸载时清理。
7. 为预览读取补上缺失的 `realpath` 包含性校验；在 `workspace-route.ts` 中注明 `untoken` 仅为防误触手段。

```sh
pnpm exec tsc -b tsconfig.host.json --force && pnpm exec tsc -b tsconfig.client.json --force
pnpm exec vitest run packages/creative/creative --testTimeout=30000
pnpm run test:docs
```

**批次 2 —— 单一真相。** 让对话投影成为 production 请求与序列的唯一来源；删除持久化的 store 字段并做状态迁移，更新 `sidebar.client.spec.ts`，删掉渲染期的 `reconcileSequence` 回写。

**批次 3 —— 补测试（解除上游合并阻塞）。** 在 jsdom 规格中渲染 `CreativeWorkspace`，覆盖 story/drama/game/video 四种模式、文件树与生产面板；把 `production-runtime.ts` 与 `workbench-ui.ts` 提到 100%。重跑覆盖率门禁。

**批次 4 —— 结构简化（必须在批次 3 之后）。** 按可简化项第 3 条拆分 `workbench.tsx`；抽媒体工作室外壳；`DramaProductionView` 做容器/展示拆分。然后合并校验三件套、从单一字段表派生 produce schema、抽共享的技能作用域解析、拆分 `workspace-route.ts`。配置目录与发现元数据不得漂移：

```sh
pnpm run hygiene && pnpm run doc-sync
```

**批次 5 —— 调度器决断。** 为调度器键加双模块实例测试，并在 `tools` README 中把 `Symbol.for` 桥接记录为受支持的机制；下次上游同步时复核。

**每批的最终门禁。** 快照回放必须保持已记录的基线（166 通过 / 1 个已知上游 `punycode` 失败）：

```sh
pnpm run build && DSH_EXAMPLE_MODE=lib pnpm run test:snapshot
```

## 备选方案

**先合并上游，后加固。** 否决：带着已知红色覆盖率变基到移动中的上游会放大冲突面，且覆盖率欠账已被记录为合并前置条件。

**一个大清理提交。** 否决：把正确性修复与结构移动混在一起不利于审查与选择性回退；分支惯例是小步 amend 提交。

**回退 `Symbol.for` 修复。** 否决：源码启动的 Host 加载构建产物 Loader 插件是真实拓扑；保留桥接，但用双实例测试让它名副其实。

## 验收标准

- `pnpm run test:coverage` 对所有 creative 文件通过每文件门禁，且 `CreativeWorkspace` 有测试渲染。
- drama 画布在卸载或 `pointercancel` 后不残留任何全局监听。
- preflight 与 `produce-tool.ts` 对 Python 解释器达成一致；不一致路径有测试覆盖。
- 文档中不再能 grep 到 `jobsBaseline`；知识库 README 链接可解析。
- production 请求/序列只有唯一真相来源；既有会话迁移后不丢卡片。
- 上述死代码全部清除；`pnpm run lint`、强制 host+client 类型检查、creative 规格、文档门禁与快照基线全部保持绿色。

## 风险

- 删除持久化的工作台状态可能让既有会话搁浅；批次 2 的迁移必须用真实的改动前工作台 store 验证。
- 拆分 `workbench.tsx` 会搅动 git blame 并与并行的 UI 工作冲突；批次 3 的测试必须先落地以钉住行为。
- 全局 `Symbol.for` 键可能静默桥接跨版本的*不兼容*模块对；批次 5 的测试应配对来自不同来源的实例，而不是同一文件加载两次。
- schema 派生必须精确保留 zod `.volatile()` 包装与 `credential-ref` 角色；生成目录一旦漂移会让 `hygiene` 大声报错——这正是预期的报警线。
