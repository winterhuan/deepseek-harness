---
name: short-drama-produce
description: 在创作者明确确认后执行短剧项目的图片、视频、TTS/配音或时间线音乐生产任务，并把结果与精简运行记录落回项目。用户说“生成这张图/这段视频/这句配音/这段配乐”“开始跑图/跑视频/合成语音/生成音乐”“把已确认提示词送去生产”或要求批量执行已确认媒体任务时使用；不负责创作提示词、镜头、台词、歌词或声音身份，也绝不把预览、继续、预算说明或既有接受状态当作本次付费生产确认。
license: MIT
---

# 确认后生产

只把已经写好的生产规格安全送到运行环境配置的运行器。图片提示词归 `$short-drama-image-prompts`，视频提示词归 `$short-drama-video-prompts`，台词与录音表归 `$short-drama-write`，声音身份归 `$short-drama-assets`。来源：Drama Skills 0.6.1（MIT），DSH 桥接适配 —— 生产协议与界面投影跟随 `short_drama_production` 工具与工作台，不依赖 Python `production_tool.py`；实际媒体 run 由「当前 DSH Preset 可见的工具」按运行环境 adapter 执行。

## Quick Start

只在用户明确要求实际生成后，从当前 `图片提示词.md`/`分镜.md`/`视频提示词.md` 取出本次提示词，建立一个有边界的 job。creator-first job 的 `source` 必须指向持有该提示词的当前 Markdown，`source_entry` 点名对应 `IMG-*` 或 `MOTION-*` 末级标题；存在真实参考图时逐张填写 `reference_bindings` 的顺序、路径、中文名、用途与允许/禁止范围。输出放 `剧集/<EP>/制作成果/`；这是生产工具的临时输入，不是第六份创作文档。

先向创作者展示完整预览（adapter、模型/profile、数量、参数、reference、outputs、overwrite 与源条目）；**这时不调用供应商**。

## 硬闸门

每次生产必须依序四步，不可合并：

1. 建立有边界的 job：一种 modality、明确数量、完整 prompt/spec、参考文件、参数、输出路径与 adapter profile。
2. 展示 `prepare` 完整预览，尤其是数量、prompt、source entry、reference bindings、references、outputs、overwrite 与 adapter；creator-first job 同时机械核对所选条目里的可复制提示词与参考图槽位/顺序/路径/中文名/控制边界，任一漂移 fail closed。
3. 等创作者**看到这份预览后**明确确认。只有明确同意这项当前任务才算本次确认；“继续”“都做完”“预算没问题”、上游内容已接受或之前确认过另一版本都不算。
4. 运行。每次运行前消费一次确认；成功后或再次运行都必须重新确认，防止失败重试产生意外费用。

job、prompt、参数、输出路径或直接输入任一变化，旧确认立即失效。不得代替创作者填写确认。一个确定 job 是本轮唯一工作单元；运行结束回报结果并交还控制权，不自动准备下一批或启动审查。

`分镜.md` 的参考图路径是创作阶段可读意图，不是生产输入快照；进入生产以「当前 job 确实读到哪些文件字节、各自被允许影响什么」为准（按 creator 文档或显式 references 建立）。新生产结果不自动回填/刷新分镜，如需改为后续输入由分镜 owner 改文档再建 job。

## 命令与工具映射

- 建立/预览 job、确认、运行、状态、对账：等价于本 preset 里把当前提示词与运行参数写成临时 JSON job，用 DSH 可见的工具执行 `prepare`（展示）→ 显式确认记录 → `run`（触发实际 adapter）。媒体结果写入 `剧集/<EP>/作品集/`，文件名必须包含投产对象 ID 与任务 ID，以便工作台按 job 关联版本。
- `audit` 只对账本地任务历史/失败恢复/输出字节，不调用供应商，也不把文件存在或成功写成媒体质量结论。同一 job 存在未决 running attempt 时禁止重新 prepare/confirm/run，先等待或排查遗留 attempt。

## 输入选择

- **image**：读 `图片提示词.md` 当前 `IMG-*` 可复制正文、必要参考图与明确输出尺寸/数量；creator-first job 用 `source_entry` 锁定该条。
- **video**：读 `视频提示词.md` 当前 `MOTION-*` 可复制正文，并核对 `分镜.md` 对应镜头、冻结关键帧、时长与画幅；creator-first job 用 `source_entry` 锁定该条。
- **tts**：从 `剧本.md` 读原句与表演要求，声音参考由用户或现有媒体明确提供，不猜测声音身份。
- **composition/timeline**：按用户在 `视频提示词.md` 指定顺序提取已确认 `MOTION-*` 与 `作品集/` 版本列表执行；输出 `剧集/<EP>/作品集/成片-<jobId>.mp4`（尽力），不改创作者可编辑的提示词。

## 完成与边界
只用已确认 job 生产；每次 job 用摘要展示运行的环境/fitting、字符数与输出。把控制权交还创作者，不自动准备下一批或启动审查；是否继续下一步由创作者点名，下一阶段不能替创作者预设。
