# Agent Note: Creative 工作台、内置知识库与技能查看器

Status: implemented

[English](2026-09-03-creative-workbench.md) | 中文

## 问题

小说、短剧、互动游戏和视频解说共享素材、项目文件与付费制作，但原始工具分别假定独立运行时和 Dashboard。各自实现无法可靠共享 DSH 的权限、Session 历史、取消机制和项目身份。编辑器还必须区分未保存草稿与磁盘内容、准备请求与执行中的作业，以及仅面向人的技能浏览与模型可见的技能加载。

## 决策

Creative 是一个覆盖四个域的插件，使用 DSH 已有的 Agent、工具、文件系统、设置和作业服务。右侧 Sidebar 拥有展示布局。独立、可选的只读技能查看器检查 Session 的技能组合，不调用工具，也不恢复 Agent。

<a id="composition-and-knowledge"></a>
### 组合与知识库

[`dsh-creative`](../../../../packages/creative/creative/README.zh.md) 仅要求 `skills`、`subagents` 和 `tools`；`/creative` 路由在单独的 `webServer` 与 `typert` 注入作用域中注册。Headless 组合无需 Web 服务即可保留 Skill、Role 和生产工具。注册随插件释放而撤销，不发布空的运行时不变量伴随插件：文件、请求和作业检查在实际授权操作中执行。

四个内置 provider 保留独立发现名称，同时共用发布版本与工作台。每份 `SKILL.md` 拥有描述和完整正文；provider 只前置共享的 DSH 集成说明。全部 36 个描述都符合目录默认的 500 字符限制。七个 Role 通过 `subagents.spawn` 作为子 Agent 运行，使用 `maxDepth: 1` 和逐角色工具过滤。Role 使用调用者提供的项目路径，通过封闭的 `creative_bundled_reference` 读取打包资料；工作区技能不能遮蔽该读取器。作者记忆回执、章节 Tracking、必读参考和质量检查仍属于写作流程。封面生成要求实际可用的图片或鉴权 HTTP 能力，不能虚构生产入口。

四个 provider 共用调用说明，将工作流名称与 `$name`、`/name` 引用解析为 `skill` 加载。`creative_role` 保留封闭的小说 persona 枚举并继承 DSH 模型；通过普通 `subagent` 委派时，要求子 Agent 加载指定 Skill。把阶段当成小说 Role 会替换其指令和工具权限。资料研究使用原生网页工具，需要浏览器的来源交回调用方，不要求固定调试端口。拆章重试在 prompt 中携带具体反馈，不传不支持的模型覆盖参数。

知识库 manifest 是 `skills`、已有 `roles` 和 `examples` 的描述性目录，可附适配说明。不包含提交固定值、schema 计数、生成时间、逐文件哈希或强制变更分类；加载独立读取打包文件。Git 拥有内容历史。内置游戏示例使用稳定的 `bundled` 标识，工作区预览保留独立的文件系统摘要与 QA 新鲜度检查。

小说技能在本地 CLI 和导入入口后共用打包的命令实现。JavaScript 按 ESM 运行；缺失可执行程序、结果格式无效或退出状态不一致会阻止章节交付，不计为检查通过。只复制某个小说技能目录并不包含共享运行时。短剧和视频保留可独立分发的脚本资源。

`browser-cdp` 使用 `agent-browser --engine lightpanda` 交互，使用 `lightpanda fetch` 单次读取；每项任务拥有命名会话并负责清理。导航、快照、表单输入和 JavaScript 提取无需 DSH 浏览器 provider 或 CDP 抓取器实现。Lightpanda 既不提供用户 Chrome profile，也不提供游戏 QA 所需的视觉渲染。

<a id="workspace-and-sidebar"></a>
### 工作区与 Sidebar

一个 Session 级 `creative` 页面向 `sidebar.right.pane.tab` 提供内容。右侧 Sidebar 拥有位置、缩放、分割、浮动、全屏和可见性；Conversation 保留对话与输入框。引导页在空工作区也提供 Creative，但创建项目文件不会自动打开它。`conversation/open-file` 仅接管识别出的 Creative 文件，其他路径及其行号导航交给普通资源预览。Sidebar 参数与 revision 传递导航；Session inject face 对每个标签页的 revision 只消费一次，避免重新挂载覆盖用户后续选择。

持久化的 `creative.workbench.v2` store 保留缓冲区、冲突、选择和生产草稿。完整列表移除已删除的干净缓冲区，但保留脏稿，包括此前已标为缺失的草稿；不完整列表不能证明删除。读取跟随文件版本，并保留草稿最后确认的 CAS 版本。迟到的响应和错误不能发布到其他 Session。Store 创建时移除旧的持久化 `saving` 标记；真正进行中的保存锁归 Session 所有、不持久化，在标签页重新挂载后仍有效，直至请求结束。

游戏和视频预览在进入对应域时加载，标签重新挂载后可能重新启动。项目的首个视频会填充空预览；后续版本需要用户选择。关闭页面既不取消生产，也不删除草稿。样式经 Client 模块加载，不由每个工作台或工具卡片分别加载。

<a id="project-and-file-ownership"></a>
### 项目与文件归属

[共享解析器](../../../../packages/creative/creative/src/project-path.ts) 在支持的发现深度内识别根项目、直接书籍目录、`长篇|短篇/<book>`、独立故事及游戏/视频入口。完整项目/剧集路径标识元数据、选择、草稿和素材过滤；重复的 `EP001` 或 `SHOT-001` 不是全局身份。Host 操作还检查扩展名白名单与解析后的文件系统包含关系，包括符号链接。章节正文、必需大纲和 Tracking 文件必须属于同一项目。写入后的 Tracking 提醒是记录在日志中的模型可见上下文，不是未记录的提示词修改。

短篇工程从首个标准文档开始即可见，因为写作技能先创建设定和大纲，再创作正文。对于章节目录和短篇独立文档，编辑器都优先选择正文，其次选择大纲。

工作区请求只接受 loopback 或显式配置的 `trustedHosts`，配置在加载时校验。文本保存使用 `FsVersion` 比较并交换。列表最多计入 1,000 个符合条件的创作者文件，只有再观察到一个符合条件的文件才设置 `truncated`；恰好 1,000 个文件仍为完整。依赖目录、Python 缓存、隐藏目录和视频工作区既不消耗该预算，也不影响游戏预览新鲜度。警告不提供分页，也不使更大的项目变完整。

Session 文件系统 provider 拥有媒体字节。Host 直接流式读取要求 provider 在 Host realpath 解析前后明确映射根目录与文件，并检查包含关系和大小；仅路径字符串与大小相同并不足够。否则通过 provider 读取，每个媒体文件上限为 256 MiB，包括 Range 请求。媒体支持 RFC 9110 字节范围。游戏预览使用仅允许脚本的沙箱、CSP 与不同 loopback 源；验证按来源和证据维持 Current、Stale、Unbound 或 Pinned 状态。

<a id="production-and-credentials"></a>
### 生产与凭据

`creative_production` 并发安全地投影工作台意图，不编辑创作者文档，也不授权付费生成。卡片的 `ProductionRequestId`、准备消息的 `SessionRequestId` 和执行的框架 `JobId` 保持独立。队列项通过 `rpcId` 关联；绑定要求真实的 Session 所属作业及其 `startedAt` epoch。合成先通过普通后台命令工具启动，再调用 `track_job`。Native 结果在 metadata 和紧凑 JSON 中保留绑定；PTC 在其 dispatch 事件中保留 JSON。增量 Conversation 投影使用这些日志结果，无需新增历史流或 Session 格式。

只有 `jobsBySession` 在控制基线完整后提供执行状态，而该基线的就绪状态由独立的 `sessions.jobsBaseline` 订阅面报告。控制流丢失会使就绪状态失效；连接就绪通知不会丢弃已接受的基线。历史未绑定请求仍是请求，Host 重启后无法匹配的作业显示不可用，不视为完成或自动重启。一个卡片可拥有多个作业；结束作业数、对话 Turn、文件或估计百分比都不能证明计划成果已成功生成。前台结果分别保留退出码、超时、信号和有界输出；非零或未知退出码使生产失败。

`creative_produce_run` 通过 DSH shell 执行封闭的短剧、配音、recap 和诊断入口，遵循参数引用、工作区解析和沙箱策略。缺少执行服务时在调用时报错。该工具可能产生花费，因此不声明并发安全。短剧要求已 prepare、明确 confirm 的 `job_id` 与匹配 adapter；拒绝替换作业 JSON 或附加参数。只有 `argv: ["--selftest"]` 选择离线短剧诊断，且不接受作业、stdin 或生产绑定。在项目锁内，`production_tool.py` 检查作业和未使用回执、快照确认输入、在 provider 执行前消费确认、验证暂存成果、发布并写入账本。前后台调用共用该执行器。Prepare 与 confirm 使用同一份按文档定义的 `CREATOR_SOURCE_ENTRIES` 映射，因此分镜 `SHOT-` 图片作业有效，而跨模态绑定失败。

`creative-produce` profile 存放六个凭据引用和非秘密运行设置；密钥字面值属于凭据存储。每次调用将引用解析为 adapter 的规范变量：`AGNES_POOL` 可以提供 `AGNES_API_KEY`。秘密通过显式子进程环境和私有密钥池 stdin 传递，不进入命令文本、模型参数或全局 `process.env`；普通 `bash` 不自动接入。逗号分隔的引用和存储值中换行分隔的密钥组成密钥池。调用间轮换起始密钥；单次短剧运行最多接收十六个不同密钥，只有相同 URL 的首次提交返回 HTTP 401/403/429 且明确标记 `submission_rejected` 才切换。已受理请求、轮询、下载和结果不确定的失败绝不触发自动重投。执行器用自身超时约束尝试和等待，不由外层进程重试重启。

生产设置卡片统一暂存非秘密编辑，并在一次读取中描述六个引用。响应始终关联其描述的引用，因此改名不能发布旧结果。秘密草稿初始为空，空值不写入；批量密钥文本留在对话框本地，直到明确保存。插件配置初始化 profile，用户设置覆盖它。视频高级调优保留在经过校验的环境选项中；Agnes 与其他 adapter 共用执行器、确认和设置归属。

Agnes 视频将未设置或空白模型解析为免费的 `agnes-video-2.5-flash`；显式配置可以选择按秒计费的 `agnes-video-2.5`。在项目锁内，执行器先用 adapter 的请求编译器校验已确认快照，再消费回执或写入尝试。本地模型、参数和参考输入错误保留具体诊断及未使用确认。provider 子进程再次编译同一快照，保持 adapter stdin 格式，代价是第二次有界参考文件读取和编码。供应商提交、轮询和下载失败仍遵守一次性确认规则。

视频调用以一次轮换密钥环境执行一个脚本，由 Skill 要求创作者确认，不使用短剧回执或账本。Recap 调用可执行的 `recap.py`，而非参数解析模块。独立理解和语义评审没有专用鉴权入口；仅分析的请求不得针对已有下游输入启动完整 recap、虚构参数或删除工作来绕过限制。

停止操作在调用 `jobs.kill` 前验证 Session 所有者和精确作业引用，再等待注册表状态，包括完成竞争。撤回只移除指定队列项；已受理但没有作业的请求没有停止生成操作。停止既不取消对话，也不消费输出；框架 kill 语义将终态投递标为已报告，不注入模型可见的成功或失败消息。共享的[后台作业展示决策](2026-08-08-web-background-job-display.zh.md)拥有该非消费控制流。

`creative_produce_status` 使用与生产执行相同的配置和凭证解析，只报告非敏感的凭证状态，不启动子进程或消费确认。经过凭证清理的 shell 环境不代表凭证库，因此 Skill 通过该工具检查缺失密钥，并将配置好的 Agnes 生图任务交给 `creative_produce_run`，使用 `adapter: agnes-image`。

<a id="adaptation-and-source-material"></a>
### 改编与来源记录

Skill 将小说到短剧路由至导出包，将小说到游戏路由至小说分析，将短剧到视频路由至从 `制作成果/` 复制到 `sources/`。独立短篇可以直接读取。小说导出器按数字章节顺序原样生成 `原著.txt`，并写出包含零基 `[start, end)` 行范围、源路径和 SHA-256 哈希的 `章节映射.json`。重复编号、非章节文件、缺失标题和编号不匹配都会失败，不静默破坏引用。导出只包含正文和映射，不在缺少消费者时透传风格或 Tracking。

`改编谱系.jsonl` 是位于工作区根目录的只追加账本，在改编接入时记录来源指纹与决策。文件按字节计算哈希；目录按排序后的路径/哈希清单计算。目标可以尚不存在，纯交付复制可以没有决策文本。账本保持在不可变、归流水线所有的 `SOURCE_BIBLE` 之外，保留游戏 QA 证据。不存在短剧到游戏的接入：同 IP 改编共享原著小说，不将压缩后的剧本当作游戏设计来源。

<a id="read-only-skill-viewer"></a>
### 只读技能查看器

[`dsh-skill-viewer`](../../../../packages/skill/skill-viewer/README.zh.md) 拥有按 Session 寻址的 `skillViewer` Remote 命名空间。`listDetails` 返回用户可调用条目及 source/provider 元数据，用 `stale` 表示不完整的 provider 观测；`get` 原样返回加载后的正文与 JSON 安全的资源基址。解析使用 `sessionQuery`、活动 Agent 的 preset 级注册表，或冷 Session 已记录 preset 的 standing scope，并可回退至全局注册表。不恢复 Agent，这些仅面向人的读取不写 Session 事件或模型上下文。

[`dsh-client-ui-skill-viewer`](../../../../packages/client/ui-skill-viewer/README.zh.md) 提供侧栏底部入口与模态面板，按 Session 缓存成功读取并复用同一在途请求。Preset 切换和连接重置使缓存失效；切换 Session 使用对应 Session 的数据。随附的 `web-app` bundle 挂载两个插件，`api-remotes` 挂载生成的 `skillViewer` Client contribution。Composer 的 `skills` 命名空间保持不变。查看器没有 watch，因此仅重新打开不会刷新已变内容；Session 回放不重建浏览记录。

查看器使用视口可用高度，宽屏将搜索列表放在阅读区旁边。打开时选择首个匹配技能，元数据保持展开；窄屏只显示一栏并固定返回控件。只有列表内容和阅读内容滚动，顶部保持可见，切换技能或参考文件后从开头阅读。提供方 `references/` 目录中的本地文件在同一阅读区打开，不调用模型工具。Host 读取拒绝越界、隐藏路径、链接和非文本内容；可配置的目录条目与字节上限明确报告截断。离开参考文件视图时取消读取，技能正文与列表保留按 Session 缓存。

<a id="localization"></a>
### 本地化

工作台界面使用类型化 `creative` locale 命名空间，包含键一致的中英文片段，并显式传递翻译器。插件设置文案归 `settings.plugins` 所有。Client i18n 检查不豁免 Creative。生产诊断使用消息键与参数；视频阶段、素材标签和预览角色按代码翻译，未知视频阶段回退至 Host 标签。

工作区名称、创作者协议标识和生产提示词保持 zh-Hans，不随浏览器 locale 改变。操作性路由错误和运行时失败保留 zh-Hans，直至稳定的错误码分类支持展示时翻译。纯解析器不本地化结果。

## 考虑过的替代方案

**按域拆包、沿用上游 Dashboard 或独立 Role 运行时。** 它们重复发布、路由、权限、Session 和取消归属，而改编跨越域。某域生命周期状态增长时拆 store slice，单卡片不足时拆设置命名空间；都不要求四个应用或另起服务端。

**运行时重写 Skill 或生成替代工作流。** 多个指令拥有者使文件编辑可能无效。共享集成文字已经足够，无需缩减专业分工、成果格式或质量要求。小说重复实现没有必要，但跨四套资源共用一个运行时会破坏短剧/视频独立分发。

**哈希清单、manifest 生成器、整树 fork 标签或 Cordis vendoring 规则。** 它们都不为打包知识提供运行时完整性验证，却重复 Git 或把少量本地差异隐藏在整树标签中。删除目录也会丢失有用的技能/角色/示例清单。未来的外部下载器需要自己的完整性记录，不是预先增加 manifest 记账。

**第二套 Conversation 工作区、按文件/域拆 Creative 页面或重挂 Chat DOM。** 自动打开和保留预览 DOM 提供连续性，但需要另一套布局、断点和生命周期策略。独立页面重复项目协调状态；DOM 接管绕过 slot 的挂载、滚动和无障碍归属。Sidebar 提供控制，以持久草稿而非不中断预览提供连续性。

**持久保存锁或挂载时重置锁。** 持久化不能证明请求跨刷新存活，重新挂载时重置则允许重复写入。Session 级临时锁与真实操作生命周期一致，无需改变草稿持久化或 CAS 行为。

**无界扫描、Client 推断上限或仅按词法检查文件。** 递归发现可能让每次刷新变为昂贵爬取；返回计数会让 Client 重复定义预算。符号链接及相同的远端/Host 路径需要独立于解析和列表完整性的明确授权。

**第二个调度器，或从文本、Turn、文件、百分比推断执行。** 并发请求和后台工作让这些观测含糊。重复的运行状态表虚构重启恢复；日志绑定与既有作业注册表保留意图，不声称不存在的执行。

**在设置、shell 前缀或全局环境中保存秘密。** 设置被共享和展示，命令文本会记录日志，全局修改则在 Session 间竞争并绕过凭据清理。显式凭据引用与逐调用转发保留生产调用的归属。

**仅提示词约束短剧确认、以投影授权或重试整个运行。** 它们都不能将花费原子地绑定到确认输入与验证发布；受理后重启可能重复付费。跳过 SHOT 确认会移除创作者检查点，在图片提示词中复制关键帧会分裂事实来源，将执行器复制到 shim 则掩盖共享的文档/模态规则。

**强制选择免费模型，或仅在准备阶段校验模型。** 免费默认值允许仅配置密钥的 Agnes 环境工作，同时保留显式付费选择。独立准备命令无法查看 DSH 的执行配置；运行时预检可以同时取得解析后的模型和已确认字节。只在消费确认后检查，会让未到达供应商的输入耗掉回执。

**让短剧索引器接收分片、猜测非数字章节顺序或向 `SOURCE_BIBLE` 添加谱系。** 导出保留索引器的单文件范围模型和可独立引用的源章节。猜测楔子/番外顺序破坏引用，支持它需要显式顺序清单。风格透传需要消费者，流水线来源的不可变性不应依赖无关的改编记账。

**扩展 Composer 命名空间、通过 `skill` 工具浏览或由 Client 读取 Host 文件。** Composer 消费者不需要查看器载荷；工具读取会为人的浏览创建模型可见日志。直接文件读取绕过 preset 层、自定义 provider 与调用策略，并暴露 Host 路径。未来需要 watch 或从查看器调用时应扩展查看器命名空间。

**保留 i18n 豁免，或把模型提示词与 Host 错误当作界面翻译。** 豁免使文案缺少拥有者，随浏览器 locale 翻译提示词会改变模型行为。Host 错误翻译需要稳定代码，不能猜测协议文本的含义。

## 验证

[Creative 测试](../../../../packages/creative/creative/tests/)覆盖 provider 正文、共享脚本、项目分类、符号链接与媒体 provider 隔离、精确列表上限、草稿协调和释放。[Loader 组合测试](../../../../packages/creative/creative/tests/loader-composition.spec.ts)证明无 Web 服务时的 headless 注册。视频预检测试覆盖探测映射、Python 回退及 30 秒缓存；原生钩子测试固定成功写入正文后的日志 Tracking 提醒，以及失败或拒绝时不出现提醒。

[生产执行器测试](../../../../packages/creative/creative/tests/produce-contract.spec.ts)用离线 fixture 执行内置 Python 路径，检查规范凭据、确认、不可变输入、重试和成果发布。Agnes 视频用例覆盖免费默认值、显式付费选择、三张参考图，以及本地拒绝后确认字节不变、不产生尝试或网络调用。分镜确认另有已记录的 SHOT/IMG/MOTION × image/video 六格矩阵与真实 prepare-to-confirm 验证；完整矩阵没有作为回归测试提交。导出器自测重建章节范围并拒绝无效输入；与 `novel_index.py` 的 20 章交叉检查完整保留 20 章且无问题。谱系自测覆盖往返与六种无效输入。

[技能加载快照](../../../../snapshots/session/creative-skill-load/snapshot.yml)通过 headless profile 固定四域的代表性指令与离线视频帮助。[工作台 Web 场景](../../../../apps/web/tests/workbench-presence.e2e.ts)比较录制的 Session 与最终工作区输出，同时覆盖原生标签页、草稿、重复打开文件、全屏和窄屏布局。[生产 Web 场景](../../../../apps/web/tests/creative-production.e2e.ts)覆盖 Native/PTC 绑定、多作业、重复项目内 ID、无关 Turn、刷新、定向停止和 Host 重启。其[作业归一化](../../../../packages/test-support/session-snapshot/src/production-jobs.ts)保留身份/epoch 关系，不重写任意正文。

[查看器 Host 测试](../../../../packages/skill/skill-viewer/tests/)包含真实 Loader 组合与释放；[Client 测试](../../../../packages/client/ui-skill-viewer/tests/)覆盖注册、面板和 Session 级请求缓存。Locale 检查验证字典一致性以及不存在 Creative 豁免。

已记录的 macOS x86_64 冒烟使用 `agent-browser 0.37.0` 和 `Lightpanda 1.0.0-nightly.9231+b21ec6085`，覆盖 Markdown 提取、快照、中文输入、点击、选择器等待、stdin/base64 JavaScript、跨页 Cookie/localStorage 保留及关闭重开后的空状态。HTTPS 提取成功；HTTP 404 配合 `--fail-on-http-error` 返回 22；Chrome profile 被拒绝。同一引擎在 `agent-browser 0.26.0` 连接阶段超时，因此识别 `--engine` 不能证明兼容。该冒烟隔离下载与会话，不改变用户 Chrome 或全局安装。

## 影响

Creative 使用同一套 DSH 组合及既有 Session 格式。模型可见的 Skill、Role、工具和写入后提醒仍记录日志；仅面向人的查看器读取明确不记录。知识库与内置游戏 Demo 增大克隆和包体积；按需分发仍可在不改变 provider 发现机制的前提下实现。

远端文件系统读取不会将打包脚本传入远端 shell：部署必须挂载或复制这些资源。Sidebar 标签页生命周期不保留预览运行时。取消或中断的短剧运行可能留下已消费回执和未解决的 running 账本状态；该回执和无法匹配的进程内作业均不会自动复用或重启。

视频仍由 Skill 约束确认，不使用短剧回执/账本。非数字章节排序、风格透传和查看器 watch 均未实现。Provider fixture 与 Session 回放不证明真实服务可用性、计费行为、站点级浏览器兼容性或生成媒体质量；浏览器指令快照不执行浏览器自动化或完整创作流程。
