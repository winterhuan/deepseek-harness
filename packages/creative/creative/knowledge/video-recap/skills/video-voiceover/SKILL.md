---
name: video-voiceover
user-invocable: false
description: >
 把带时间戳的 narration.json 合成为中文解说音频。使用 MiMo TTS（mimo-v2.5-tts）或
 Fish Audio（s2.1-pro-free）逐段生成语音，
 按时间窗动态适配语速并处理响度；输入输出时间线上的旁白，产出 tts_segments 与 tts_meta.json。
 旧版直接剪辑路径也可显式传入 narration_mapped.json。触发词：配音、语音合成、TTS、解说配音、
 voiceover、text to speech、旁白配音。
---

## 1. 定位

本技能读取带时间戳的旁白稿，为每一段生成独立音频，并把语音适配到对应时间窗，随后记录下游合成所需的放置元数据。
默认引擎是 MiMo TTS（`mimo-v2.5-tts`）；也可显式选择 Fish Audio（默认模型 `s2.1-pro-free`）。

## 2. 环境要求

MiMo / Fish 凭据与音色设置由 DSH 的 `creative-produce` 配置和凭据存储提供，不写入项目、可见参数或对话。实际合成使用 `creative_produce_run` 的 `video-voiceover` 入口；普通 bash 子进程不继承生产凭据。

项目位于 `video-recaps/<project>/`，旁白和中间产物位于 `work/`。运行前展示当前稿件、段数、provider、声音参考、输出和费用范围，取得明确确认；参考音频发往外部服务还需要相应使用授权。

## 3. 输入契约

默认输入为 `work_dir/narration.json`。每段必须包含 `start`、`end` 与 `narration`，可选字段包括
`pause_after_ms` 和 `overlaps_speech`。时间统一表示音频最终放置的**输出时间线秒数**。

编排式 cut 流程直接使用输出时间的 `narration.json`。只有旧版直接剪辑路径需要显式传入
`narration_mapped.json`。

## 4. 运行命令

调用 `creative_produce_run`，仅把脚本选项放进 `argv`：

```json
{"entry":"video-voiceover","argv":["--work-dir","work","--narration","work/narration.json","--tts-provider","auto"],"workdir":"video-recaps/<project>"}
```

`auto`、`mimo-tts`、`fish-audio` 按已确认的 provider 选择。需要指定 MiMo 音色时加入 `--mimo-voice` 与音色名；使用已授权参考音频时加入 `--voice-ref` 与素材路径，二者不混用。旧版直接剪辑路径显式把 `--narration` 改为 `work/narration_mapped.json`；省略该参数时默认读取 `work/narration.json`。

## 5. 输出契约

- `tts_segments/*.wav`：每段旁白对应一个音频文件。
- `tts_meta.json`：包含 `segments`、`engine` 与 `narration`。每段记录 `audio_path`、时间、
  `pause_after_ms` 和放置字段。
- 干净运行写入 `partial: false` 与 `failures: []`。
- 使用 `--allow-partial-tts` 跳过失败段时，写入 `partial: true` 和
  `failures: [{index,start,end,text,error}]`，让缺失语音保持可见。

## 6. 运行规则

- 重跑只复用内容与 TTS 设置均匹配的分段音频；修改旁白或合成参数后，只重生成受影响的 WAV。
- `auto` 优先使用已配置的 MiMo，MiMo key 缺失且设置了 `FISH_API_KEY` 时使用 Fish Audio；需要可复现的 provider 选择时显式传 `--tts-provider`。
- Fish Audio 直接请求 WAV；默认使用“娱乐扒妹”音色（`5653cea4ac83480aaf2bf45406556185`），`FISH_TTS_REFERENCE_ID` 可覆盖。模型、音色 ID、API URL、动态语速或归一化设置变化时会重新生成缓存。当前免费模型无 SLA，受 Fair Use 和官方免费期限约束。
- `--voice-ref` 仅用于 full/cut 解说克隆，切换到 `mimo-v2.5-tts-voiceclone`。仅在确需新合成时惰性规范化一次；
- dub voiceclone 原始 WAV 也会用模型、提示、台词和参考音频指纹缓存；匹配重跑不再重复请求或计费，`dub_manifest.json` 逐行记录 `tts_cache=hit|miss`；
  参考音频内容或预处理指纹变化会使旧缓存失效。仅在获得授权后使用，参考音频会发送到 MiMo。
- 并发、超时和重试由运行配置提供；允许部分成功时使用脚本声明的 `--allow-partial-tts`，不把环境变量拼进工具参数。
- dub 模式有独立的确定性门禁：`dub_lint.json` 会在语音克隆前阻止空行、重叠或越界译文；
  `dub_review.json` 用于记录忠实度、语气、时长和平台适配复核。可通过
  `dub.py --stage lint|review` 或 `dub.py --print-schema` 单独调用。

## 7. 能力边界

- 不撰写或修改旁白文本。
- 不混流、不压低原声、不渲染字幕。
- 不分析视频，也不选择时间点；只为输入稿件中的既定分段配音。
- Fish Audio 路径不接受本地 `--voice-ref`；使用已创建的 `FISH_TTS_REFERENCE_ID` 选择音色。
