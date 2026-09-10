---
name: video-understanding
user-invocable: false
description: >
 把视频分析为结构化理解索引：场景检测、ASR 转写、逐场景 VLM 观察、静音窗口、融合时间线和写作 brief。
 用于理解、索引或总结视频，也作为后续创作前的分析阶段。输入视频文件；输出 scenes.json、
 asr_result.json、vlm_analysis.json、silence_periods.json、timeline_fusion.json、agent_narration_brief.md。
 触发词：视频理解、视频分析、视频索引、video understanding、analyze video、看懂视频。
---

## 1. 定位

本技能把源视频转成 Agent 与下游阶段可读取的理解索引。它的创作角色是**素材观察员 / 场记**，不是导演：

- 先观察，再解释；事实与推断分开。
- 除了“发生了什么”，还要让下游看见知识、权力、目标、关系或情绪在哪一刻变化。
- 标出由谁的 POV 承载变化、哪个反应或表演不可替代，以及哪里存在完整台词/动作的自然剪辑边界。
- 证据不足时保留不确定性，不制造戏剧结论。

## 2. 处理阶段

1. **场景检测**：写 `scenes.json`，包含切点、时长和废片段过滤结果。
2. **抽帧**：为视觉分析提取代表帧。
3. **ASR**：通过 `mimo-v2.5-asr` 写时间戳对白 `asr_result.json`。
4. **静音检测**：写 `silence_periods.json`，标注安静窗口与 `has_speech`。
5. **VLM 观察**：写 `vlm_analysis.json`，包含场景描述、深层分析和 `frame_facts`。
6. **时间线融合与创作 brief**：写 `timeline_fusion.json`、`asr_writing_chunks.json` 和 `agent_narration_brief.md`。

各阶段只有在输出产物与 provenance sidecar 同时匹配当前视频及影响结果的设置时才会复用；不把旧索引当作当前素材的分析。

## 3. 环境要求

Python 与 ffmpeg 使用当前 DSH 执行环境，不未经确认安装依赖。ASR/VLM 凭据从 `creative-produce` 配置与凭据存储解析；不导出密钥，也不直接执行需要凭据的 `understand.py`。

ASR 使用 `mimo-v2.5-asr`，VLM 使用 `mimo-v2.5`；`--skip-asr` 只跳过对白转写，VLM 仍需要凭据。若 `work/background_research.json` 存在，会把背景和角色名折入 VLM 上下文；`--context` 可补充简短提示。

## 4. DSH 执行

当前工具没有独立的理解阶段入口。新项目先把视频导入 `video-recaps/<project>/sources/`，确认本次外部分析后，通过 `creative_produce_run` 的 `video-recap` 入口运行第一阶段：

```json
{"entry":"video-recap","argv":["sources/ep1.mp4","--work-dir","work","--context","节目名/角色名"],"workdir":"video-recaps/<project>"}
```

仅在 `work/` 尚无旁白、剪辑计划或 dub 译文等后续输入时使用这条初次分析调用；编排器会产出理解索引和 brief 后暂停。已有项目优先复用来源与设置匹配的索引。只要求重做理解、但项目已有下游输入时，不直接重跑完整编排器，以免触发剪辑、TTS 或合成；说明独立入口缺失，让用户决定是否另建分析项目或明确确认更大的重跑范围。不删除用户稿件来强行停在第一阶段。

## 5. 输出契约

| 文件 | 内容 |
|------|------|
| `scenes.json` | 场景切点、起止时间与时长 |
| `asr_result.json` | `[{start, end, text}]` 时间戳对白 |
| `vlm_analysis.json` | 逐场景描述、深层分析与 `frame_facts` |
| `silence_periods.json` | `[{start, end, duration, has_speech}]` 安静窗口 |
| `timeline_fusion.json` | VLM、ASR 与静音信息的统一时间线 |
| `asr_writing_chunks.json` | 按句界和场景切分的 ASR 写作块 |
| `agent_narration_brief.md` | Agent 首先阅读的创作简报 |

后续写作阶段根据创作简报与索引制定方案并写 `narration.json`。

## 6. 参考资料

- 背景调研：`references/research-guide.md`，产出 `background_research.json`。
- JSON 结构：`references/data-schema.md`。

## 7. 能力边界

- 不写解说词，也不做解说评分；只负责生成理解索引与创作简报。
- 不剪辑、不配音、不合成视频。
- 不编造信号无法支持的剧情；当 ASR / VLM 过薄时输出素材警告。
- 不发布、不调度，只向 `work_dir` 写产物并停止。
