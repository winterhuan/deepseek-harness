import { describe, expect, it } from 'vitest'
import { createGameStudioStore } from '../src/client/stores.js'

describe('createGameStudioStore', () => {
  it('initializes default state', () => {
    const store = createGameStudioStore().create()
    expect(store.getSnapshot().projectId).toBeUndefined()
    expect(store.getSnapshot().tab).toBe('preview')
    expect(store.getSnapshot().previewRevision).toBe(0)
  })

  it('sets project id', () => {
    const store = createGameStudioStore().create()
    store.actions.setProjectId('project-1')
    expect(store.getSnapshot().projectId).toBe('project-1')
  })

  it('bumps preview revision', () => {
    const store = createGameStudioStore().create()
    store.actions.bumpPreviewRevision()
    expect(store.getSnapshot().previewRevision).toBe(1)
  })
})
