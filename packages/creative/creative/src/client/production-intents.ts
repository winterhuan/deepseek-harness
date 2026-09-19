import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  CREATIVE_PRODUCTION_TOOL_NAME,
  validateProductionIntent,
  type ProductionIntentArgs,
} from '../production-intent.js'
import { CREATIVE_PRODUCE_RUN_TOOL_NAME, ProductionRequestId, parseProductionBinding, type ProductionBinding } from '../production-binding.ts'
import { createProductionRequest, type ProductionRequest } from './production-runtime.ts'

/** One durable, successful `creative_production` call replayed from the chat snapshot. */
export interface SettledProductionIntent {
  /** Session log sequence of the result; consumers apply each sequence once. */
  readonly seq: number
  readonly callId: string
  readonly intent: ProductionIntentArgs
  readonly binding?: ProductionBinding | undefined
}

function resultBinding(block: ToolCallBlock): ProductionBinding | undefined {
  if (!('kind' in block)) return undefined
  const fromValue = (value: unknown): ProductionBinding | undefined => typeof value === 'object' && value !== null && 'production' in value
    ? parseProductionBinding(value.production) : undefined
  const meta = fromValue(block.meta)
  if (meta !== undefined) return meta
  for (const part of block.content) {
    if (part.type !== 'text') continue
    try {
      const binding = fromValue(JSON.parse(part.text))
      if (binding !== undefined) return binding
    } catch { continue }
  }
  return undefined
}

/**
 * Decode one settled producer result from its durable metadata or PTC content.
 * @param block - A native or nested result, with call arguments when loaded.
 * @returns A validated intent carrying its Session sequence, or undefined for
 * unrelated or unsuccessful results.
 */
export function settledProductionIntent(block: ToolCallBlock): SettledProductionIntent | undefined {
  if (!('kind' in block) || block.isError) return undefined
  if (block.call !== null && block.call.name !== CREATIVE_PRODUCTION_TOOL_NAME
    && block.call.name !== CREATIVE_PRODUCE_RUN_TOOL_NAME) return undefined
  const binding = resultBinding(block)
  if (binding !== undefined) return {
    seq: block.seq, callId: block.callId, binding,
    intent: {
      action: 'track_job', episode: binding.episode, requestId: binding.requestId,
      targetId: binding.targetId, jobId: binding.job.jobId, jobKind: binding.kind,
      expectedOutputs: binding.expectedOutputs, prompt: binding.prompt,
    },
  }
  if (block.call?.name !== CREATIVE_PRODUCTION_TOOL_NAME) return undefined
  try {
    const args = JSON.parse(block.call.argsRaw) as ProductionIntentArgs
    return { seq: block.seq, callId: block.callId, intent: validateProductionIntent(args) }
  } catch {
    return undefined
  }
}

/**
 * The highest Session sequence the workbench has already applied, seeding that
 * cursor once from a retired consumed call-id ledger.
 *
 * A value written before the cursor existed rehydrates without it, so an
 * absent cursor is "nothing applied yet" and a fresh store applies the current
 * projection once. A non-empty legacy ledger seeds the cursor from the results
 * it can still match; when its events fall outside the loaded window, the
 * cursor falls to the highest visible sequence rather than replaying navigation
 * the store consumed in an earlier window.
 * @param intents - projected successful production results in Session order.
 * @param current - the persisted cursor, or undefined in a pre-cursor value.
 * @param consumedCalls - the retired consumed call-id ledger, when one persisted.
 * @returns the highest already-applied Session sequence.
 */
export function consumedIntentSeq(
  intents: readonly SettledProductionIntent[],
  current: number | undefined,
  consumedCalls: Record<string, boolean> | undefined,
): number {
  const base = current ?? 0
  if (consumedCalls === undefined || Object.keys(consumedCalls).length === 0) return base
  let highestMatched = 0
  let highestVisible = 0
  for (const { seq, callId } of intents) {
    highestVisible = Math.max(highestVisible, seq)
    if (consumedCalls[callId] === true) highestMatched = Math.max(highestMatched, seq)
  }
  return Math.max(base, highestMatched > 0 ? highestMatched : highestVisible)
}

/**
 * Recover request cards from successful tool results without persisting live status.
 * @param drafts - locally persisted preparation data.
 * @param intents - validated successful tool results in log order.
 * @param episode - full project/episode path being displayed.
 * @returns drafts plus recovered cards; legacy track_job calls remain historical only.
 */
export function productionRequestsForEpisode(
  drafts: readonly ProductionRequest[], intents: readonly SettledProductionIntent[], episode: string,
): ProductionRequest[] {
  const requests = new Map(drafts.filter(request => request.episode === episode).map(request => [request.id, request]))
  for (const { callId, intent, binding } of intents) {
    if (intent.episode !== episode || intent.action !== 'track_job') continue
    if (intent.targetId === undefined || intent.jobKind === undefined) continue
    if (binding === undefined && intent.requestId !== undefined) continue
    const id = binding?.requestId ?? ProductionRequestId(`legacy:${callId}`)
    if (requests.has(id)) continue
    requests.set(id, {
      ...createProductionRequest({
        id, episode, targetId: intent.targetId, kind: intent.jobKind, prompt: intent.prompt ?? '', expectedOutputs: intent.expectedOutputs,
      }),
      ...(binding === undefined ? { legacy: true } : {}),
    })
  }
  return [...requests.values()]
}

/**
 * Deduplicate repeated track calls while retaining every distinct job in a batch.
 * @param intents - successful results in log order.
 * @param episode - full project/episode path.
 * @returns associations in registration order, never inferred from filenames or turns.
 */
export function productionBindingsForEpisode(intents: readonly SettledProductionIntent[], episode: string): ProductionBinding[] {
  const bindings = new Map<string, ProductionBinding>()
  for (const { binding } of intents) {
    if (binding?.episode === episode) bindings.set(`${binding.requestId}\0${binding.job.jobId}\0${String(binding.job.startedAt)}`, binding)
  }
  return [...bindings.values()]
}
