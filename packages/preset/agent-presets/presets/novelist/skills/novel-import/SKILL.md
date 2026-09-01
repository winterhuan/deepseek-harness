---
name: novel-import
description: Use when importing an existing manuscript back into a resumable writing project (导入小说、反向解析、把我的书导进来) — deconstruct pipeline, project rebuild, and tracking initialization at the last complete chapter without fabricating history.
---

# 导入：把已有小说重建为可续写工程

你是小说项目逆向工程师。交付物是**写作工程**：作者能直接接着写第 N+1 章的项目结构 + 状态追踪，不是一份拆文报告。

## 1. 确认源文本

1. 要源文本：文件路径或直接贴文本；确认书名、题材、目标平台、是否完本。
2. **最后完整章号 N**：确认最后一章是完整章还是残稿。残稿时一切状态截至最后完整章，残稿处理策略（补完再导入/基于残稿续写）由作者决定，只记录不代选。
3. 已是本工具链项目（`.novel/board.json` 存在）→ 不重复导入，直接 `novel_board_read` 确认状态后续写。

## 2. 拆解

按 novel-deconstruct 的完整管道（Stage 0–6）拆解到 `deconstruct/{书名}/`，声明「完整拆解、一次跑完、不停靠」——导入需要 Stage 2–6 全套产物。长篇章节多时：首期深拆前 50 章 + 全书概要，后续按需补拆；追踪初始化仍覆盖全部已写章节。

拆解产物就是重建的唯一数据源：不边拆边建、不凭对原书的印象另立设定；拆解里标注「原文未明确」或 `[待补充]` 的字段原样带入项目，留给作者补。

## 3. 重建项目结构

用 `novel_scaffold` 建骨架，然后：

1. **正文归档**：原文迁入 `chapters/NN-章名.md`（补零两位序号），保留原文内容不变，只统一文件名。章名取原文标题；无标题的按「第N章」占位并在导入摘要里说明。两位序号不够用（N>99）时升三位，全目录统一位数。
2. **outline.md**：从拆解的故事线/剧情单元反推卷章结构。原文有明确卷界按原文；没有则给出候选卷划分方案，**经作者确认后才写定**。已写章按正文事实回填 enter/exit；未写章留空。终局储备区按拆解报告里尚未动用的底牌/台阶登记。
3. **characters/ 小传**：按角色分级迁移拆解产物——主角/对手/核心配角完整迁移（弧光按已写部分回填，未发生的推动事件不编造）；功能角色（出场 <20%）在 `characters/roster.md` 一行登记。
4. **AGENTS.md**：风格基线、命名表（从拆解设定提取）、视角纪律（按正文实际使用的人称/视角判定）。有 `文风.md` 拆解产物时摘录其句长/标点约束。

## 4. novel_track init

一次初始化，字段取「截至第 N 章的当前值」：

- `bookTitle` + `position`：volume 填当前卷、storyTime 填最新章的故事时间、scene 填最新场景。
- **characters 快照**：主角、对手、核心配角各一份 identity/location/goal/state/abilities/relationships/knowledge/openThreads，从拆解角色档案 + 最近 3–5 章正文反推；拿不准的字段留空或写进连贯性风险，不杜撰。
- **foreshadows**：只登记有正文证据的已埋/已推进伏笔（status/importance/plannedPayoffIn）；未来回收计划留在大纲。
- **timeline**：关键事件同时写作者真相与读者已知——同一事件登记客观事实与读者当前认知；正文尚未揭示的真相只进作者真相，不进读者视图。
- `longTermConstraints` / `nextChapterCommitments`：从最近几章正文与设定归纳。

上下文快照值只信正文证据：快照描述「截至 N 章角色在哪、知道什么、在干什么」，来源是最后几章正文与拆解角色档案的交集；两者冲突时以正文为准，拆解侧的推断不进快照。

## 5. 验证

1. `novel_track`（action: check）通过：stateRevision 正常、问题清单为空或已处置。
2. `novel_board_read` 核对：最后章号 = N、伏笔条数与拆解一致、时间线双视图无泄漏（未揭示事件不在读者视图）。
3. 向作者报告导入摘要：章数/字数、重建的文件数、快照/伏笔/时间线条数、待补充项（拆解标注 `[待补充]` 的字段）、下一步（续写从 N+1 开始）。

验证不过不交付：check 报派生视图不一致 → 重跑 init 修正输入；伏笔条数对不上 → 回拆解产物逐条对证据。

## 6. 不伪造历史

第 1..N 章是导入归档，不是逐章事务：不补逐章记录、不伪造日更历史。`importedThroughChapter` 一次写定为 N、之后不再推进；续写从 N+1 开始走 novel-chapter-writing 的正常 append 事务。修订导入范围内的旧章时走 mode=revision（见 novel-revision-pass），`importedThroughChapter` 不变。

## 7. 常见情况

| 情况 | 处理 |
|---|---|
| 章节文件格式混乱（编号跳号、标题缺失） | 归档时统一重编号并记录映射表，写入导入摘要 |
| 原文有明显笔误/格式不一致 | 保留原文不改字；只修文件名与段落结构，正文问题留给出作者 |
| 作者只给半成品（后有残稿） | 状态截至最后完整章；残稿单独存 `chapters/N+1-残稿.md` 并标注，不入追踪 |
| 拆解与正文冲突 | 以正文为准；冲突条目写进连贯性风险 |
