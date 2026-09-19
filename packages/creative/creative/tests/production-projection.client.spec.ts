import { describe, expect, it } from 'vitest'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionEventMap, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler.ts'
import { productionCallDefinition, productionDefinition, productionView } from '../src/client/production-projection.ts'
import { productionBindingsForEpisode, productionRequestsForEpisode } from '../src/client/production-intents.ts'

const production = {
  requestId: 'card-1', episode: '书甲/剧集/EP001', targetId: 'SHOT-001', kind: 'image',
  job: { jobId: 'produce-1', startedAt: 10 },
}

function entry<Type extends keyof SessionEventMap>(seq: number, type: Type, data: SessionEventMap[Type]): SessionEventLikeEntry {
  return { type: 'event', event: { seq: seq as SessionSeq, time: seq, type, data } as SessionEvent }
}

function native(seq: number, callId: string, meta?: JsonValue) {
  return entry(seq, 'tool/result', {
    turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId(callId), content: [], isError: false }),
    ...(meta === undefined ? {} : { meta }),
  })
}

function assembler() {
  const target = new ConversationNodeAssembler(
    { entries: () => [productionDefinition, productionCallDefinition], fallbackEntry: () => undefined },
    { entries: () => [productionView] },
  )
  target.activateTarget('creative-production')
  return target
}

describe('incremental production result projection', () => {
  it('recovers a Native binding even when its call is outside the loaded window', () => {
    const target = assembler()
    target.replaceWindow([native(2, 'call-1', { production })], true)
    target.flush()
    expect(target.get('creative-production')?.[0]?.binding).toEqual(production)
  })

  it('projects nested PTC results, batches and full project paths without reading Chat', () => {
    const target = assembler()
    const ptc = (seq: number, episode: string, jobId: string) => entry(seq, 'tool/ptc-dispatch', {
      rootCallId: ToolCallId('outer'), parentCallId: ToolCallId('outer:code:1'), subCallId: ToolCallId(jobId),
      name: 'creative_produce_run', arguments: {}, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ production: { ...production, episode, job: { jobId, startedAt: seq } } }) }],
    })
    target.replaceWindow([native(2, 'call-1', { production })], false)
    target.append(ptc(3, production.episode, 'produce-2'))
    target.append(ptc(4, '书乙/剧集/EP001', 'produce-3'))
    target.flush()
    const intents = target.get('creative-production')!
    expect(productionBindingsForEpisode(intents, production.episode).map(binding => binding.job.jobId)).toEqual(['produce-1', 'produce-2'])
    expect(productionRequestsForEpisode([], intents, production.episode)).toHaveLength(1)
    const before = target.get('creative-production')
    target.append(native(5, 'unrelated'))
    target.flush()
    expect(target.get('creative-production')).toBe(before)
    target.replaceWindow([native(6, 'fresh', { production: { ...production, requestId: 'card-2' } })], false)
    target.flush()
    expect(target.get('creative-production')?.map(intent => intent.binding?.requestId)).toEqual(['card-2'])
  })

  it('uses the exact native call for historical intents and restores it on prepend', () => {
    const target = assembler()
    const call = entry(1, 'tool/call', {
      turn: 1, step: 1, callId: ToolCallId('legacy'), name: 'creative_production',
      arguments: JSON.stringify({ action: 'track_job', episode: production.episode, targetId: 'SHOT-001', jobId: 'old-name-token', jobKind: 'image' }),
    })
    target.replaceWindow([native(2, 'legacy')], true)
    target.flush()
    expect(target.get('creative-production')).toEqual([])
    target.prepend([call], false)
    target.flush()
    const cards = productionRequestsForEpisode([], target.get('creative-production')!, production.episode)
    expect(cards).toMatchObject([{ id: 'legacy:legacy', legacy: true }])
    expect(productionBindingsForEpisode(target.get('creative-production')!, production.episode)).toEqual([])
  })

  it('carries each projected result’s Session sequence, even across a replaced window', () => {
    const target = assembler()
    const ptc = (seq: number, jobId: string) => entry(seq, 'tool/ptc-dispatch', {
      rootCallId: ToolCallId('outer'), parentCallId: ToolCallId('outer:code:1'), subCallId: ToolCallId(jobId),
      name: 'creative_produce_run', arguments: {}, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ production: { ...production, requestId: 'card-1', job: { jobId, startedAt: seq } } }) }],
    })
    target.replaceWindow([native(2, 'call-1', { production })], false)
    target.append(ptc(3, 'produce-2'))
    target.flush()
    expect(target.get('creative-production')?.map(({ seq, callId }) => [seq, callId]))
      .toEqual([[2, 'call-1'], [3, 'produce-2']])
    // One request owns every distinct job binding; the sequence orders them.
    expect(productionBindingsForEpisode(target.get('creative-production')!, production.episode)
      .map(binding => binding.job.jobId)).toEqual(['produce-1', 'produce-2'])
    const replaced = production.episode
    expect(target.get('creative-production')?.every(({ intent }) => intent.episode === replaced)).toBe(true)
    target.replaceWindow([ptc(8, 'produce-2'), native(7, 'call-1', { production })], false)
    target.flush()
    expect(target.get('creative-production')?.map(({ seq }) => seq)).toEqual([7, 8])
  })

  it('does not publish malformed or failed production bindings', () => {
    const target = assembler()
    target.replaceWindow([
      native(1, 'bad', { production: { ...production, job: { jobId: 'missing-time' } } }),
      entry(2, 'tool/ptc-dispatch', {
        rootCallId: ToolCallId('outer'), parentCallId: ToolCallId('outer'), subCallId: ToolCallId('failed'),
        name: 'creative_produce_run', arguments: {}, isError: true,
        content: [{ type: 'text', text: JSON.stringify({ production }) }],
      }),
    ], false)
    target.flush()
    expect(target.get('creative-production')).toEqual([])
  })
})
