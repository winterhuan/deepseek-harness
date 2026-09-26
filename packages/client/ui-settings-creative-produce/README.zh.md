---
description: "dsh Web 客户端插件页的创意生产设置页：六个提供方密钥与其授权的运行时配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-creative-produce

[English](README.md) | 中文

## 概述

在侧边栏打开**插件**，并在官方分组选择**创意生产**，即可设置六个提供方密钥及其授权的运行时配置（模型、接口地址、语音路由）。页面暂存所输入的内容，只在保存时写入；密钥经凭据域写入而非设置文档，因此密钥字面量不会出现在响应中。页面在 Host 提供 `creative-produce` 命名空间期间存在。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

控件按提供方分组——OpenAI（图片）、Seedance 视频（火山引擎 Ark）、MiniMax（视频与音乐）、MiMo（视频理解与语音）、Fish Audio（语音兜底）与 Agnes（图片与视频）——同一提供方的密钥、接口地址与模型放在一起；语音路由收尾。每个**API Key** 控件每次加载都是空的，只报告是否已配置密钥；留空保存等于保留现有密钥。**批量管理密钥**打开一个对话框，把整个密钥池作为一次写入存储，每行一个密钥。配置字段显示生效值，一旦被覆盖就带**已覆盖**标签和**恢复默认**，清空后保存等于重置。点击**保存**之前不会写入任何内容；离开页面即丢弃草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧通过 `ctx.configForms.get` 绑定 `creative-produce` 命名空间，用 `ui-primitives` 的共享 `SettingsFormModel` 在 `CreativeProduceCardController` 里维护暂存表单，六个提供方密钥是表单里的密文控件：每次写入走 `remote.credentials.set`，引用名取自本节对应字段（未指定时为该提供方的默认环境变量键），是否成功由一次批量 `remote.credentials.describe` 回读判定。scope 变化时、以及 Host 对所监视引用发出 `credentials/reference-updated` 时，控制器都会重读凭据，因为在其他界面写入的密钥不会改变任何设置节。页面通过 `ctx.configForms.whileServed` 把 `CreativeProduceCard` 注册进插件页的 `plugins.item` slot。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md) — 插件页与页面注册进成的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md) — 页面搭乘的设置 scope 与被提供命名空间监视。
- [ui-primitives](../ui-primitives/README.zh.md) — 页面渲染的设置表单模型与字段。
- [credentials](../../credentials/README.zh.md) — 密钥写入所经的凭据引用 seam。
- [creative](../../creative/creative/README.zh.md) — 注册该命名空间的生产适配器。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧设置界面，不注册模型界面。

#### KV Cache 效应

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **命名空间覆盖范围** — 页面编辑六个提供方密钥与生产适配器声明的运行时配置字段；该节之外的提供方特定能力不在此呈现。
- **运行时不变量：** 不发布 companion。本包不拥有自有关系：它显示的内容来自设置镜像与凭据域，写入的内容由 Host 校验。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
