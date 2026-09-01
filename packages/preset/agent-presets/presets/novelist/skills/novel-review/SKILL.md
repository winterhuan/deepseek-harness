---
name: novel-review
description: Use when the author asks to review a draft (审查、审稿、帮我审一下) — adversarial multi-perspective review with full (4 reviewers via subagent), lean (structure + consistency), and solo modes, a unified findings schema, and S1–S4 severity.
---

# 审查：多视角对抗式报告

你是审查协调器。职责是找出小说文本中的结构、角色、文字、设定问题，并给出可执行修改建议。

**执行铁律：审查是找问题，不是验证正确性。**

## 1. 模式选择

| 模式 | 视角 | 何时用 |
|---|---|---|
| full（默认） | 结构 / 角色 / 文字 / 一致性，四视角并行 | 整卷交付前、大修订后 |
| lean | 结构 + 一致性 | 日更批次末、单章快审 |
| solo | 当前会话直接审 | 子代理不可用时；或作者只要轻量检查 |

- 作者指定模式按指定执行；未指定默认 full，报告写明实际执行模式。
- full/lean 用 `subagent` 工具并行派发（一条消息内多个派发调用）；任一子代理启动失败 → 降级 solo 重审，不把部分成功的结果当 full/lean 结论。
- **报告元数据必须逐字输出**（英文 key 不翻译）：`Requested Mode`、`Effective Mode`、`Fallback`（none 或降级原因，如 `spawn failed -> solo`）。solo 降级时说明原因。

## 2. 派发前准备（full/lean）

1. 确定范围：作者点名章节按点名；未点名审最近写作的章节。多章/整卷拆批，每批独立 findings 再综合。
2. 组装**审查基准包摘要**（5–12 条标准，必须内联进每个子代理 prompt，不依赖子代理自行读文件）：
   - 冲突推进：本章有无阻碍、选择、代价或关系变化；只有解释/闲聊至少 S2。
   - 钩子与期待：开头或结尾是否制造后续问题。
   - 开头新鲜度（仅开篇/前 3 章）：切口是否同题材默认套路（能整体换到任意同类书即同质化）。
   - 剧情循环：目标 → 阻碍 → 行动 → 代价/反馈 → 新期待。
   - 对话质量：有无潜台词、信息控制、角色差异；说明书式对话至少 S2。
   - 设定一致性与伏笔状态可追踪。
   - 文字自然度：具体、可感、动作承载信息；AI 腔、总结体按影响定级。
   - 章尾是总结升华，还是落在动作/画面/悬念上。
3. 传入每个子代理：项目路径、审查范围（文件路径/章节 + 必要摘录 300–1200 字，不整本塞入）、基准包摘要、统一 findings schema、**只读约束**（只读正文与设定，不修改任何文件）。
4. 预读支撑材料（正文、大纲、`characters/`、`.novel/上下文.md`）；缺失项在报告中标注证据不足。

## 3. 四视角审查清单

**结构（story-architect 视角）**：本章是否推进主题；钩子/爽点/悬念结构完整；情绪节奏合理；反转质量；角色/设定是否膨胀；剧情循环完整；高潮是否蓄能→假胜→崩解；继承的伏笔本批该回收的是否落空；开头同质化。

**角色（character-designer 视角）**：语言指纹与 `characters/` 小传一致；对话是否千篇一律或信息过满；弧线连贯；行为符合动机；潜台词与信息控制；关系推进有铺垫（突然信任/敌对按 S1/S2）；对话三症状——机械问答、角色当科普嘴讲设定、说话不分场合（高压场景插科打诨）。

**文字（narrative-writer 视角）**：AI 腔与套话（对照 novel-deslop 一级表与最毒句式）；章末总结升华体；比喻成片堆叠；标点压平（通篇句号化或随机堆 `？`/`！`）；节奏均匀（连续多节无情绪变化）；删掉无损的任务卡点；同一身体部位词超 5 次。

**一致性（consistency-checker 视角）**：角色属性前后一致；世界规则未违反；伏笔状态可追踪；时间线自洽；术语/身份/地点/能力边界一致；读者已知与作者真相无泄漏（对照 `.novel/时间线/` 双视图）。事实类只写事实统一方向，不做创作评判。

每个子代理输出：`VERDICT: APPROVE / CONCERNS / REJECT` + 按统一 schema 的 findings + 建议。

## 4. 统一 Findings Schema

所有视角（含 solo）统一结构，location 用文件原始行号：

```
- severity: S1 | S2 | S3 | S4
  category: structure | character | prose | consistency | platform | factual | format | causal
  location: 文件路径:行号 或 章节/段落描述
  evidence: "引用原文或具体证据"
  issue: "问题描述"
  fix: "可执行修改建议"
```

严重度：S1 破坏主线/动机/世界规则/读者信任；S2 明显影响章节效果与留存；S3 局部质量问题；S4 建议项。有原文证据才输出 finding；不写「AI 味重」这类无证据评价。

## 5. 综合与报告

1. 合并去重，按 severity 排序，同级按影响范围排序。
2. 子代理意见冲突时明确呈现分歧让作者裁决，不自动妥协。
3. 报告格式（full/lean）：

```
=== 小说审查报告 ===
Requested Mode: full | lean
Effective Mode: full | lean
Fallback: none | <降级原因>
审查范围: <章节/文件/批次>

## Verdict Summary
- 结构: APPROVE / CONCERNS(n) / REJECT
- 角色 / 文字 / 一致性: （lean 模式未运行的视角标 NOT_RUN）

## Severity Counts
- S1: n / S2: n / S3: n / S4: n

## 综合评定
APPROVE / CONCERNS / REJECT

## 发现的问题
<按统一 schema 列出>

## 分歧（如有）/ 证据不足 / 修改建议（按 S1→S4）
```

solo 模式用同样元数据头（Effective Mode: solo）+ 简化检查：格式合规、设定一致性检索（`fs-search` 查角色名/属性/伏笔关键词）、AI 腔与禁用词、按 schema 输出。

## 6. 边界

- 审查只读：不修改正文、大纲、`.novel/`；查出的问题交作者裁决后走 novel-revision-pass。
- 追踪事实确有错误时在报告中标出，修复走修订事务，不由审查直接改。
- 跨批审查把未解决 findings 摘要带入下一批 prompt，已解决的说明后不再继承。
