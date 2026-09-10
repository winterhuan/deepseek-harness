---
name: browser-cdp
description: "使用 Lightpanda 和 agent-browser 读取动态网页、提取榜单与页面数据、执行点击和表单输入。适用于无需完整视觉渲染的浏览器自动化；不接管用户 Chrome、不复用 Chrome profile，不承担截图或 Canvas/WebGL 视觉验收。"
---

# browser-cdp — Lightpanda 网页操作

通过当前会话的 shell 能力使用 Lightpanda：一次性读取用 `lightpanda fetch`，连续交互用 `agent-browser --engine lightpanda`。由当前 DSH Agent 决定操作，不运行 `lightpanda agent`、`agent-browser chat` 或第二套 Agent/Dashboard。

## 依赖与适用范围

先在实际执行命令的环境中检查依赖，不把宿主机安装视为远端沙箱可用：

```bash
agent-browser --version
agent-browser --help
lightpanda version
```

操作序列已用 `agent-browser 0.37.0` 验证；npm 安装该版本需要 Node.js 24+。`--help` 中出现 `--engine` 不足以证明兼容：旧版首次连接超时时，应核对双方版本并升级，而不是反复增加等待时间。安装方式见 [agent-browser](https://github.com/vercel-labs/agent-browser) 和 [Lightpanda](https://github.com/lightpanda-io/browser#install)。依赖缺失时先说明并按当前权限安装，不改写用户全局配置、不静默回退到 Chrome。

Lightpanda 支持 JavaScript、DOM、表单和 Cookie，但没有完整网页图形渲染。文本快照不能证明 CSS 布局、图片、Canvas、WebGL 或游戏画面正确；需要这些验收时使用相应的真实浏览器能力。它也不能接管用户已经打开的 Chrome 标签页或使用 Chrome profile、扩展、headed 模式。

## 一次性读取

不需要连续交互时优先直接提取 Markdown；以下命令关闭遥测、遵守站点 robots.txt，并将 HTTP 错误作为失败返回：

```bash
LIGHTPANDA_DISABLE_TELEMETRY=true lightpanda fetch \
  --obey-robots --fail-on-http-error --dump markdown "<URL>"
```

把 `<URL>` 替换为任务指定或已核验的地址。HTTP 404/500 的正文也可能被输出，不能只因输出非空就声称成功。每次 `fetch` 是独立执行，不继承 `agent-browser` 会话的登录态。动态等待与输出选项按需查看 `lightpanda help fetch`。

## 连续交互

### 1. 创建任务独占会话

```bash
BROWSER_SESSION="creative-$(node -p 'crypto.randomUUID()')"
LIGHTPANDA_DISABLE_TELEMETRY=true agent-browser \
  --session "$BROWSER_SESSION" --engine lightpanda open "<URL>"
agent-browser --session "$BROWSER_SESSION" --engine lightpanda snapshot -i
```

保留生成的会话名，每条后续命令显式传入同一个 `--session`。分次调用 shell 工具时填入已生成的值，不假设变量跨调用保留，也不要重新生成或使用共享的 `default` 会话。`agent-browser` 负责启动和关闭 Lightpanda，不手动管理 Chrome 进程、固定 CDP 端口或调试 profile。

若 Lightpanda 不在 PATH，可在启动命令中指定 `--executable-path /absolute/path/to/lightpanda`，后续调用保持相同启动选项。先检查用户现有配置是否带有 Chrome 专用参数；需要隔离时在临时目录准备内容为 `{}` 的配置文件，通过 `--config /absolute/path/to/config.json` 使用，不覆盖用户配置。

### 2. 从快照选择元素并操作

快照返回 `@e1` 等引用。下例的 `@e2`、`@e3` 和选择器仅为示意，必须替换为本次实际观察到的目标：

```bash
agent-browser --session "$BROWSER_SESSION" --engine lightpanda fill @e2 "检索词"
agent-browser --session "$BROWSER_SESSION" --engine lightpanda click @e3
agent-browser --session "$BROWSER_SESSION" --engine lightpanda wait "#results"
agent-browser --session "$BROWSER_SESSION" --engine lightpanda snapshot -i
```

导航或页面更新后重新获取快照，不跨页面复用旧引用。按目标元素或状态等待，不把固定休眠当作加载完成。发布、付款、删除或其他改变远端状态的动作必须属于当前用户授权；发现登录页、验证码或访问限制时说明实际状态，不伪造完成或绕过限制。

### 3. 读取与结构化提取

```bash
agent-browser --session "$BROWSER_SESSION" --engine lightpanda get title
agent-browser --session "$BROWSER_SESSION" --engine lightpanda get text "#results"
agent-browser --session "$BROWSER_SESSION" --engine lightpanda eval "document.title"
```

复杂 JavaScript 用 `--stdin` 避免 shell 引号和变量展开；`eval -b` 也接受 base64 编码的脚本：

```bash
agent-browser --session "$BROWSER_SESSION" --engine lightpanda eval --stdin <<'JS'
Array.from(document.querySelectorAll('a')).map(link => ({
  text: link.textContent,
  href: link.href,
}))
JS
```

只提取任务需要的数据。采集榜单时记录来源 URL、采集时间、分页范围、去重依据和未完成项；区分页面事实、搜索摘要与推断。发现重复页、无新增记录或访问失败时停止相应分页，不无限重试。

## 会话与登录态

同一个活动会话内可以保留站点的 Cookie 和 localStorage；它们属于 Lightpanda 的独立会话，不是用户 Chrome 的存储。关闭后用相同名称重新打开也不能当作登录态恢复；不要使用 Chrome 的 `--profile` 或假设 `--state`、`--restore` 可用。

只在任务明确需要且用户授权时处理认证数据，不扫描用户浏览器配置或批量输出 Cookie/token。无法在当前会话完成登录时，说明限制并请求可授权的资料或其他浏览器能力，不自动接管用户 Chrome。

## 结束与排障

任务完成、取消或失败时关闭自己创建的会话：

```bash
agent-browser --session "$BROWSER_SESSION" --engine lightpanda close
```

不要使用 `close --all`、按程序名批量结束进程或修改其他任务的会话。关闭失败时仅处理已确认属于本任务的进程；无法确认归属时停止并报告。

| 情况 | 处理 |
|------|------|
| 找不到 Lightpanda | 检查同一执行环境的 PATH，或使用已核验的 `--executable-path` |
| 首次 `open` 即连接超时 | 核对两个程序的版本和路径，用小页面验证连接；兼容性未确认时不要继续批量采集 |
| 提示 profile 等参数不支持 | 检查命令及继承的配置，使用不含 Chrome 专用参数的任务配置 |
| 引用失效或目标未出现 | 重新获取快照，确认 URL 与页面状态，再选择当前存在的目标 |
| HTTP 错误、登录页或验证码 | 记录 URL 和实际失败；不能把错误页或空样本当作采集成功 |
| 需要真实视觉验收 | 说明 Lightpanda 不足以完成该验收，不能用文本快照代替视觉证据 |
