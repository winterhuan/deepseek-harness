---
name: novel-project-setup
description: Use when starting a new novel project, joining an existing one, or setting up author memory — the intake questionnaire (题材、视角人称、目标篇幅、风格基调、对标作品), the workspace skeleton, the tracking protocol (novel_track), and the skill routing table.
---

# 立项：从想法到可写作的工程

本 skill 覆盖小说模式的第一阶段：把一个模糊的想法变成可以持续写作的项目。产出是文件，不是聊天记录。

## 1. 技能路由

13 个 skill 各管一段，按作者意图分发；本 skill 只管立项与协议：

| 意图 | skill |
|---|---|
| 立项、建骨架、加入项目 | novel-project-setup |
| 卷章结构、剧情单元、细纲 | novel-outline-craft |
| 人物小传、动态快照、退役 | novel-character-craft |
| 写单章、日更续写 | novel-chapter-writing |
| 回炉修订 | novel-revision-pass |
| 连续性核对、时间线双视图 | novel-continuity-audit |
| 多视角审查 | novel-review |
| 去 AI 味 | novel-deslop |
| 拆解对标书 | novel-deconstruct |
| 扫榜、选题 | novel-market-scan |
| 导入已有小说 | novel-import |
| 短篇写作 | novel-short-writing |
| 封面简报 | novel-cover |

## 2. 立项问卷（新项目）

动笔前必须与作者确认以下七项。用一次对话问完，给出每项的推荐选项而不是开放提问：

1. **题材与类型**：科幻 / 悬疑 / 都市 / 历史 / 奇幻……类型决定读者的预期契约。
2. **核心冲突**：一句话说清「谁想要什么，什么阻止他」。
3. **叙事视角与人称**：第三人称限制 / 第一人称 / 全知；视角纪律一旦确定，全书不改。
4. **目标篇幅**：短篇（<3 万）/ 中篇（3–10 万）/ 长篇（10 万+）；决定卷章结构密度。
5. **风格基调**：冷峻白描 / 浓墨抒情 / 快节奏爽感 / 慢热沉浸；给出对标作品（2–3 部）。
6. **人物 roster 起点**：主角 + 主要对手 + 1–2 个功能性配角，先立骨架后丰满。
7. **连载节奏**（如适用）：单章字数目标、更新频率。

答案写入 `outline.md` 的「基本设定」区；风格约束写入 `AGENTS.md`。

## 3. 建骨架

确认问卷后调用 `novel_scaffold` 创建骨架。骨架文件职责：

| 文件 | 职责 | 谁写 |
|---|---|---|
| `outline.md` | 故事前提、基本设定、卷章结构、伏笔登记 | Agent 起草，作者修订 |
| `AGENTS.md` | 风格、命名表、视角纪律、禁区 | Agent 起草，作者定稿 |
| `characters/` | 每个重要人物一个 `<名字>.md` 小传 | 用 novel-character-craft 的模板 |
| `chapters/` | 正文，`NN-章名.md`（NN 两位序号） | 写作阶段产出 |
| `.novel/` | 追踪状态与全部派生视图 | 只经工具读写，见第 4 节 |

## 4. 追踪协议（novel_track）

`.novel/board.json` 是唯一结构化权威；`.novel/` 下其余文件全部是工具生成的派生视图，**禁止手改**：

| 派生视图 | 内容 |
|---|---|
| `.novel/上下文.md` | 续写状态卡：当前位置、长期约束、核心角色状态、活跃伏笔、下一章承诺、连贯性风险 |
| `.novel/角色状态/<名字>.md` | 核心角色当前快照 |
| `.novel/伏笔.md` | 每条伏笔一行当前状态：status（已埋/已推进/已回收）、importance（高/中/低）、plannedPayoffIn |
| `.novel/时间线/作者真相.md` | 客观事实，含未揭示事件 |
| `.novel/时间线/读者已知.md` | 读者截至最新章的认知 |
| `.novel/逐章记录/第NNN章.md` | 每章对未来连续性有用的紧凑变化 |

- 新项目建骨架后立即 `novel_track`（action: init）建追踪：`bookTitle`、`position{volume, volumeStartChapter, storyTime, scene}`、`longTermConstraints`、`nextChapterCommitments`、`characters` 快照、`foreshadows`、`timeline`。init 只在新项目执行，不覆盖已有追踪。
- 每章事务用 `novel_track`（action: commit）；校验派生视图一致性用 action: check（返回 stateRevision、lastChapter、问题清单）。
- 查状态用 `novel_board_read`；事务之外的直接修正（作者口头裁决、导入迁移）用 `novel_board_update`。

## 5. 作者记忆（novel_memory）

作者记忆存工作区 `.story/author-memory.json`，跨项目复用。只存创作偏好，不存小说事实——角色、时间线、伏笔写项目设定与追踪。

- `record`：statement（偏好原话或紧凑归纳）、source、scope（global / genre / book）、kind：prose_style | story_design | workflow；把握不大时加 pending:true 待作者确认。
- `query`：按 kinds 过滤，返回 active 条目。写正文前查 prose_style + story_design；改设定/大纲查 story_design + workflow。
- `confirm` / `forget` / `list`：确认 pending 项、撤回、查看全部。

规则：

1. record 成功返回回执才算记住；没有回执不得向作者声称已记住。
2. 一次性要求（「这一章别…」「这次给我…」）只执行，不记录。
3. 「以后都这样」「我习惯…」等明确长期声明才直接 active；同类修改反复出现但作者没说这是长期规则 → pending。
4. 记忆是低优先级倾向：硬门禁、作者当前请求、本书设定永远优先。

## 6. 加入已有项目

1. 先 `novel_board_read` 恢复状态板上下文（章节、字数、未回收伏笔），再 `novel_track`（action: check）确认派生视图一致。
2. 读 `outline.md` 与本次写作涉及的 `characters/` 小传。
3. 用 `fs-search` 检索既往章节中与本次任务相关的设定片段，不凭记忆写续章。
4. 向作者报告：「项目处于 X 状态，最近一章是 Y，未回收伏笔 Z 条」——然后等任务。

## 7. 完成标准

- 七项问卷全部有明确答案（作者明确说「你定」的项，由 Agent 决定并在 outline.md 标注「Agent 代定」）。
- 骨架文件全部落盘；`outline.md` 至少有第一卷的章级结构。
- 第一批人物小传落盘（至少主角与对手）。
- `novel_track` init 已执行且 check 通过。
