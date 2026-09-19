/** Production drafts and pure projections of framework-owned jobs. */
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionJob, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ProductionBinding, ProductionContext, ProductionRequestId } from '../production-binding.ts'

/** The media kind requested by a production card. */
export type ProductionJobKind = ProductionContext['kind']

/** One produced media version of a target, from workspace output or remote URL. */
export interface ProductionMediaVersion {
  readonly id: string
  readonly targetId: string
  readonly kind: 'image' | 'video'
  readonly url: string
  /** Workspace-relative path when the result is owned by the DSH FileSystem. */
  readonly path?: string | undefined
}

/** Session-persisted preparation data; execution state is never stored here. */
export interface ProductionRequest {
  readonly id: ProductionRequestId
  readonly episode: string
  readonly targetId: string
  readonly kind: ProductionJobKind
  readonly prompt: string
  readonly expectedOutputs: number
  readonly submissionId?: SessionRequestId | undefined
  readonly submissionError?: string | undefined
  readonly withdrawn?: boolean | undefined
  readonly legacy?: boolean | undefined
}

/** One binding joined against the current complete registry baseline. */
export interface ProductionJobView {
  readonly binding: ProductionBinding
  readonly status: SessionJob['status'] | 'loading' | 'unavailable'
  readonly detail?: string | undefined
}

/** One composition step: a shot and the video version chosen for it. */
export interface ProductionSequenceItem {
  readonly shotId: string
  readonly versionId?: string | undefined
}

/** A canvas node position in the production canvas coordinate space. */
export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

/** One pending DSH queue occurrence the task board reconciles against. */
export interface ProductionQueueEntry {
  /** Queue occurrence identity, as the Host addressed it. */
  readonly id: MessageId
  /** Prompt-RPC identity of the submission this occurrence echoes. */
  readonly rpcId?: SessionRequestId
}

/**
 * Resolve a new production draft independently of prompt and job lifecycles.
 * @param input - card identity, full episode path, target, prompt, and planned output count.
 * @returns preparation data with an explicit output-count default.
 */
export function createProductionRequest(input: {
  readonly id: ProductionRequestId
  readonly episode: string
  readonly targetId: string
  readonly kind: ProductionJobKind
  readonly prompt: string
  readonly expectedOutputs?: number | undefined
}): ProductionRequest {
  return {
    id: input.id,
    episode: input.episode,
    targetId: input.targetId,
    kind: input.kind,
    prompt: input.prompt,
    expectedOutputs: input.expectedOutputs ?? 1,
  }
}

/**
 * The media version a view shows for one target: the creator's selection when
 * present, else the newest version.
 * @param targetId - the production target to resolve.
 * @param versions - all known media versions.
 * @param selections - per-target selected version ids.
 * @param kind - optional kind filter, e.g. video versions only.
 * @returns the selected or newest version, or `undefined` when none exists.
 */
export function selectedVersionForTarget(
  targetId: string,
  versions: readonly ProductionMediaVersion[],
  selections: Readonly<Record<string, string>>,
  kind?: ProductionMediaVersion['kind'],
): ProductionMediaVersion | undefined {
  const candidates = versions.filter(version => version.targetId === targetId && (kind === undefined || version.kind === kind))
  return candidates.find(version => version.id === selections[targetId]) ?? candidates.at(-1)
}

/**
 * The production target one workspace output path belongs to, matched on path
 * segments or filename prefix against the known ids.
 * @param path - workspace-relative output path.
 * @param knownTargets - the canonical target ids of the episode.
 * @returns the longest matching target id, or `undefined` when none matches.
 */
export function mediaTargetFromPath(path: string, knownTargets: readonly string[]): string | undefined {
  const upper = path.toLocaleUpperCase()
  const segments = upper.split('/')
  const filename = segments.at(-1) ?? ''
  return [...knownTargets].sort((left, right) => right.length - left.length).find((target) => {
    const canonical = target.toLocaleUpperCase()
    return segments.includes(canonical)
      || filename === canonical
      || filename.startsWith(`${canonical}.`)
      || filename.startsWith(`${canonical}-`)
  })
}

/**
 * The reference images a shot's job was dispatched with: declared references
 * resolved to their selected versions, plus manual library picks, deduplicated.
 * @param targetId - the shot whose references to collect.
 * @param production - the parsed episode projection carrying shot references.
 * @param versions - the episode's media versions.
 * @param selections - per-target selected version ids.
 * @param libraryVersions - the pool manual picks may draw from.
 * @param manualReferences - per-shot manual library selections.
 * @returns the deduplicated reference versions in declaration-then-manual order.
 */
export function referencesForTarget(
  targetId: string,
  production: { readonly shots: readonly { readonly id: string; readonly references: readonly string[] }[] },
  versions: readonly ProductionMediaVersion[],
  selections: Readonly<Record<string, string>>,
  libraryVersions: readonly ProductionMediaVersion[] = versions,
  manualReferences: Readonly<Record<string, readonly string[]>> = {},
): ProductionMediaVersion[] {
  const shot = production.shots.find(item => item.id === targetId)
  if (shot === undefined) return []
  const declared = shot.references.flatMap((id) => {
    const version = selectedVersionForTarget(id, versions, selections, 'image')
    return version === undefined ? [] : [version]
  })
  const manual = (manualReferences[targetId] ?? []).flatMap((id) => {
    const version = libraryVersions.find(item => item.id === id && item.kind === 'image')
    return version === undefined ? [] : [version]
  })
  return [...new Map([...declared, ...manual].map(version => [version.id, version])).values()]
}

/**
 * Prompt-RPC identity carried by one pending message's browser-submitted user
 * source. Inbox rows are wire data behind a typed face, so an absent or
 * non-user source contributes no correlation id rather than failing.
 * @param message - one pending Inbox message.
 * @returns the `rpcId` member, or an empty object when the row carries none.
 */
function promptRpcId(message: InboxState['next-turn'][number]): Pick<ProductionQueueEntry, 'rpcId'> {
  const source = message.source
  return source.kind === 'user' && 'rpcId' in source ? { rpcId: source.rpcId } : {}
}

/**
 * Fold the Session's `inbox` projection value into the queue rows the task
 * board reconciles against. Production preparations use `queue` delivery, so
 * only pending `next-turn` occurrences are queued preparations; `next-step`
 * steering messages never join. An absent projection means the value has not
 * arrived yet and contributes no row — it must not manufacture a pending item
 * or infer admission failure.
 * @param inbox - the Session's `inbox` projection value, or undefined before one lands.
 * @returns one row per pending `next-turn` occurrence, in Host order.
 */
export function productionQueueFromInbox(inbox: InboxState | undefined): readonly ProductionQueueEntry[] {
  if (inbox === undefined) return []
  return inbox['next-turn'].map(message => ({
    id: message.id,
    ...promptRpcId(message),
  }))
}

/**
 * Find a queued preparation by its exact prompt RPC identity.
 * @param request - the persisted production preparation.
 * @param queue - pending `next-turn` Inbox rows folded by {@link productionQueueFromInbox}.
 * @returns the matching message occurrence, or undefined after admission or removal.
 */
export function queuedItemForRequest(request: ProductionRequest, queue: readonly ProductionQueueEntry[]): ProductionQueueEntry | undefined {
  return request.submissionId === undefined ? undefined : queue.find(item => item.rpcId === request.submissionId)
}

/**
 * Join a durable binding to process-local status without consuming job output.
 * @param binding - logged identity and registration timestamp.
 * @param jobs - authoritative jobsBySession rows for this Session.
 * @param ready - whether the current connection supplied a complete control baseline.
 * @returns the live state, loading before the baseline, or unavailable after process loss.
 */
export function productionJobView(binding: ProductionBinding, jobs: readonly SessionJob[], ready: boolean): ProductionJobView {
  if (!ready) return { binding, status: 'loading' }
  const job = jobs.find(item => item.id === binding.job.jobId && item.startedAt === binding.job.startedAt)
  return job === undefined ? { binding, status: 'unavailable' } : { binding, status: job.status, detail: job.detail }
}

/**
 * Align the composition sequence with the current shot set, preserving creator
 * order for surviving shots and refreshing each step's chosen video version.
 * @param shotIds - the episode's current shot ids.
 * @param current - the previous sequence.
 * @param versions - all media versions observed in the workspace payload.
 * @param selections - per-target selected version ids.
 * @returns the reconciled sequence in preserved-then-appended order.
 */
export function reconcileSequence(
  shotIds: readonly string[],
  current: readonly ProductionSequenceItem[],
  versions: readonly ProductionMediaVersion[],
  selections: Readonly<Record<string, string>>,
): ProductionSequenceItem[] {
  const shotSet = new Set(shotIds)
  const preserved = current.filter(item => shotSet.has(item.shotId))
  const present = new Set(preserved.map(item => item.shotId))
  const appended = shotIds.filter(shotId => !present.has(shotId)).map(shotId => ({ shotId }))
  return [...preserved, ...appended].map(item => ({
    shotId: item.shotId,
    versionId: selectedVersionForTarget(item.shotId, versions, selections, 'video')?.id,
  }))
}

/**
 * The blockers that keep a composition from dispatching.
 * @param sequence - the composition sequence to inspect.
 * @param versions - all media versions observed in the workspace payload.
 * @returns one zh-Hans message per step missing a selectable workspace video.
 */
export function sequenceIssues(sequence: readonly ProductionSequenceItem[], versions: readonly ProductionMediaVersion[]): string[] {
  const versionById = new Map(versions.map(version => [version.id, version]))
  const issues: string[] = []
  for (const item of sequence) {
    const version = item.versionId === undefined ? undefined : versionById.get(item.versionId)
    if (version === undefined || version.kind !== 'video') issues.push(`${item.shotId} 缺少已选视频版本`)
    else if (version.path === undefined) issues.push(`${item.shotId} 的视频没有可供 DSH 读取的工作区路径`)
  }
  return issues
}

/**
 * Move one sequence step to another position.
 * @param sequence - the current sequence.
 * @param source - the index to move from.
 * @param target - the index to move to.
 * @returns the reordered sequence; unchanged when the indices are out of range.
 */
export function reorderSequence(sequence: readonly ProductionSequenceItem[], source: number, target: number): ProductionSequenceItem[] {
  if (!Number.isInteger(source) || !Number.isInteger(target)) return [...sequence]
  if (source < 0 || target < 0 || source >= sequence.length || target >= sequence.length || source === target) return [...sequence]
  const next = [...sequence]
  const [item] = next.splice(source, 1)
  if (item !== undefined) next.splice(target, 0, item)
  return next
}
