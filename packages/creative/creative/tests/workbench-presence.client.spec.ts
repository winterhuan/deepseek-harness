/**
 * The workbench claims the conversation layout only for a workspace that
 * actually holds creative work, and an explicit creator choice always wins.
 */

import { describe, expect, it } from 'vitest'
import {
  hasCreativeProject,
  readWorkbenchPreference,
  resolveWorkbenchOpen,
  workbenchPreferenceKey,
  workbenchPreferenceStorage,
  writeWorkbenchPreference,
  type WorkbenchPreferenceStorage,
} from '../src/client/workbench-presence.ts'

function storage(entries: Record<string, string> = {}): WorkbenchPreferenceStorage & { readonly entries: Record<string, string> } {
  return {
    entries,
    getItem: key => entries[key] ?? null,
    setItem: (key, value) => { entries[key] = value },
  }
}

function workspace(overrides: Partial<Parameters<typeof hasCreativeProject>[0]> = {}) {
  return { files: [], games: [], videos: [], ...overrides } as NonNullable<Parameters<typeof hasCreativeProject>[0]>
}

describe('creative project presence', () => {
  it('treats an unloaded workspace as having nothing to show', () => {
    expect(hasCreativeProject(undefined)).toBe(false)
  })

  it('does not count the bundled game example as workspace creative work', () => {
    expect(hasCreativeProject(workspace({ games: [{ source: 'example' }] }))).toBe(false)
  })

  it('recognizes creative files, workspace games and video projects', () => {
    expect(hasCreativeProject(workspace({ files: [{ path: '正文/第001章.md' }] }))).toBe(true)
    expect(hasCreativeProject(workspace({ games: [{ source: 'example' }, { source: 'workspace' }] }))).toBe(true)
    expect(hasCreativeProject(workspace({ videos: [{ id: 'recap' }] }))).toBe(true)
  })
})

describe('workbench open state', () => {
  it('follows the workspace when the creator has not chosen', () => {
    expect(resolveWorkbenchOpen(undefined, true)).toBe(true)
    expect(resolveWorkbenchOpen(undefined, false)).toBe(false)
  })

  it('keeps an explicit choice against what the workspace contains', () => {
    expect(resolveWorkbenchOpen('closed', true)).toBe(false)
    expect(resolveWorkbenchOpen('open', false)).toBe(true)
  })
})

describe('workbench preference storage', () => {
  it('keeps one choice per workspace', () => {
    const store = storage()
    writeWorkbenchPreference(store, '/work/novel', 'closed')
    writeWorkbenchPreference(store, '/work/drama', 'open')

    expect(store.entries[workbenchPreferenceKey('/work/novel')]).toBe('closed')
    expect(readWorkbenchPreference(store, '/work/novel')).toBe('closed')
    expect(readWorkbenchPreference(store, '/work/drama')).toBe('open')
    expect(readWorkbenchPreference(store, '/work/unknown')).toBeUndefined()
  })

  it('ignores an unusable storage, an unknown workspace and foreign values', () => {
    const refusing: WorkbenchPreferenceStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(readWorkbenchPreference(refusing, '/work/novel')).toBeUndefined()
    expect(readWorkbenchPreference(storage(), undefined)).toBeUndefined()
    expect(readWorkbenchPreference(undefined, '/work/novel')).toBeUndefined()
    expect(() => { writeWorkbenchPreference(refusing, '/work/novel', 'closed') }).not.toThrow()
    writeWorkbenchPreference(undefined, '/work/novel', 'closed')
    writeWorkbenchPreference(storage(), undefined, 'closed')
    const foreign = storage({ [workbenchPreferenceKey('/work/novel')]: 'minimized' })
    expect(readWorkbenchPreference(foreign, '/work/novel')).toBeUndefined()
  })

  it('reads the browser storage when the browser allows it', () => {
    expect(workbenchPreferenceStorage()).toBe(globalThis.localStorage)
  })
})
