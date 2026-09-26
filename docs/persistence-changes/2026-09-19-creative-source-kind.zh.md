---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-19-creative-source-kind

[English](2026-09-19-creative-source-kind.md) | 中文

## 概述

为用户消息的 source 词表新增创意生产插件的 `creative` 消息来源类别。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-19-creative-source-kind
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "5486db433588b5bd12b03c2c9a458caa6a03fb584a70f93db3a519cc1611a980"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "4959936bea5f1b8204a6f17ffd9e403a70ac5551d81f5f8f2e08db782c7ce4af"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "7f1ae3bb9284bc2bde826572738ff6db2d2b9cb976b75c8d908263df6632bf44"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "bcd8863162c2f1f130f45bf97b9d10c825d9035f5d1995d9aea6b8ee47835166"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效：消费者对未知的 source 类别按文档默认形态回退展示，因此本次变更之前写入的记录回放不变；新增类别只出现在创意生产 post-write 追踪提醒之后写入的新记录中。source slot 的支持策略不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/creative/creative/tests/native-hooks.spec.ts：13 个测试通过，覆盖 post-write 提醒的 source 声明与 waterfall 集成。

<a id="dev-note"></a>
## 开发备注

无。
