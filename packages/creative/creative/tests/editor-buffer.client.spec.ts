import { describe, expect, it } from 'vitest'
import { createSaveState, needsFileRead, receiveFile, reconcileBuffers, restoreBuffers, type FileBuffers } from '../src/client/editor-buffer.ts'

const draft = { content: 'draft', saved: 'disk', source: 'human' as const, version: 'first' }
const file = { path: '正文/第001章.md', content: 'disk', bytes: 4, version: 'first' }

describe('Creative editor buffers', () => {
  it('retains every dirty draft across consecutive file removals', () => {
    const buffers = { first: draft, second: draft }
    const first = reconcileBuffers(buffers, new Set(['second']), false, 'removed')
    const second = reconcileBuffers(first, new Set(), false, 'removed')
    expect(second).toEqual({
      first: { ...draft, missing: true, error: 'removed' },
      second: { ...draft, missing: true, error: 'removed' },
    })
    expect(reconcileBuffers(second, new Set(), false, 'removed')).toBe(second)
  })

  it('drops clean deleted buffers without needing a dirty deletion', () => {
    expect(reconcileBuffers({ first: { ...draft, content: draft.saved } }, new Set(), false, 'removed')).toEqual({})
  })

  it('does not infer deletion from a truncated directory listing', () => {
    const buffers = { first: draft, second: { ...draft, content: draft.saved } }
    expect(reconcileBuffers(buffers, new Set(), true, 'removed')).toBe(buffers)
    expect(reconcileBuffers(buffers, new Set(Object.keys(buffers)), false, 'removed')).toBe(buffers)
  })

  it.each(['first', 'second'])('restores a reappearing file at disk version %s without replacing its draft', (version) => {
    const buffer = receiveFile({ ...draft, missing: true, error: 'removed' }, { ...file, version }, 'conflict')
    expect(buffer).toMatchObject({ content: 'draft', saved: 'disk', version: 'first', missing: false })
    expect(buffer.error).toBeUndefined()
    expect(buffer.conflict).toEqual(version === 'first' ? undefined : { message: 'conflict', theirs: 'disk', theirsVersion: 'second' })
    expect(needsFileRead(buffer, version)).toBe(false)
  })

  it('refreshes clean and streamed buffers when the disk revision changes', () => {
    expect(needsFileRead(undefined, 'first')).toBe(true)
    expect(needsFileRead({ ...draft, content: draft.saved }, 'second')).toBe(true)
    expect(needsFileRead({ ...draft, source: 'agent' }, 'first')).toBe(true)
    expect(receiveFile({ ...draft, source: 'agent' }, file, 'conflict')).toEqual({ content: 'disk', saved: 'disk', source: 'disk', version: 'first' })
  })

  it('clears an agent-write conflict when the tool settles without changing disk content', () => {
    const buffer = { ...draft, conflict: { message: 'agent writing' } }
    expect(needsFileRead(buffer, file.version)).toBe(true)
    const settled = receiveFile(buffer, file, 'disk changed')
    expect(settled.content).toBe(draft.content)
    expect(settled.conflict).toBeUndefined()
    expect(needsFileRead(settled, file.version)).toBe(false)
  })

  it('removes legacy saving state only when restoring persisted buffers', () => {
    const buffers: FileBuffers = { first: { ...draft, saving: true } as typeof draft }
    expect(restoreBuffers(buffers)).toEqual({ first: draft })
    expect(restoreBuffers({ first: draft }).first).toBe(draft)
  })

  it('shares in-flight saves across views but not across Session runtimes', () => {
    const state = createSaveState()
    expect(state.begin(file.path)).toBe(true)
    expect(state.begin(file.path)).toBe(false)
    expect(state.active.getSnapshot().has(file.path)).toBe(true)
    expect(createSaveState().active.getSnapshot().size).toBe(0)
    state.end(file.path)
    expect(state.begin(file.path)).toBe(true)
    state.end(file.path)
  })
})
