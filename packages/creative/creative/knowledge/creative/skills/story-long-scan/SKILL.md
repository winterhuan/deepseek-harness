---
name: story-long-scan
version: 1.0.0
description: "分析长篇网文榜单样本，识别题材趋势、市场风险与可写方向。用于起点、番茄、晋江等平台的长篇扫榜；使用用户资料或当前可见网页工具，区分实时证据与历史假设。"
metadata: {"openclaw":{"source":"https://github.com/zenstory-ai/oh-story-claudecode"}}
---

# story-long-scan — DSH 原生长篇扫榜

基于可核验样本识别长篇网文趋势，不运行打包脚本、不提取登录凭据，也不绕过验证码、访问控制或站点限制。

1. 明确平台、频道和题材方向；只有答案会改变采样范围时才问一个问题。
2. 数据来源依次为：用户提供的数据或链接、当前 DSH Preset 可见的网页工具或通过 `browser-cdp` 使用 Lightpanda 获取的页面、references/genre-trends.md 中的历史趋势。调用 `browser-cdp` 前检查当前 shell 能力和依赖；无法获取实时数据时必须明确标为历史假设。
3. 每个样本记录来源 URL、采集日期、榜单口径、有效条目数、缺失字段和异常项；不把搜索摘要、推断或过期缓存写成页面事实。
4. 按题材分布、新题材信号、经典题材变化、篇幅与更新、书名模式、开头卖点和差异化元素分析。需要决策门禁时使用 references/topic-decision.md。
5. 输出市场概况、题材热度、证据与可信度、风险、三项可执行方向和下次复扫时间。

无法取得网页且用户也未提供样本时，使用内置参考完成方法论分析，并列出仍需核验的榜单；不接管用户 Chrome，也不启动并行 Agent 运行时。
