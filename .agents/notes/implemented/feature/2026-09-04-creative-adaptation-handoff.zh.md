# Agent Note: 跨域改编交接（小说到短剧、游戏与视频）

Status: implemented

[English](2026-09-04-creative-adaptation-handoff.md) | 中文

## Problem

四个域各自端到端能跑，但域与域之间是孤岛：Skill 桥接里零跨域路由，story 入口 skill 只在小说 13 skill 内路由，每个管线要的输入形状还不一样。`short-drama-novel-analyze` 要单个原生 `原著.txt`，story 管线却一章一文件；`video-understanding` 只认原始媒体文件，不知道 `剧集/<EP>/制作成果/`；游戏 intake 以小说为中心，短剧文档无路可入。Agent 只能每处临场发挥，章节边界、style-profile、provenance 一路丢——而桥接唯一暗示的那条路（短剧文档进游戏 intake）还是假朋友：剧本信息密度撑不起系统设计。

## Decision

**用四句话在桥接里路由。** story 入口列三个出口（短剧走导出包、游戏走 `novel-game-analyze`、解说走 `sources/`）；`story-import` 点名 exporter；新增 `short-drama-novel-analyze` override 把导出包定为唯一 intake；video 桥接收下“制作成果拷 `sources/`”约定；game 桥接明示关闭短剧 intake。文案是最便宜的路由器，也是四个管线本来都会读的唯一一层。

**导出分片但不重新切片。** `story-import/scripts/export_novel_txt.py` 把 `正文/第NNN章.md` 按编号顺序原文拼成 `原著.txt`，外加 `章节映射.json`（零基 `[start, end)` 行 span、逐章 sha256、来源文件）。小说分析要字节可引用的 span（“没有字节就没有 span”），所以交付物里真正重要的是映射表：任何分析 span 都能落回章文件和哈希。严格是故意的：重号、非章节文件、缺标题、标题与文件名号不符全部大声失败并点名文件——悄悄把正文并进错的章节会污染引用。端到端验证过：20 章导出进真 `novel_index.py` 索引出正好 20 章、零问题。

**改编台账不进 `SOURCE_BIBLE`。** 跨域血缘（哪几章、哪些改编决策、哪些合并）做成 DSH 自有的只追加记录——workspace 根的 `改编谱系.jsonl`，每条改编边一项、带来源指纹，由改编 Agent 在 intake 时经 `story-import/scripts/record_lineage.py` 记录。来源按文件（字节 sha256）或目录（排序后的路径哈希清单的 sha256）哈希，所以小说导出包、短剧分集目录、单个媒体文件都可引用；目标是当时可能还不存在的项目地址；纯交付拷贝允许空决策（边本身就是短剧→视频的握手）。`SOURCE_BIBLE` 保持管线内不可变：它的“下游不得静默改写”保证背着游戏 QA 证据链，往上钉血缘正好削弱这一点。

**短剧→游戏不开，直接写明。** 同 IP 双改编共享的是小说上游，不是短剧。game 桥接把话说死，不让模型靠 intake 失败自己悟。

## Alternatives considered

**教 `novel_index.py` 直接读分片 workspace。** 否决：它是上游 pin 文件，span 模型假设单文件输入；exporter 让上游保持字节一致，从我们这边满足可引用契约。

**把 style-profile 与追踪状态一起导出。** 暂否决：没有确认的消费者——`novel-analyze` 从文本自建索引和判断。导出保持两件套（`原著.txt` 加映射表），有具名消费者再加透传。

**楔子/番外按位置猜编号。** 否决：编造章节号污染的正是映射表要保护的引用。导出直接点名报错；以后版本可以接受显式顺序清单。

## Consequences

- 新增 `story-import/scripts/export_novel_txt.py`（上游文件未动），`--selftest` 覆盖 span 还原加四个大声失败用例；drama 树在场时跑 sibling-indexer 交叉检查。
- 桥接路由句由 `skill-provider.spec.ts` 按域断言钉住；短篇直读限定让单文件 workspace 不进导出路径。
- `record_lineage.py` 自带 `--selftest`（往返加六个大声失败用例）；后续只剩：非数字章节的显式顺序清单，以及有消费者再加 style-profile 透传。
