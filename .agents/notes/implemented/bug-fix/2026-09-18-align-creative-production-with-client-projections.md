# Agent Note: Creative production reads current Client projections

Status: implemented

English | [中文](2026-09-18-align-creative-production-with-client-projections.zh.md)

## Problem

The Creative production board still adapted retired or compatibility Client representations even though current DSH assigns the same state to Session projections, submission handles, and assembled Chat nodes. `productionQueueFromInbox` folded both pending Inbox lists even though production preparations use `queue` delivery; `beginProductionSubmission` discarded the `SubmissionHandle.abandon()` escape hatch after creating a local prompt echo; every consumed production call id accumulated forever in `creative.workbench.v2`; and active tool calls were read from `ChatSnapshot.legacy.runningCalls`. Those paths exposed withdrawal for a steering message, retained a local submission echo when prompt dispatch threw before settlement, grew local storage with Session history, and coupled Creative to a compatibility projection.

The identity and ownership distinctions remain valid. A production card owns a `ProductionRequestId`, one prompt admission owns a separate `SessionRequestId`, one pending Inbox occurrence owns a `MessageId`, and one execution binding owns `{ jobId, startedAt }`. The Session log remains authoritative for production intents and bindings; the Job control baseline remains authoritative for live execution status; the Creative store remains authoritative only for drafts and user presentation choices. The [Creative workbench decision](../feature/2026-09-03-creative-workbench.md#production-and-credentials) owns those rules.

## Decision

Creative production reads and writes the current DSH client APIs without changing production authorization, job ownership, tool schemas, Session events, or persisted Session formats.

### Queue reconciliation folds only `next-turn`

`productionQueueFromInbox` derives `ProductionQueueEntry` values only from pending `next-turn` messages. Production preparations use `queue` delivery, so `next-step` steering messages never appear as queued preparations. Every row keeps its occurrence `MessageId`; `rpcId` is copied only from a browser-originated user source, with the same narrow typed cast the standard QueueDock performs over wire rows. `queuedItemForRequest` still joins a card to a pending occurrence only by exact `SessionRequestId`, never by prompt text, target labels, order, or timing. An absent projection contributes no row and infers neither a pending item nor admission failure.

The task board shows a preparation as queued while its correlated `next-turn` occurrence remains pending, exposes withdrawal only for that exact occurrence, and returns to the admitted state after the Host removes the occurrence.

### One Session-scoped operation owns the complete submission handle

The injected face keeps the whole `SubmissionHandle` returned by `beginSubmission()` in a per-request map. The production view reads the handle's `requestId` synchronously so it can persist the card before dispatch, but only the owner can retire the local echo. When Session lookup, serialization, transport, or another exception prevents normal prompt settlement, `sendProductionPrompt` calls `abandon()` before propagating the failure; a `RemoteResult` rejection is a settlement and continues through `Session.prompt()`'s identified-submission retirement. The failed card is still kept with its diagnostic, and no state machine was reimplemented in the Creative store.

### A monotonic sequence cursor replaces the consumed call-id ledger

Each projected production result carries its Session sequence through `productionDefinition`, `productionCallDefinition`, and the `creative-production` view. `creative.workbench.v2` replaces `productionIntentCalls: Record<callId, boolean>` with `productionIntentSeq`, the highest applied sequence. On first materialization the workbench applies successful navigation and sequence intents in Session order; later publications apply only results above the cursor, and `track_job` results still advance the cursor after contributing their durable request and binding data. A stored legacy ledger seeds the cursor from its matching projected results before being deleted, and falls to the highest currently projected sequence when its events are outside the loaded window; a store with no consumption evidence applies the current projection once. The persistence key survived the migration, so editor buffers, conflicts, production drafts, selections, references, canvas positions, and layout choices all survive.

### Active tool roots come from formal Chat nodes

`runningRootCalls` selects `snapshot.nodes.values()` once and derives visible running tool roots with the exported `isRunningTool` discriminator, sorted by Chat anchor sequence. Nested PTC traversal, streaming mutation previews, the settled-result fallback for calls that skip a live render, dirty-draft conflict behavior, and post-settlement workspace reload are unchanged. No legacy slice builder was copied into Creative.

## Retained implementation

`ProductionRequestId`, `SessionRequestId`, `MessageId`, and `{ jobId, startedAt }` remain distinct. Native metadata and PTC JSON decoding, `jobsBySession` plus the `sessions.jobsBaseline` readiness subscription, process-loss `unavailable` state, the CAS editor buffer, and the non-consuming targeted job-stop endpoint all stay. None of these duplicate the Client projections this note's changes replaced.

Creative keeps its workspace HTTP routes. The generic `workspaceFiles` Remote has no CAS write operation and does not replace Creative's domain-filtered recursive inventory, project summaries, configurable editor limit, large Range media responses, video preflight, or CSP-isolated game preview. The live tool-argument projection also remains useful for pre-settlement editor previews; file observation can replace only the later invalidation signal, not that preview.

## Consequences

- A production preparation correlated by `SessionRequestId` appears queued from the `inbox` projection and can remove only its own pending occurrence; steering messages never offer withdrawal.
- Every production submission either reaches `session.prompt()` settlement or calls `SubmissionHandle.abandon()`, so a thrown dispatch leaves no local echo behind.
- `creative.workbench.v2` stores one number instead of one boolean per production call, and existing persisted drafts, selections, references, canvas positions, and layout choices survive the in-place migration.
- Production navigation applies each newly projected sequence once, without replaying consumed history on tab remount.
- Creative reads active calls from formal Chat nodes and has no production dependency on `ChatSnapshot.legacy.runningCalls`; rows the Chat store marks hidden no longer contribute, so the workbench can show fewer active calls than the retired compatibility slice published.
- Production authorization, prompt mode, tool schemas, Session events, job binding identity, job status ownership, file CAS behavior, and preview security are unchanged.

## Testing

Focused Client tests cover Inbox projection mapping, exact `rpcId` correlation in `next-turn`, exclusion of `next-step`, projection absence, successful withdrawal confined to the exact occurrence, a thrown prompt call and a normal rejected `RemoteResult` (both retain the failed card, only the throw leaves a local echo for `abandon()` to retire), strict sequence ordering, one-time initial application, incremental application above the cursor, remount without repeated navigation, legacy call-id migration with every retained field intact, a replacement window, multiple job bindings on one request, and a formal Chat-node derivation covering a root mutation, a nested PTC mutation, a fast settled mutation, the exclusion of a hidden row, and a non-mutating call without reading `snapshot.legacy`. Because the change also alters product-visible GUI behavior, the implementation pull request attaches the required recorded GIF from the real Web profile and updates the recorded Web Session and ARIA expectations.

## Alternatives considered

- **Keep the empty queue until a new queue-specific Client store appears** — rejected: the durable Inbox projection already carries the Host-addressed pending occurrences and is the source used by the standard QueueDock. A second queue mirror would restore the duplicate state that DSH removed.
- **Submit production through the Conversation composer service** — rejected: the workbench needs to persist its own `ProductionRequestId` and prompt specification before dispatch, while the composer service owns editor drafts and attachments. Sharing the Session submission lifecycle is sufficient; sharing the whole composer would mix unrelated state owners.
- **Persist every applied call id** — rejected: Session sequence already supplies a monotonic cursor, while a call-id set grows with history and requires permanent per-result bookkeeping.
- **Reconstruct running calls from the timeline or copy the legacy builder** — rejected: formal Chat tool nodes already carry the assembled running or settled tree. Another derivation would create a third tool-lifecycle representation.

## Risks

Inbox projection values cross the Remote as JSON-safe data and require the same narrow typed cast current Conversation consumers use; treating arbitrary `source` data as a browser submission could expose a withdrawal control for an unrelated message. Exact `source.kind` and `rpcId` checks contain that risk.

Replacing a call-id ledger with a sequence cursor can replay or skip navigation if migration guesses from an incomplete history window. The migration therefore distinguishes fresh empty state from prior non-empty consumption evidence and uses the highest visible sequence only for unmatched legacy evidence; tests cover cropped and prepended windows.

Moving off the compatibility running-call slice changes update identity and effect frequency, and its visible-root filter is a deliberate behavior change rather than a faithful translation: the retired slice published every running root it collected, including hidden rows. A hidden running call now stops contributing workbench mutations while the Chat transcript still renders the call, so a collapsed or filtered row can leave an active mutation undisplayed here. Selecting the Chat node collection as one stable snapshot value keeps settlement to exactly one authoritative reload without removing streaming previews, and the focused Chat-node test pins the exclusion so it cannot drift back silently.

Creative continues to own some read and invalidation code until the standard Workspace Files APIs can replace a complete responsibility without losing CAS, bounds, remote-filesystem behavior, or preview security.
