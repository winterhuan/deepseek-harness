import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { describe, expect, it } from 'vitest'
import { productionBindingsForEpisode, productionRequestsForEpisode, settledProductionIntent } from '../src/client/production-intents.js'
import { CREATIVE_PRODUCTION_TOOL_NAME, validateProductionIntent } from '../src/production-intent.js'
import { CREATIVE_PRODUCE_RUN_TOOL_NAME } from '../src/production-binding.ts'


const tracking = { action: 'track_job', episode: '书甲/剧集/EP001', targetId: 'SHOT-001', requestId: 'card-1', jobId: 'bash-1', jobKind: 'composition' } as const

function decodeResults(blocks: readonly unknown[]) {
  return blocks.flatMap((block) => {
    const intent = settledProductionIntent(block as ToolCallBlock)
    return intent === undefined ? [] : [intent]
  })
}

describe('native short-drama production intent tool', () => {
  it('validates semantic focus, sequence and tracked-job intents', () => {
    expect(validateProductionIntent({
      action: 'focus_target',
      episode: '剧集/EP001/',
      targetId: 'SHOT-EP001-008',
      section: 'shots',
    })).toEqual({ action: 'focus_target', episode: '剧集/EP001', targetId: 'SHOT-EP001-008', section: 'shots' })
    expect(validateProductionIntent({
      action: 'set_sequence',
      episode: '剧集/EP002',
      shotIds: ['SHOT-EP002-002', 'SHOT-EP002-001'],
    }).shotIds).toEqual(['SHOT-EP002-002', 'SHOT-EP002-001'])
    expect(() => validateProductionIntent({ action: 'focus_target', episode: '../EP001', targetId: 'SHOT-001' })).toThrow(/剧集\/EP001/u)
    expect(() => validateProductionIntent({ action: 'focus_target', episode: '剧集/EP001', targetId: '' })).toThrow(/targetId/u)
    expect(() => validateProductionIntent({ action: 'set_sequence', episode: '剧集/EP001', shotIds: ['SHOT-A', 'SHOT-A'] })).toThrow(/unique/u)
  })


  it('decodes only successful production results with valid arguments', () => {
    const block = (callId: string, argsRaw: string, isError = false) => ({
      kind: 'tool-result',
      callId,
      isError,
      call: { name: CREATIVE_PRODUCTION_TOOL_NAME, argsRaw },
      content: [],
      subCalls: [],
    })
    const nodes = [
      { key: 'tool:1', kind: 'tool-call', data: { root: block('intent-1', JSON.stringify({ action: 'open_section', episode: '剧集/EP001', section: 'assets' })) } },
      { key: 'tool:2', kind: 'tool-call', data: { root: block('intent-2', JSON.stringify({ action: 'focus_target', episode: '剧集/EP001', targetId: 'SHOT-002' }), true) } },
      { key: 'tool:3', kind: 'tool-call', data: { root: block('intent-3', '{bad') } },
    ]
    expect(decodeResults(nodes.map(node => node.data.root))).toEqual([{
      callId: 'intent-1',
      intent: { action: 'open_section', episode: '剧集/EP001', section: 'assets' },
    }])
  })

  it('recovers Native and PTC bindings, keeps batches, and leaves legacy calls historical', () => {
    const production = { requestId: 'card-1', episode: tracking.episode, targetId: 'SHOT-001', kind: 'image', job: { jobId: 'produce-1', startedAt: 10 } }
    const child = (callId: string, value: unknown, meta: boolean) => ({
      kind: 'tool-result', callId, isError: false, call: { name: CREATIVE_PRODUCE_RUN_TOOL_NAME, argsRaw: '{}' },
      content: meta ? [] : [{ type: 'text', text: JSON.stringify({ production: value }) }],
      ...(meta ? { meta: { production: value } } : {}), subCalls: [],
    })
    const native = child('native', production, true)
    const ptc = child('ptc', { ...production, targetId: 'SHOT-002', job: { jobId: 'produce-2', startedAt: 11 } }, false)
    const legacy = { ...native, callId: 'legacy', meta: {}, call: { name: CREATIVE_PRODUCTION_TOOL_NAME, argsRaw: JSON.stringify({ ...tracking, requestId: undefined }) } }
    const intents = decodeResults([native, ptc, legacy, child('foreign-project', { ...production, episode: '书乙/剧集/EP001' }, true)])
    const bindings = productionBindingsForEpisode(intents, tracking.episode)
    expect(bindings.map(item => item.job.jobId)).toEqual(['produce-1', 'produce-2'])
    const cards = productionRequestsForEpisode([], intents, tracking.episode)
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ id: 'card-1' })
    expect(cards[1]).toMatchObject({ id: 'legacy:legacy', legacy: true })
    expect(cards.every(card => !('status' in card))).toBe(true)
  })
})
