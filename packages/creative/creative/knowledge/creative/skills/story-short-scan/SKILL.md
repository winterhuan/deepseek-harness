---
name: story-short-scan
version: 1.0.0
description: "分析短篇榜单样本中的情绪、题材和传播信号。用于知乎盐言、七猫、黑岩、点众等平台的短篇扫榜；记录样本日期和趋势有效期，区分实时证据与历史假设。"
metadata: {"openclaw":{"source":"https://github.com/zenstory-ai/oh-story-claudecode"}}
---

# story-short-scan — DSH 原生短篇扫榜

基于可核验样本识别短篇市场的情绪、题材与传播信号，不运行打包脚本、不读取 Cookie或 token，也不绕过验证码、登录或访问控制。

1. 明确平台与方向；只有答案会改变采样范围时才问一个问题。
2. 数据来源依次为：用户提供的数据或链接、当前 DSH Preset 可见的网页工具或通过 `browser-cdp` 使用 Lightpanda 获取的页面、references/real-market-data.md 中的历史资料。调用 `browser-cdp` 前检查当前 shell 能力和依赖；无法联网时必须把结论标为候选假设。
3. 记录来源 URL、采集日期、榜单口径、有效样本数、缺失字段和异常项。
4. 分析情绪类型、题材热点、篇幅、开头、结尾、标题、人设与传播触发点；给每个趋势标注证据强度、饱和风险和有效期。
5. 输出市场概况、情绪热度、题材热点、关键数据、风口预警、三项可写方向和复扫时间。

无法取得网页且用户也未提供样本时，只做历史资料分析并列出验证动作；不接管用户 Chrome，也不启动并行 Agent 运行时。
