# Agent Note: 短剧 SHOT- 图片任务过 prepare 不过 confirm

Status: implemented

[English](2026-09-04-short-drama-shot-confirm.md) | 中文

## Problem

分镜.md 里冻结关键帧（`SHOT-*`）绑定的图片任务能过 `production_tool.py prepare`，到 `confirm` 却报 `stored job source entry has the wrong modality`。prepare 按**文档**查 `CREATOR_SOURCE_ENTRIES` 取前缀（分镜.md 就是 `SHOT-`，而且分镜→图片的映射就是为了让视频想绑的首帧有地方可渲染而存在的）；confirm 却按 **modality 硬编码**查 `{"image": "IMG-", "video": "MOTION-"}`——这张小表早于分镜映射，合法的分镜图片任务全死在付费门前。创作者已经批了任务才发现校验 bug，这是最坏的失败位置。

## Decision

**把 confirm 改成和 prepare 同一张按文档查的表。** 三行字面量换成 prepare 在用的 `CREATOR_SOURCE_ENTRIES[document][0]` 查询，连同它的同-modality 条件，两道门执行同一条规则。六格矩阵（SHOT/IMG/MOTION × image/video，通过侧与拒绝侧）加一次真实分镜图片任务的 `prepare` → `confirm` 全程锁定行为：以前 prepare 好的 SHOT- 任务不用重 prepare 直接 confirm 通过；跨 modality 绑定（图片任务绑 MOTION、视频任务绑 SHOT）照样报同一个错。

**补丁记在 manifest 里，不记在旁边。** `production_tool.py` 是上游 pin 文件，所以 manifest 里它的 `sha256`/`bytes` 按补丁后重算，理由记在这里——和树里 vendored 源码的 logged-local-modification 同一个做法。补丁只有三行语义，贴着 prepare 自己的表走，以后上游同步时干净地重打或退休。Skill 桥接里加了半句：SHOT- 分镜条目在 confirm 侧是合法图片来源。

## Alternatives considered

**把图片任务改绑图片提示词.md。** 否决作为常规解：把冻结帧 prompt 再抄一份进第二个文档等于造平行真相，正好是 review 环要挑的毛病，还断了 SHOT- 溯源链。只配当救单个被卡任务的手工 workaround，不算修。

**给 confirm 包一层伴生 shim。** 否决：判定是行内字面量，不是模块常量，shim 得整函数复制＋换 globals——不可评审的聪明代码，下次上游同步就静默失效，pin 制度防的正是这个。

**SHOT- 图片任务跳过 confirm。** 否决：confirm 是付费门，给某一种任务开洞等于拆掉花钱前创作者的最后一个检查点。

## Consequences

- `knowledge/drama/.../short-drama-produce/scripts/production_tool.py` 带一份有记录的三行本地修改；manifest 条目与补丁后字节一致。
- `short-drama-produce` 桥接注明 SHOT- confirm 可用；Host、卡片、adapter 代码都没动。
- 验证是本次 recorded 的六格矩阵加 prepare→confirm 全程，没有落盘套件：这是上游拥有的数据文件，没有可执行的门，伴生测试文件只会在上游同步时腐烂。
