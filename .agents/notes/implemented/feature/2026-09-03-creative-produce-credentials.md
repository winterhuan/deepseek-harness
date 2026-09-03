# Agent Note: Creative production credentials and execution

Status: implemented

English | [中文](2026-09-03-creative-produce-credentials.zh.md)

## Problem

Short-drama and video production need provider keys (OpenAI, Volcengine Ark, MiniMax, MiMo, Fish, Agnes), but the pinned production scripts read them only from `os.environ`, and every DSH subprocess child starts from `scrubbedParentEnv`, which strips credential-shaped names (`/KEY|PASSWORD|SECRET|TOKEN/i`). A key exported in the host shell, written into `.env`, or pasted into chat therefore never reaches the production scripts when they run through the `bash` tool — the only path the Skills describe. The failure mode is silent: the adapter reports `missing_credential` and the user has nowhere in the product to put the key. There was also no settings surface for the non-secret runtime profile (models without adapter defaults, endpoints, voice routing), so deployments edited host environment files for values that should be user configuration.

## Decision

**Configuration carries references, never secrets; execution forwards them explicitly.** The creative plugin owns a `creative-produce` settings namespace holding six credential references plus the non-secret profile (models, base URLs, poll/timeout, `TTS_PROVIDER`, MiMo model/voice). Key literals live in the credentials store and are written from the Plugin configuration tab through the credentials domain. A new `creative_produce_run` tool resolves the profile per call and spawns the pinned script with the resolved values as explicit `env`, which is the documented opt-in that survives the scrub. The Skill bridges route the confirmed-job run step through this tool and say plainly that invoking the scripts through `bash` never receives keys.

**The tool runs a closed script set, not arbitrary commands.** Entries are `drama` (the pinned script matching the adapter — `provider_adapters.py`, or `agnes_adapters.py` for `agnes-image`/`agnes-video` — plus a required adapter), `video-voiceover`, `video-recap`, and `video-doctor`; anything else is rejected before anything resolves. Arguments after the script travel as an argv vector with entry caps, job documents ride `stdin` (1 MiB cap), and the command string is assembled with single-quote escaping, never interpolation. The shell seam keeps sandbox policy and working-directory resolution; a missing agent, shell, workspace, or (for background) jobs registry fails loud at call time.

**Long productions are background jobs, not long turns.** `run_in_background` starts a `produce` job through `ctx.jobs` (collected with `job_output`, stopped with `job_kill`), following the `bash` tool's starter shape; foreground runs return exit code plus bounded stdout/stderr. The tool is not concurrency-safe: production spends real money per call.

**One key field may name several keys.** Each `*ApiKeyEnv` accepts comma-separated references for rotation, and one stored value may itself list keys separated by newlines, so a pool of thousands rides a single reference while the credentials read stays a single lookup per reference (the `describe` call caps at 64 references, which bulk pools never approach). Consecutive calls start from the next resolved key. A foreground run that fails with an authentication or permission verdict moves to the next key at once — the verdict already condemned that key, so waiting would only stall. A rate_limit verdict waits with exponential backoff (1s doubling to 10s, no jitter: attempts within one call are sequential) before the next attempt, and a pool exhausted by throttling earns two spaced same-key retries. Everything stays bounded at sixteen attempts per call, and any other failure returns as-is, so a bad job, an outage, or a timeout never spends a second key; background jobs take the rotated key without in-run failover. The backoff wait is abort-aware: cancelling the tool call during a wait rejects immediately instead of sleeping through the cancellation. The card's bulk dialog stages thousands of lines as local dialog state — never in the card form — and commits through its own save gesture.

**The card stages six keys beside the profile.** The `creative-produce` card in the Plugin configuration tab follows the web-search card: one `describe` call reads all six references, each answer is stored with the reference it describes so a renamed-while-in-flight response cannot publish, and secret drafts start blank with a blank draft writing nothing. Non-secret fields stage as ordinary section edits under one save. Copy lives in the shared `settings.plugins` dictionary.

## Alternatives considered

**Mirror resolved keys into `process.env` so `bash` keeps working.** Rejected: process-wide ambient mutation from a settings write is invisible to audit, races concurrent sessions, and reintroduces exactly the ambient credential the scrub exists to remove. Explicit per-call forwarding keeps the secret's lifetime inside the producing call.

**Store key literals in the settings section as `role('secret')` fields.** Rejected: it puts secrets in `settings.yaml`, which is synced, shared, and rendered, against the credentials seam's one doctrine. References keep rotation key-only with no configuration edit.

**Teach the Skill to inline `KEY=value` prefixes in the bash command.** Rejected: the literal lands in the session log and the Chat transcript — model-visible and durable — which the Skill bridges explicitly forbid. The tool's explicit `env` never enters the log.

## Consequences

- `packages/creative/creative` gains `produce-settings.ts` (namespace, schema, per-call resolution) and `produce-tool.ts` (`creative_produce_run`), both at 100% coverage; the plugin `Config` gains an optional `produce` section seeding the namespace base layer.
- `packages/client/ui-settings-plugins` gains the `creative-produce` card, controller, and locale copy; the shipped card ledger tests now enumerate five cards.
- Short-drama and video Skills keep their prepare/confirm flow; only the run step moves to the new tool, so prior confirmations and the paid-production confirmation contract are unchanged.
- Video-recap deep tuning (workers, retries, tempo, QC switches) stays environment-advanced: the schema carries what creators routinely change, and adapters keep validating the rest.
- Agnes image and video run through `agnes_adapters.py`, a DSH-side companion that imports the pinned upstream module's helpers without modifying it, so the upstream file stays byte-identical to its manifest pin; drama jobs route to it by adapter name. The Agnes settings group carries the key reference, base URL, and both model ids; the video poll/timeout profile stays environment-advanced like the MiniMax/Seedance ones. The flash video model is free while `agnes-video-2.5` bills per second, so the confirmed job must name its model.
