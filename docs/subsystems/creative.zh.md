# Creative

[English](creative.md) | 中文

[`@deepseek-ai/dsh-creative`](../../packages/creative/creative/README.zh.md) 所拥有的小说、短剧、小说改游戏、视频解说生产工作台。一个 in-process 插件捆绑四棵 pinned 上游技能树、专家角色、生产工具、会话级工作台路由和浏览器工作台；DSH 保留模型、会话、工具、权限与根目录。包组合、工具清单与配置见[包 README](../../packages/creative/creative/README.zh.md)。

Source: [`packages/creative/creative/src/index.ts`](../../packages/creative/creative/src/index.ts)

## 四条接缝

**技能与角色供给。** 四个 `SkillProvider` 服务 pinned 的 `knowledge/` 树，并向每条技能正文注入 DSH bridge，上游工作流因此不会另起第二个 dashboard、Agent runtime 或传输。`creative_role` 把七个上游角色作为 `subagents.spawn` 子 Agent 运行并按角色过滤工具；`creative_bundled_reference` 是打包引用文件的唯一读取通道。

**付费生产。** `creative_produce_run` 是模型通往 pinned Python 生产脚本及其 provider 密钥的唯一路径。密钥以引用形式存在凭据库；设置命名空间持有引用与非机密 profile 字段；工具每次调用现解析并以显式环境变量转发，因为其余子进程都从擦除后的环境启动。契约结论驱动有界的密钥轮换与退避。

**投影意图。** `creative_production` 是并发安全、无副作用的工具，其工具调用落入会话日志；浏览器工作台重放它来驱动短剧生产视图。它从不修改创作者文档，也不为付费生成授权。

**工作台路由。** `/creative` 是会话级 HTTP 面，具备 loopback 或 `trustedHosts` 信任、目录白名单、版本 CAS 文件写入、Range 媒体流与 CSP 隔离的游戏预览。浏览器工作台消费它与会话 store，投产只经正常审批流以聊天提示词发送。

## 工作台展示

浏览器工作台是[右侧 Sidebar](sidebar-right.zh.md) 中的 `creative` 页面，可从引导页或受支持的 Chat 文件链接打开。以键注册的 `sidebar.right.pane.tab` 内容使用既有 Session store 保存草稿和生产准备状态；Sidebar 拥有布局与标签页生命周期。[包 README](../../packages/creative/creative/README.zh.md#use-this-package) 说明入口和预览生命周期。

## 语言接缝

工作台 UI 文案经 `creative` 命名空间归 locale 所有（zh 为源、en 键位对齐），生产视图按码渲染的协议诊断也在其中。工作区协议标识（`正文/`、`剧集/EP001`、`SHOT-*`）、面向 Agent 的提示词构建器，以及操作性失败文本（服务端错误体、运行时诊断）保持 zh-Hans：它们属于技能与宿主守卫共享的创作协议，不是浏览器界面装饰。
