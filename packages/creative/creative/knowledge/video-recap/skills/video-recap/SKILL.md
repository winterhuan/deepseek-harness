---
name: video-recap
description: >
 从输入视频端到端生成中文解说成片。用户提供 .mp4 / .mov / .mkv / .webm，并要求添加旁白、
 配音、总结、短剧/电视剧/电影/纪录片/科普解说时使用。负责编排 video-* 技能链：视频理解 →
 Agent 制定故事与视听方案 → 剪辑 → 配音 → 合成。触发词：视频解说、视频旁白、生成解说、
 视频 recap、video recap、voiceover、narration、auto-dub、recap。
---

## 1. 定位与流程

本技能是五个独立技能的轻量编排器。各技能只通过 `work_dir` 中的 JSON / MP4 产物通信，不共享代码：

```text
video-understanding ─▶ Agent 按 video-script 制定方案并写稿 ─▶ [video-cut] ─▶ video-voiceover ─▶ video-assemble
```

流程支持断点续跑：写好 `narration.json` 后重复同一条命令即可继续。第二阶段会校验
`recap_run_manifest.json`，拒绝复用来自其他源视频或其他运行参数的旧工作目录；视频理解产物也只在来源一致时复用。

## 2. 创作职责

这不是单纯的 JSON / 渲染流水线。Agent 是本次内容的创作负责人。先判断本轮的**创作控制模式**；它与 `--edit-mode full|cut|dub` 是两个维度：

- **CREATE**：从素材创作新成片。比较真正可行的故事/剪辑假设，再选择主线。
- **DIRECTED**：用户已经指定结构、镜头、台词或包装方向。把这些决定当作基线落实，不为满足模板而另起方案。
- **REVISION**：用户针对已有版本看片修改。最新反馈覆盖旧决定；本轮未点名的故事、镜头、声音和包装默认冻结，不重新发散创作。

REVISION 开始前先明确“本轮修改项”和“冻结项”。表达、节奏、字幕反馈写回 `style_card.json`，镜头、入出点和声音分工写回 `visual_audio_board.json`；只有观众承诺、POV、主线或故事 beat 改变时才更新 `recap_story_plan.json`。删除成片内容时同步删除计划中的旧描述，不能让工作产物继续指导已不存在的镜头。

确定模式后，在进入昂贵的下游处理前完成五次判断：

1. **导演判断**：确定观众承诺、POV、戏剧问题、情绪终点，以及哪些信息要保留到后面揭示。
2. **故事编辑**：CREATE 比较至少两个可行的剪辑假设；DIRECTED / REVISION 继承用户指定或已确认的主线。beat 始终定义为“发生了什么变化”，而不是场景摘要。
3. **画面剪辑**：选择真正值得保留的具体时刻、人物反应、入点与出点。
4. **声音/旁白**：先分配画面、原声、沉默和旁白的任务，再写解说词。
5. **观众复核**：分别检查无旁白、只听声音和第一次观看时的体验，优先修改回报最高的问题。

执行前阅读本技能的 `references/creative-editing-playbook.md`，并把简洁的创作决定写入：

- `recap_story_plan.json`：导演意图、适用时的备选假设、选定主线和基于变化的 beat 图。
- `visual_audio_board.json`：每拍的画面任务、表演/反应选择、原声锚点、`audio_owner` 与 `narration_job`。
- `style_card.json`（有表达要求或表达反馈时）：当前声音、口语节奏、字幕阅读姿态与明确禁忌。

这些文件只记录可审计的当前决定，不记录冗长思维过程；它们不会增加服务或渲染依赖。现有工具可以忽略它们，Agent 与建议型解说评审会用它们保持创作一致。建立这条内容基线不需要平台数据。

## 3. 环境与脚本路径

每个项目位于 `video-recaps/<project>/`：素材导入 `sources/`，工作产物位于 `work/`。来自短剧的成片从 `剧集/<EP>/制作成果/` 复制，保留带 `SHOT-` / `VISUAL-` 的文件名，并通过 `story-import` 的 `scripts/record_lineage.py` 在工作区根目录追加交付谱系。

带凭据的处理只通过 `creative_produce_run`，在 `argv` 中传脚本选项，不传脚本路径或环境变量。凭据由 `creative-produce` 配置和凭据存储解析；不把密钥写入项目、可见工具参数或对话，不通过 bash 导出。ffmpeg 与 Python 使用当前 DSH 执行环境，安装或升级依赖必须取得用户明确许可。

运行前展示当前素材、旁白/声音选择、参数、输出和费用范围，并取得对应处理的明确确认；修改输入、追加生成或可能重新计费的续跑需要重新确认。默认配置的 MiMo 凭据用于：
同一个 MiMo key 驱动：

- ASR：`mimo-v2.5-asr`
- VLM：`mimo-v2.5`
- TTS：`mimo-v2.5-tts`

TTS 可通过 `--tts-provider fish-audio` 改用 Fish Audio；此时需在 DSH 配置对应 Fish 凭据，默认模型为 `s2.1-pro-free`，默认使用“娱乐扒妹”音色（`5653cea4ac83480aaf2bf45406556185`），可在运行配置中覆盖音色 ID。ASR/VLM 仍使用 MiMo。

Token Plan 集群等供应商设置由运行配置提供；不要把脚本环境变量误写成工具参数。

可选能力：

- `--mimo-video-overview`：按场景块补充 MiMo 视频理解。
- `--mimo-qc pre-assemble|post-render|both`：在合成前、成片后或两个阶段给出建议型复核。

MiMo QC 默认关闭；每个选定阶段最多请求一次，写入 `mimo_qc.json`。任何凭证缺失、限流、超时、格式错误或采样失败都只记录状态，不阻断流程。详细可覆盖配置见 `references/config-playbook.md`。

下文 JSON 是 `creative_produce_run` 的参数示例。`entry: "video-recap"` 选择打包的完整编排入口；不直接运行 `recap.py`，也不把只定义参数的 `recap_cli.py` 当可执行入口。`workdir` 相对于当前工作区，`argv` 中的素材与 `work` 路径相对于该项目。

## 4. 标准解说流程

### 4.1 背景调研

若能识别影片、剧集或主题，先按本技能的 `references/research-guide.md` 调研并写入
`work_dir/background_research.json`。视频理解会把人物名和剧情背景折入 VLM 上下文，避免只得到“黑衣男子”一类模糊描述。无法识别来源时可跳过。

### 4.2 分析并暂停创作

```json
{"entry":"video-recap","argv":["sources/ep1.mp4","--work-dir","work","--context","背景"],"workdir":"video-recaps/<project>"}
```

新的工作目录中，该调用完成视频理解、写出 `agent_narration_brief.md`，然后暂停。此时按以下顺序执行 `video-script`：

1. 查看创作 brief 与原片故事板。
2. 写 `recap_story_plan.json` 和 `visual_audio_board.json`。
3. full 模式写 `narration.json`；cut 模式第一阶段只写 `clip_plan.json`。
4. cut 模式第二阶段查看剪后故事板，补充输出时间与声音分工，再写 `narration.json`。

不要从标题或旁白句子开始；先锁定故事体验和素材选择。

时间线有两条不可降级的硬约束：原声只能在可靠句末/静音边界被切入、切出或恢复；旁白必须使用
完整逐段音频，任何 clip 映射裁段、TTS 裁尾或剪映引用更长的加速前素材都阻断。Agent 收到
`interrupts_source_sentence` / `unsafe_clip_sentence_boundary` / `no_safe_fit` /
`timeline_audio_mismatch` 时，应移动边界、缩短整句或删除该块，而不是增加抢断 override。

### 4.3 多视频与素材库

多视频只支持 cut 模式。项目 brief 会列出稳定的 `source_id`，`clip_plan.json` 中每个片段都必须填写来源：

```json
{"entry":"video-recap","argv":["sources/ep1.mp4","sources/ep2.mp4","--edit-mode","cut","--target-duration","10m","--work-dir","work"],"workdir":"video-recaps/<project>"}
```

可选文件系统素材库：

在已确认调用的 `argv` 中加入 `--material-library-dir`、`.video-materials`、`--save-materials` 保存素材索引；复用时改为 `--use-materials`。保留本项目的 `--work-dir work`，多素材仍使用 cut 模式。

素材检索只是对 JSON / MD / JSONL 做 grep，例如 `grep -R "keyword" .video-materials`。当前版本不复制原始媒体，也不提供数据库、向量或语义搜索。

### 4.4 继续生成成片

写好所需产物并确认本次生成后，重复前一阶段的 `creative_produce_run` 调用，保持素材、`workdir`、`--work-dir`、`--context` 和模式等参数一致。修改参数时先检查旧产物的来源与配置是否仍可复用，不用续跑绕过确认。

流程会校验当前阶段的硬输入（`clip_plan.json` / `narration.json`）；两份创作计划仍是 Agent 与建议型评审使用的工作记录，不是渲染门禁。cut 模式随后生成 `edited_source.mp4`，再合成旁白并输出 `recap_<name>.mp4`。

若需要建议型 MiMo 复核，在本次已确认调用的 `argv` 中加入 `--mimo-qc`、`both`；保留其余项目参数，并把额外外部请求纳入确认。

合成前复核会读取脚本、计划和 TTS 元数据；成片后还会读取最多六张临时 JPEG。相同输入命中内容缓存，`--mimo-qc-refresh` 可强制刷新。帧的 base64 与凭证不会写入磁盘。

### 4.5 字幕与克隆旁白

若要把旁白字幕固定在原片字幕区域，先通过 DSH 执行工具运行本地测量脚本（路径相对于本技能目录）：

```bash
python3 <本技能目录>/../../tools/measure_subtitle.py <video>
```

再传入测得的 `--subtitle-y-top/--subtitle-y-bot`。坐标基于 ffmpeg 自动旋转后的显示画布，区间为半开 `[top, bot)`，并要求底对齐 ASS 样式；显式设置后，该区域默认使用 60% 透明度的旁白窗口遮罩。

解说模式如需克隆参考声音，使用 `--voice-ref <audio>`；它与 dub 模式不同。

### 4.6 最终观看与交付复核

脚本、接点检测、样帧和 QC 报告都不能替代观看。每轮准备交付前，必须检查**本轮实际要交付的最终文件**，而不是旧别名、无字幕母版或中间代理：

1. 正常速度完整播放一次短片，不边看边改；先记录真实观看问题。
2. 播放每个拼接点前后约 0.5–1 秒，检查闪帧、原片叠化被截断、动作跳变和半句原声。
3. 完整只听声音一次，检查旁白是否碎成一句一停、场景间声音是否接得上、关键原声是否完整。
4. 单独复看开头、核心情绪/表演点和结尾，确认进入时机、回报停留和收束都成立。
5. REVISION 分别验证本轮修改项已经改变、冻结项没有意外变化；然后再做解码、时长、音画规格等机械检查。

scene score、亮度统计、contact sheet 与自动 QC 只负责定位候选问题；最终判断以真实播放为准。短时间内出现密集候选时，必须判断每个切点来自原片还是本次拼接：原片无关短镜头整段删，相关短镜头扩展到完整动作/反应；人工拼接点优先移动边界、恢复同源连续运动或合并片段，能消除就不保留。修复失败时回到剪点、声音或文案层，不用更多包装掩盖。

## 5. 英译中原声复刻模式

`--edit-mode dub` 把英文视频翻译为中文，并用原说话者的克隆音色替换人声；它不是在压低原声上叠加解说。

```json
{"entry":"video-recap","argv":["sources/ep1.mp4","--edit-mode","dub","--work-dir","work"],"workdir":"video-recaps/<project>"}
```

准备阶段会转写英文、提取一段参考音频，并写出 `dub_brief.md` 与 `dub_transcript.json`。Agent 随后写：

```json
[{"start": 0.0, "end": 2.0, "zh": "中文译文"}]
```

要求：

- 逐句忠实翻译，不删钩子、不合并、不擅自压缩；原文重复，译文也按时间重复。
- 每句沿用原声 `[start, end]`，相邻句不重叠。
- 译文尽量控制在约 5 字/秒，使其能在原时间窗内说完。

重复同一命令后输出 `dub_<name>.mp4`。每句单独克隆并贴回原时间线；只有即将覆盖下一句时才局部加速。当前版本只支持单说话者、整轨替换，不分离背景音乐。

## 6. 自检命令

调用 `creative_produce_run` 检查运行环境，不生成媒体：

```json
{"entry":"video-doctor","argv":["--json"]}
```

## 7. 输出与参数

主要输出：

- `recap_<video>.mp4`：最终成片。
- `subtitles.srt` / `subtitles.ass`：字幕。
- `work_dir/`：全部中间产物，契约见 `references/data-schema.md`。
- `work_dir/recap_story_plan.json` / `visual_audio_board.json`：Agent 创作意图与剪辑决定。
- `work_dir/mimo_qc.json`：可选的建议型复核，不作为发布门禁。

可透传参数：

`--context`、`--scene-threshold`、`--style`、`--edit-mode {full,cut,dub}`、`--target-duration`、
`--skip-asr`、`--mimo-video-overview`、`--mimo-qc {off,pre-assemble,post-render,both}`、
`--mimo-qc-refresh`、`--consolidate`、`--consolidate-asr`、`--tts-provider`、`--mimo-tts-voice`、`--voice-ref`、
`--allow-partial-tts`、`--review-narration`、`--no-review-narration`、`--require-narration-review`、
`--subtitle-y-top`、`--subtitle-y-bot`、`--no-burn-subtitles`、`--output-dir`、
`--export-jianying`、`--jianying-bundle-media`、`--jianying-no-bundle-media`、
`--material-library-dir`、`--use-materials`、`--save-materials`。

`--style` 是原样传给 Agent 的自由文本指导，不是 preset、枚举、开关或有限风格分类。

## 8. 能力边界

- DSH 视频视图只预览现有产物；`recap_run_manifest.json`、`recap_phase.json`、`timeline.json`、`assembly_manifest.json` 是既有运行记录，不新增第二套状态或渲染队列。新版本完成后告知用户可以加载，不静默替换正在播放的视频。

- 编排器不代替 Agent 写 `narration.json` / `clip_plan.json`；具体写作遵循创作 brief 与写作阶段契约。
- 语义评审默认建议型、失败开放；只有调用方显式启用严格解说评审时，事实矛盾、残句或评审不可用才会在 TTS 前阻断。确定性校验阶段始终负责硬校验。
- MiMo QC 不能阻断、自动修复或改变退出状态，只提供定位建议。
- 建立内容质量基线不依赖平台分析、留存遥测或发布接入。
- 本技能不是无人值守调度器，不会向任何平台发布内容。
- 各阶段技能不共享代码，只通过 `work_dir` 产物通信。
