---
name: story-setup
version: 1.2.10
description: "在当前 DSH 工作区初始化或校验小说工程，保留已有正文、设定、大纲和追踪数据。用于“准备写书”“创建小说项目”“修复工程结构”；不部署 Agent 平台文件或修改运行环境。"
metadata: {"openclaw":{"source":"https://github.com/zenstory-ai/oh-story-claudecode"}}
---

# story-setup — DSH 原生小说工程初始化

只初始化或校验当前 DSH workspace 中的小说数据，不部署任何 Agent 平台文件。

1. 检查现有正文、设定、大纲和追踪文件，已有内容绝不覆盖。
2. 根据用户声明与现有结构判断长篇/短篇；无法可靠判断时请求确认。
3. 长篇按需建立 正文/、设定/、大纲/、追踪/，并准备追踪/_tracking-state.json；第一章正文落盘前必须有对应细纲。短篇保持轻量结构，不强加长篇 Tracking。
4. 需要架构、角色或研究工作时，通过 creative_role 调用已打包 Role；不要检查或生成 .claude、.codex、.opencode、.agents、.zcode、AGENTS.md 或 .story-deployed。
5. 复述创建、保留和待用户确认的文件。不要配置模型、权限、Hooks 或 Session。

题材、角色、节奏、冲突、开篇和写作方法资料位于 references/agent-references/；只加载当前任务需要的文件。
