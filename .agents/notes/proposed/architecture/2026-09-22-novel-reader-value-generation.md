# Agent Note: Novel generation must optimize reader value

Status: proposed

English | [中文](2026-09-22-novel-reader-value-generation.zh.md)

## Problem

Creative's novel-writing workflow validates file structure, tracking state, outline consumption, AI-pattern lint, punctuation and continuity, but it does not make reader value a blocking contract. A chapter can pass `storyctl.py chapter check` while the text has no concrete opening promise, meaningful conflict, protagonist choice, state change or next-page question. The current workflow also forbids adding independent plot when an outline is weak, so a thin outline is expanded into a longer summary instead of being returned for repair.

The writing Skills and `narrative-writer` role load a large set of references and many prescriptive techniques. Fixed event-density targets, percentage-shaped sections, repeated hook formulas, object recurrence rules and anti-AI cleanup instructions compete with the chapter's actual genre and reader promise. The workflow therefore risks replacing one failure mode with another: text can avoid obvious AI phrasing while remaining formulaic or emotionally flat. `narrative-writer` also combines prose generation, de-AI rewriting, format checks and part of the review work, while `consistency-checker` focuses on factual and foreshadowing continuity rather than reader retention.

## Proposal

### Add a reader-value gate before chapter commit

Introduce a structured chapter review result before `chapter commit` or `chapter accept-current-length`. The result records the opening hook, chapter promise, main conflict, protagonist agency, state change, payoff, unresolved reader question and quoted evidence locations. A chapter is blocked when the reviewer cannot identify a concrete promise, a visible state change, an indispensable protagonist choice, or a specific reason to continue. The gate reports evidence rather than a single subjective score.

### Validate outlines before prose generation

Add an outline-readiness check before Phase 4. A chapter outline must identify the reader expectation, protagonist objective, obstruction, choice, cost or consequence, local payoff, and chapter-end question while respecting information that must remain unreleased. If any required item is absent or only abstractly described, the workflow returns to outline repair instead of asking the writer to invent independent plot during prose expansion.

### Separate planning, prose, and review responsibilities

Use a two-stage writing path: first derive a compact scene-execution plan from the approved outline, then write prose from that plan. Keep the outline as the boundary for independent plot while allowing scene-level invention such as tactics, subtext, evidence handling and micro-obstacles that serve approved events. Assign reader-value review to a dedicated review pass, keep `narrative-writer` focused on prose and local rewriting, and keep `consistency-checker` focused on facts, character state and foreshadowing.

### Reduce hard constraints in the writing prompt

Classify writing guidance as universal contracts, genre strategies or optional techniques. Keep only universal contracts as blocking rules: continuity, readable scene change, protagonist agency, information ownership, format and explicit user constraints. Treat fixed event-density numbers, percentage-shaped chapter sections, mandatory three-use objects, minimum reversal counts and named hook formulas as optional techniques selected by the chapter plan. Build a compact per-genre card and pass only the selected emotion module, rhythm reference and relevant examples to the writer.

### Preserve reader-value evidence for continuation

Store a compact per-chapter reader-value summary with the existing tracking transaction: fulfilled promise, protagonist action, state change, open expectation and the largest remaining risk. The next chapter's context loader consumes this summary so continuation preserves reader momentum instead of only preserving factual state.

## Alternatives considered

**Add more banned words, hook templates or style references.** Rejected: the current workflow already has extensive prose references and deterministic AI-pattern checks. More lexical or formulaic rules can remove surface symptoms while increasing template behavior.

**Let the writer freely add plot whenever the outline is weak.** Rejected: this can corrupt long-form continuity and create unapproved obligations. Outline weakness must be repaired before prose, while scene-level invention remains allowed inside approved story boundaries.

**Use one general quality score for every genre.** Rejected: reader value differs across suspense,爽文, romance, healing and slow-burn fiction. The gate needs shared evidence fields but genre-owned expectations and thresholds.

**Make `story-review` the only quality gate.** Rejected: review alone is too late if the outline has no workable chapter promise, while deterministic checks still own format, tracking and anti-degeneration contracts. The reader-value gate complements rather than replaces those owners.

## Acceptance criteria

- A chapter cannot be committed when a structured reader-value review lacks a concrete promise, visible state change, indispensable protagonist action, or specific next-page question.
- An outline missing objective, obstruction, choice, consequence, payoff or end question is returned for repair before prose generation.
- Scene-level invention remains possible inside approved outline boundaries, while new independent events, obligations and reveals remain rejected.
- The writing prompt passes a compact selected genre/emotion/rhythm package rather than the full reference corpus and does not require optional formulas as universal completion criteria.
- Reader-value review, continuity review, deterministic quality checks and tracking commit each retain separate ownership and evidence.
- Keyless chapter-generation fixtures cover a flat chapter, a strong chapter, an outline gap, a continuity failure and a successful revision loop; relevant model-visible snapshots are updated.

## Risks

Reader-value evidence remains a judgment made by a model and cannot guarantee commercial performance. A stricter outline gate can slow first-draft throughput when the creator intentionally wants exploratory prose; the workflow must provide an explicit exploratory mode rather than silently bypassing the contract. Compact prompts may omit useful craft references, so the writer must retain targeted on-demand reference loading. Storing reader-value summaries adds tracking fields and requires a persistence-type review; summaries must remain derived review evidence, not a second story canon.
