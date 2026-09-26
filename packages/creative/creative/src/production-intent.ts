import { parseCreativePath } from './project-path.ts'
import type { ProductionRequestId } from './production-binding.ts'

/** The UI/tool name the short-drama production workbench replays from the session log. */
export const CREATIVE_PRODUCTION_TOOL_NAME = 'creative_production'

/** The closed set of production-projection operations the workbench understands. */
export const PRODUCTION_INTENT_ACTIONS = [
  'open_section',
  'focus_target',
  'set_sequence',
  'track_job',
] as const

/** Production workbench sections an `open_section` or `focus_target` intent may address. */
export const PRODUCTION_INTENT_SECTIONS = ['shots', 'assets', 'tasks', 'sequence', 'canvas'] as const
/** Media job kinds a `track_job` intent may register. */
export const PRODUCTION_INTENT_JOB_KINDS = ['image', 'video', 'composition'] as const

/** One {@link PRODUCTION_INTENT_ACTIONS} operation. */
export type ProductionIntentAction = typeof PRODUCTION_INTENT_ACTIONS[number]
/** One {@link PRODUCTION_INTENT_SECTIONS} workbench section. */
export type ProductionIntentSection = typeof PRODUCTION_INTENT_SECTIONS[number]
/** One {@link PRODUCTION_INTENT_JOB_KINDS} media job kind. */
export type ProductionIntentJobKind = typeof PRODUCTION_INTENT_JOB_KINDS[number]

/**
 * Validated `creative_production` call payload. Every field beyond `action` and
 * `episode` is action-specific; `validateProductionIntent` returns only the
 * fields the action consumes.
 */
export interface ProductionIntentArgs {
  readonly action: ProductionIntentAction
  readonly episode: string
  readonly section?: ProductionIntentSection | undefined
  readonly targetId?: string | undefined
  readonly shotIds?: readonly string[] | undefined
  readonly jobId?: string | undefined
  readonly requestId?: ProductionRequestId | undefined
  readonly jobKind?: ProductionIntentJobKind | undefined
  readonly expectedOutputs?: number | undefined
  readonly prompt?: string | undefined
}

function requiredText(value: string | undefined, field: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`creative_production ${field} is required for this action.`)
  if (normalized.length > 512) throw new Error(`creative_production ${field} is too long.`)
  return normalized
}

/**
 * Validate the cross-runtime UI intent without reading or mutating workspace state.
 * @param args - raw tool arguments as received from the model.
 * @returns the normalized intent carrying exactly the fields its action consumes.
 * @throws Error with a model-facing message when the action, episode form, or
 * action-specific fields violate the projection protocol.
 */
export function validateProductionIntent(args: ProductionIntentArgs): ProductionIntentArgs {
  const parsed = parseCreativePath(args.episode.trim())
  if (parsed?.role !== 'episode' || parsed.path !== parsed.episodePath) {
    throw new Error('creative_production episode must name a full project episode path, for example 书名/剧集/EP001.')
  }
  const episode = parsed.path
  if (args.action === 'open_section') {
    if (args.section === undefined) throw new Error('creative_production section is required for open_section.')
    return { action: args.action, episode, section: args.section }
  }
  if (args.action === 'focus_target') {
    return { action: args.action, episode, targetId: requiredText(args.targetId, 'targetId'), section: args.section }
  }
  if (args.action === 'set_sequence') {
    const shotIds = args.shotIds?.map(value => value.trim()).filter(value => value !== '') ?? []
    if (shotIds.length === 0) throw new Error('creative_production shotIds must contain at least one shot for set_sequence.')
    if (shotIds.length > 500 || new Set(shotIds).size !== shotIds.length || shotIds.some(value => !/^SHOT-[A-Z0-9-]+$/u.test(value))) {
      throw new Error('creative_production shotIds must be unique canonical SHOT-* identifiers.')
    }
    return { action: args.action, episode, shotIds }
  }
  const expectedOutputs = args.expectedOutputs
  if (expectedOutputs !== undefined && (!Number.isInteger(expectedOutputs) || expectedOutputs < 1 || expectedOutputs > 500)) {
    throw new Error('creative_production expectedOutputs must be an integer between 1 and 500.')
  }
  if (args.jobKind === undefined) throw new Error('creative_production jobKind is required for track_job.')
  const prompt = args.prompt?.trim()
  return {
    action: args.action,
    episode,
    jobId: requiredText(args.jobId, 'jobId'),
    ...(args.requestId === undefined ? {} : { requestId: requiredText(args.requestId, 'requestId') as ProductionRequestId }),
    targetId: requiredText(args.targetId, 'targetId'),
    jobKind: args.jobKind,
    expectedOutputs,
    prompt: prompt === '' ? undefined : prompt,
  }
}
