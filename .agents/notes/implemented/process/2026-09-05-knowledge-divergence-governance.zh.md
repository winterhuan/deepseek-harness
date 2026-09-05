# Agent Note: Knowledge 分歧治理

Status: implemented

[English](2026-09-05-knowledge-divergence-governance.md) | 中文

## Problem

Creative 的 `knowledge/` 树是 pin 住的上游快照，但产品工作要改它们（`production_tool.py` confirm 修复）还要在旁边加文件（`agnes_adapters.py`、`export_novel_txt.py`、`record_lineage.py`）。禁止修改的 pin 挡路；删 manifest 则 provenance 清零。从没有门校验过这些 hash——它们一直只是账本，所以替代方案也必须保持账本量级，不能为四个账本文件长出检查脚本、单测和 CI 接线。

## Decision

**`files[]` 保持上游记录不动，`divergence` 只记不同的部分**：`forked` 路径（改过的，带 `reason` 和归属 note）、`added` 路径（DSH 自写的，带 `reason`）。不复制 hash——内容版本 git 本来就管着，上游 pin 就在 `files[]` 里。

**改 skill 的动作**：改文件，把路径翻进对应的 `divergence` 格子并写理由。执行靠 review：manifest diff 和 skill 改动在同一个 PR 里，一眼可见。不设门、不写 spec、不同步流程。

## Alternatives considered

**检查脚本加 doc-sync 门。** 否决：小题大做。它防的是“忘了改五行 manifest”，而这在 review 里本来就看得见；代价是一个脚本、一个 spec、一截 CI，没人想维护。

**第一次修改就整树 fork。** 否决：等于宣布几百个没动过的文件全归我们，以后同步上游变成全量重审，而不是逐条过问。

## Consequences

- 四个 manifest 带 `governance` 加基本空的 `divergence` 表；当前条目：1 个 forked 文件，3 个 added 文件。
- 以后同步上游时拿 `files[]` 对新上游，逐条重问每个 `divergence` 条目：保留、移植还是退休。
