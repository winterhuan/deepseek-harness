# Agent Note: 创意生产密钥与执行链路

Status: implemented

[English](2026-09-03-creative-produce-credentials.md) | 中文

## Problem

短剧与视频生产需要各提供方密钥（OpenAI、火山 Ark、MiniMax、MiMo、Fish、Agnes），但被 pin 的生产脚本只从 `os.environ` 读取，而所有 DSH 子进程都从 `scrubbedParentEnv` 启动，后者会剥离密钥形态的变量名（`/KEY|PASSWORD|SECRET|TOKEN/i`）。于是无论把密钥 export 到宿主 shell、写进 `.env`，还是贴进聊天，通过 `bash` 工具运行生产脚本时都拿不到密钥——而 Skill 只描述了这一条路径。失败是静默的：适配器报 `missing_credential`，用户在产品里却无处填写密钥。同时，非机密的运行时配置（适配器不设默认值的模型、接口地址、语音路由）也没有设置界面，部署方只能改宿主环境文件。

## Decision

**配置只带引用、不带密钥；执行时再显式透传。** creative 插件拥有 `creative-produce` 设置命名空间，存放 6 个密钥引用与非机密配置（模型、接口地址、轮询/超时、`TTS_PROVIDER`、MiMo 模型/声音）。密钥原文存入 credentials store，经插件配置页的 credentials 域写入。新工具 `creative_produce_run` 每次调用解析配置，把解析结果作为显式 `env` 启动被 pin 的脚本——这正是文档化的、能穿过 scrub 的显式 opt-in。Skill 桥接把“确认任务后的运行步骤”路由到该工具，并明说经 `bash` 直接调脚本永远拿不到密钥。

**工具只运行封闭的脚本集合，不执行任意命令。** 入口只有 `drama`（按 adapter 匹配被 pin 的脚本——`provider_adapters.py`，或 `agnes-image`/`agnes-video` 用的 `agnes_adapters.py`——＋必填 adapter）、`video-voiceover`、`video-recap`、`video-doctor` 四种，其他一律在解析前拒绝。脚本之后的参数以 argv 向量传递并设上限，任务文档走 `stdin`（1 MiB 上限），命令字符串用单引号转义拼接，绝不插值。shell 缝仍负责沙箱策略与工作目录解析；缺少 agent、shell、工作目录或（后台运行时）jobs 注册表都在调用时大声失败。

**长生产任务走后台任务，不占整轮。** `run_in_background` 经 `ctx.jobs` 启动 `produce` 任务（用 `job_output` 收结果、`job_kill` 停止），形态沿用 `bash` 工具的 starter；前台运行返回退出码与有界 stdout/stderr。该工具不是并发安全的：每次生产调用都花真钱。

**一个密钥字段可以填多个密钥。** 每个 `*ApiKeyEnv` 都接受英文逗号分隔的多引用做轮询；一个存值本身也可以用换行分隔多行密钥，于是上万 key 只占一个引用，一次 credentials 读取只做一次查询（`describe` 上限 64 个引用，批量池永远碰不到）。连续调用从下一个解析出的密钥起用。拿到鉴权或权限结论直接换下一个密钥——结论已经给该密钥判了死刑，等也白等；拿到限流结论则按指数退避（1 秒起翻倍、10 秒封顶；单次调用内尝试是串行的，不加 jitter）后再试，池子被限流耗尽后，同 key 再给两次带间隔的重试。单次调用最多尝试 16 次，其他失败原样返回，坏任务、服务端故障或超时绝不消耗第二个密钥；后台任务只取轮询到的密钥，运行中不切换。退避等待可被中止：在等待中取消工具调用会立即拒绝，不会睡完再退。卡片的批量弹框把上万行当弹框本地状态暂存——从不进卡片表单——用自己的保存手势提交。

**卡片把 6 个密钥与配置放在同一页暂存。** 插件配置页的 `creative-produce` 卡片沿用 web-search 卡片形态：一次 `describe` 读全 6 个引用，每个答案都绑定其描述的引用一起存放，改名中途到达的迟到响应无法发布；密钥草稿每次从空白开始，空白草稿不写入。非机密字段作为普通 section 编辑随同一保存写入。文案放在共享的 `settings.plugins` 字典。

## Alternatives considered

**把解析出的密钥镜像进 `process.env`，让 `bash` 链路继续工作。** 拒绝：由设置写入触发的进程级环境变更不可审计、多会话竞态，且把 scrub 正要清除的环境密钥又引了回来。按调用显式透传让密钥的生命周期收敛在生产调用内部。

**把密钥原文存进 settings section 的 `role('secret')` 字段。** 拒绝：那会让密钥进入会被同步、共享与渲染的 `settings.yaml`，违背 credentials 缝的唯一信条。用引用则轮换密钥只需换值，不改配置。

**教 Skill 在 bash 命令前拼 `KEY=value` 前缀。** 拒绝：原文会落进 session log 与聊天记录——模型可见且持久化，而 Skill 桥接正好禁止这一点。工具的显式 `env` 从不进日志。

## Consequences

- `packages/creative/creative` 新增 `produce-settings.ts`（命名空间、schema、按调用解析）与 `produce-tool.ts`（`creative_produce_run`），覆盖率均为 100%；插件 `Config` 新增可选 `produce` 节，为命名空间提供 base 层。
- `packages/client/ui-settings-plugins` 新增 `creative-produce` 卡片、控制器与双语文案； shipped 卡片清单测试改为枚举 5 张卡。
- 短剧与视频 Skill 的准备/确认流程不变，只有运行步骤移到新工具，既有确认记录与付费生产确认契约不受影响。
- video-recap 的深度调优（workers、重试、语速、QC 开关）仍走环境变量高级配置：schema 只收创作者常用项，其余仍由适配器校验。
- Agnes 图片与视频走 `agnes_adapters.py`——复用被 pin 上游模块 helpers 的 DSH 侧伴生文件，上游文件本身与 manifest pin 保持字节一致；drama 任务按 adapter 名路由到它。Agnes 设置分组收密钥引用、接口地址与两个模型 ID；视频轮询/超时配置与 MiniMax/Seedance 一样仍走环境变量高级配置。flash 视频模型免费而 `agnes-video-2.5` 按秒计费，因此确认任务时必须连模型一起确认。
