// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { consumedIntentSeq, type SettledProductionIntent } from '../src/client/production-intents.ts'
import { createWorkbenchStore, type PersistedWorkbenchMemory } from '../src/client/workbench-store.ts'

const KEY = 'creative.workbench.v2.session-1'

function intent(seq: number, callId: string): SettledProductionIntent {
  return {
    seq, callId,
    intent: { action: 'set_sequence', episode: '书甲/剧集/EP001', shotIds: ['SHOT-001'] },
  }
}

/** One persisted value written before the sequence cursor existed. */
function legacy(ledger: Record<string, boolean>): Partial<PersistedWorkbenchMemory> {
  return {
    buffers: {},
    selected: '书甲/剧集/EP001/分镜.md',
    productionRequests: { '书甲/剧集/EP001': [] },
    productionSelections: { '书甲/剧集/EP001': { 'SHOT-001': 'version-1' } },
    productionReferences: { '书甲/剧集/EP001': { 'SHOT-001': ['image-1'] } },
    productionSequence: { '书甲/剧集/EP001': [{ shotId: 'SHOT-001', versionId: 'video-1' }] },
    productionCanvas: { '书甲/剧集/EP001': { 'SHOT-001': { x: 12, y: 34 } } },
    productionZoom: { '书甲/剧集/EP001': .5 },
    productionIntentCalls: ledger,
  }
}

function persisted(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
}

afterEach(() => { localStorage.clear() })

describe('persisted production intent cursor', () => {
  it('migrates a consumed call-id ledger into one cursor and keeps every retained field', () => {
    localStorage.setItem(KEY, JSON.stringify(legacy({ 'call-1': true, 'call-2': true })))
    const instance = createWorkbenchStore().create('session-1')
    const memory = instance.getSnapshot() as PersistedWorkbenchMemory
    expect(memory.productionIntentSeq).toBeUndefined()
    const intents = [intent(11, 'call-1'), intent(27, 'call-2'), intent(31, 'call-3')]
    // The ledger proved consumption through call-2 only; call-3 is still new work.
    const applied = consumedIntentSeq(intents, memory.productionIntentSeq, memory.productionIntentCalls)
    expect(applied).toBe(27)
    instance.actions.setProductionIntentSeq(applied)
    instance.actions.retireProductionIntentCalls()

    expect(instance.getSnapshot()).toMatchObject({
      productionIntentSeq: 27,
      selected: '书甲/剧集/EP001/分镜.md',
      productionSelections: { '书甲/剧集/EP001': { 'SHOT-001': 'version-1' } },
      productionReferences: { '书甲/剧集/EP001': { 'SHOT-001': ['image-1'] } },
      productionSequence: { '书甲/剧集/EP001': [{ shotId: 'SHOT-001', versionId: 'video-1' }] },
      productionCanvas: { '书甲/剧集/EP001': { 'SHOT-001': { x: 12, y: 34 } } },
      productionZoom: { '书甲/剧集/EP001': .5 },
    })
    // Local storage stops accumulating one boolean per production call.
    expect(persisted()).not.toHaveProperty('productionIntentCalls')
    expect(persisted()).toHaveProperty('productionIntentSeq', 27)
    expect(intents.filter(({ seq }) => seq > applied).map(({ callId }) => callId)).toEqual(['call-3'])
  })

  it('applies the current projection once when no ledger proves consumption', () => {
    localStorage.setItem(KEY, JSON.stringify(legacy({})))
    const instance = createWorkbenchStore().create('session-1')
    const memory = instance.getSnapshot() as PersistedWorkbenchMemory
    const intents = [intent(11, 'call-1'), intent(27, 'call-2')]
    expect(consumedIntentSeq(intents, memory.productionIntentSeq, memory.productionIntentCalls)).toBe(0)
    instance.actions.setProductionIntentSeq(intents.at(-1)!.seq)
    instance.actions.retireProductionIntentCalls()
    // A remount reads the cursor back and replays nothing.
    const replayed = createWorkbenchStore().create('session-1').getSnapshot() as PersistedWorkbenchMemory
    expect(replayed.productionIntentSeq).toBe(27)
    expect(intents.filter(({ seq }) => seq > replayed.productionIntentSeq)).toEqual([])
  })

  it('falls to the highest visible sequence when a ledger lands outside the window', () => {
    // The consumed events scrolled out of the loaded history: guessing lower would
    // replay navigation the store already applied in an earlier window.
    const intents = [intent(90, 'call-9'), intent(96, 'call-10')]
    expect(consumedIntentSeq(intents, undefined, { 'call-1': true })).toBe(96)
    expect(consumedIntentSeq([], undefined, { 'call-1': true })).toBe(0)
  })

  it('advances monotonically as the Conversation publishes newer results', () => {
    expect(consumedIntentSeq([intent(31, 'call-3')], 27, undefined)).toBe(27)
    expect(consumedIntentSeq([intent(31, 'call-3')], 40, undefined)).toBe(40)
    expect(consumedIntentSeq([], 40, undefined)).toBe(40)
  })
})
