// @vitest-environment jsdom
import { describe, expect, it, onTestFinished } from 'vitest'
import { createWorkbenchStore } from '../src/client/workbench-store.ts'

describe('Creative persisted drafts', () => {
  it('restores a dirty draft without resurrecting a save interrupted by page reload', () => {
    const declaration = createWorkbenchStore()
    const session = 'editor-reload'
    const key = `creative.workbench.v2.${session}`
    const path = '正文/第001章.md'
    const draft = { content: 'uncommitted draft', saved: 'disk', source: 'human', version: 'original' }
    onTestFinished(() => { localStorage.removeItem(key) })
    localStorage.setItem(key, JSON.stringify({ ...declaration.spec.init(), buffers: { [path]: { ...draft, saving: true } } }))
    const store = declaration.create(session)
    expect(store.getSnapshot().buffers[path]).toEqual(draft)
    expect(JSON.parse(localStorage.getItem(key)!) as unknown).toMatchObject({ buffers: { [path]: draft } })
    expect(localStorage.getItem(key)).not.toContain('saving')
  })
})
