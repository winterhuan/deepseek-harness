---
name: short-drama
description: 基于文件系统初始化和继续短剧或漫剧项目，提供 creator-first 五文档路由、制作形态与 Look Development 决策。用户提出“创建/继续短剧项目”“看进度/下一步”“做 Look Development”“打开短剧创作台”“导出制作资料”，或任务跨多个创作阶段时使用；明确的写作、资产、提示词、分镜或审查请求由对应子 skill 直接处理。
license: MIT
---

# 短剧创作路由

本技能负责项目初始化、跨阶段路由、制作形态与 Dashboard。各阶段正文由对应 owner 完成。来源：Drama Skills 0.6.1（MIT），经 DSH 桥接适配 —— 脚本命令改为 DSH preset 可见的文件/工具操作。

## 项目约定

所有项目统一使用 creator-first 五文档工作流：每集按需维护 `剧集/<EP>/` 下的 `剧本.md`、`视觉设定.md`、`分镜.md`、`图片提示词.md`、`视频提示词.md`。不预建空文件、不建立并行的结构化创作真相。`项目开发/` 是可选的长期材料分析工作区，不参与单集布局判定；写任何一集仍只维护该集的五份创作文档。项目状态板 `.drama/board.json` 只由 `drama_board` / `drama_track` 工具读写。

## 路由

| 用户要做什么 | owner / 行为 |
|---|---|
| 开发点子、系列承诺、改编和分集 | `$short-drama-develop`，仅在用户需要时 |
| 已有完整剧本/散稿识别分集 | `$short-drama-develop` 按实际边界建立临时索引 |
| 长篇小说/连载拆解分析 | `$short-drama-novel-analyze`（只读，可续跑） |
| 写或改单集剧本 | `$short-drama-write` → `剧本.md` |
| 拆人物/造型/地点/道具 | `$short-drama-assets` → `视觉设定.md` |
| 写资产图片提示词 | `$short-drama-image-prompts` → `图片提示词.md` |
| 做镜头/冻结关键帧 | `$short-drama-storyboard` → `分镜.md` |
| 写视频/时间线提示词 | `$short-drama-video-prompts` → `视频提示词.md` |
| 实际生成媒体 | `$short-drama-produce`，先预览，再显式确认，最后运行 |
| 审/校验 | `$short-drama-review`，仅在用户点名时 |
| 初始化、Dashboard、归档点名文档 | 本技能 |

现成剧本可直接拆资产；已有视觉事实可直接写图片提示词或分镜；已有分镜可直接写视频提示词。不要为补齐名义流水线伪造上游。

## 执行请求

1. 找到用户给出的项目/材料，只读当前任务的直接输入。
2. 把用户点名的完整范围交给对应 owner；批次只控制上下文，自动续跑。
3. 只有真实创作分叉才询问，不拿 schema/目录/事务/检查器问创作者。
4. 范围完成一次回报完成内容、关键决定、真实未决项和可选下一步。
5. 不自动开始用户没点名的审查、归档或生产。

## 初始化

项目需要状态时用 `drama_scaffold`（建立 `.drama/state.json` 与 `剧集/` 目录；不建空的五份文档）。需要目录时用 `drama_board` 登记集。Dashboard/工作台由 Web「短剧」视图读取同名目录，`$short-drama-produce` 的确认流程由该工作台和 `short_drama_production` 工具驱动；本技能不擅自启动媒体生产。

## 项目级创作决定

制作形态、视觉方向、播放面与集长目标约束多个阶段时，展示选择及影响后由创作者决定。Look Development 是可选分支，不是进入图片提示词或分镜的固定门槛。

## 规则分级与所有权

- 规则分级：`structural_invariant`（本地可证）、`reviewed_invariant`（语义义务）、`craft_default`（可覆盖）、`taste_option`（选择）。
- 对外交付永远 `preview → 显式确认 → run`；归档只复制用户点名文档与成品，排除私有输入、凭据、绝对路径与隐藏运行状态。
