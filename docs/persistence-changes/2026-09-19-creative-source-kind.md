---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-19-creative-source-kind

English | [中文](2026-09-19-creative-source-kind.zh.md)

## Summary

Adds the creative production plugin's `creative` message-source kind to the user-message source vocabulary.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records remain valid: consumers fall through unknown source kinds to the documented default presentation, so records written before this change replay unchanged, and the added kind only appears in new records written by the creative post-write tracking reminder. The source slot's supported policy is unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/creative/creative/tests/native-hooks.spec.ts: 13 tests passed, covering the post-write reminder's source declaration and waterfall integration.

<a id="dev-note"></a>
## Dev Note

None.
