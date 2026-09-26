import { describe, expect, it } from 'vitest'
import { normalizeSessionLog } from '../src/normalize.ts'

const context = { sessionIds: [], cwd: '/workspace' }
const production = {
  requestId: 'card-1', episode: '书甲/剧集/EP001', targetId: 'SHOT-001', kind: 'image',
  job: { jobId: 'produce-1', startedAt: 1_800_000_000_000 },
}

function normalize(records: unknown[]): Record<string, unknown>[] {
  return normalizeSessionLog(records.map(record => JSON.stringify(record)).join('\n'), context)
    .trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
}

function nativeData(callId: string, binding = production) {
  return {
    message: {
      role: 'user', id: 'result-message', source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: JSON.stringify({ production: binding }) }], isError: false }],
    },
    meta: { production: binding },
  }
}

describe('production job reference normalization', () => {
  it('preserves repeated Native/PTC references and distinguishes reused job IDs', () => {
    const content = [{ type: 'text', text: JSON.stringify({ production }) }]
    const native = nativeData('native')
    const records = [
      { type: 'tool/call', data: { callId: 'native', name: 'creative_produce_run' } },
      { type: 'tool/result', data: native },
      { type: 'tool/ptc-dispatch', data: { name: 'creative_production', content } },
      { type: 'tool/ptc-dispatch', data: { name: 'creative_produce_run', content: [{
        type: 'text', text: JSON.stringify({ production: { ...production, job: { ...production.job, startedAt: production.job.startedAt + 1 } } }),
      }] } },
    ]
    const expected = structuredClone(records)
    expected[1] = { type: 'tool/result', data: nativeData('native', { ...production, job: { ...production.job, startedAt: 1 } }) }
    expected[2] = { type: 'tool/ptc-dispatch', data: { name: 'creative_production', content: [{
      type: 'text', text: JSON.stringify({ production: { ...production, job: { ...production.job, startedAt: 1 } } }),
    }] } }
    expected[3] = { type: 'tool/ptc-dispatch', data: { name: 'creative_produce_run', content: [{
      type: 'text', text: JSON.stringify({ production: { ...production, job: { ...production.job, startedAt: 2 } } }),
    }] } }
    expect(normalize(records)).toEqual(expected)
    expect(normalize(expected)).toEqual(expected)
    expect(native.meta.production.job.startedAt).toBe(production.job.startedAt)
  })

  it('retains unrelated prose, other tools, malformed bindings and non-JSON content', () => {
    const content = [{ type: 'text', text: JSON.stringify({ production }) }]
    const records = [
      { type: 'user/message', data: { content } },
      { type: 'tool/call', data: { callId: 'other', name: 'read' } },
      { type: 'tool/result', data: nativeData('other') },
      { type: 'tool/ptc-dispatch', data: { name: 'read', content } },
      { type: 'tool/ptc-dispatch', data: { name: 'creative_production', content: [
        { type: 'text', text: 'not JSON' },
        { type: 'text', text: JSON.stringify({ production: { ...production, job: { startedAt: production.job.startedAt } } }) },
        { type: 'text', text: JSON.stringify({ job: production.job }) },
        { type: 'image', source: 'fixture' },
      ] } },
      { type: 'tool/result', data: nativeData('missing') },
      { type: 'tool/result', data: null },
    ]
    expect(normalize(records)).toEqual(records)
  })
})
