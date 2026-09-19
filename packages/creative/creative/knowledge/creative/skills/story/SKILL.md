---
name: story
description: "小说创作入口：按用户意图路由到选题、拆文、写作、导入、审稿、封面或跨域改编，并管理工作区作者习惯。用于“我想写小说”“继续写作”“记住我的写作习惯”“查看写作偏好”；明确的专项任务直接使用对应 skill。"
---

# story — DSH 小说流程入口

在当前 DSH Session 内判断用户意图，并加载最匹配的 Creative Skill：

- 新建或修复小说工程：story-setup
- 长篇选题/扫榜/拆文/日更：story-long-scan、story-long-analyze、story-long-write
- 短篇选题/拆文/写作：story-short-scan、story-short-analyze、story-short-write
- 导入已有作品：story-import
- 审稿与去 AI 味：story-review、story-deslop
- 封面：story-cover
- 跨域改编：改短剧先经 story-import 导出原著包再进 short-drama-novel-analyze；改游戏进 novel-game-analyze；做解说把成片放进 video-recap 的 sources/
- 管理作者习惯（记住/查看/确认/替换/忘掉写作偏好）：加载本 skill 的  references/author-memory.md，只用本 skill 的 scripts/author_memory_commit.py 管理  工作区级 .story/作者记忆/；工具未返回 Author Memory Receipt 前不得声称已记住。

意图明确时直接进入对应 Skill；不明确时只问一个会改变流程的问题。项目文件、Agent、模型、权限、Session Log 和 UI 均由当前 DSH 会话管理。小说文件通过"小说"视图查看，Agent 过程通过右侧动态栏或官方 Chat 查看。禁止启动独立 Dashboard。
