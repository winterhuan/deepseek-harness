import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { NS } from '../src/client/locales/index.ts'

const SESSION_ID = 'creative-session' as SessionId

interface NavigationFace {
  readonly hooks: { readonly saves: ObservableSnapshot<ReadonlySet<string>> }
  readonly consumeFileNavigation: (tabId: TabId, revision: number) => boolean
  readonly beginFileSave: (path: string) => boolean
  readonly endFileSave: (path: string) => void
}

/** Production submission seam of the injected face. */
interface SubmittingFace extends NavigationFace {
  readonly beginProductionSubmission: (prompt: string) => SessionRequestId
  readonly sendProductionPrompt: (prompt: string, requestId: SessionRequestId) => Promise<void>
}

/** One fake Session face: the complete submission handle plus the prompt outcome. */
interface FakeSession {
  readonly abandon: ReturnType<typeof vi.fn>
  readonly prompt: ReturnType<typeof vi.fn>
  readonly session: {
    readonly beginSubmission: () => { readonly requestId: SessionRequestId; readonly abandon: () => void }
    readonly prompt: () => Promise<unknown>
  }
}

/**
 * Build one fake Session whose prompt behavior the caller picks.
 * @param outcome - 'accepted', 'rejected' (a normal `RemoteResult` refusal), or 'throws'.
 * @returns the fake Session and the spies recording its handle and prompt calls.
 */
function fakeSession(outcome: 'accepted' | 'rejected' | 'throws'): FakeSession {
  const abandon = vi.fn()
  const prompt = vi.fn(() => {
    if (outcome === 'throws') return Promise.reject(new Error('transport lost'))
    return Promise.resolve(outcome === 'accepted'
      ? { ok: true, value: { accepted: true } }
      : { ok: false, error: new Error('queue full') })
  })
  return { abandon, prompt, session: {
    beginSubmission: () => ({ requestId: 'rpc-1' as SessionRequestId, abandon }),
    prompt,
  } }
}

async function bench(session?: FakeSession) {
  const context = new Context()
  const renderer = context.plugin(SlotRegistry)
  onTestFinished(async () => { await renderer.dispose() })
  await renderer.await()
  context.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  const tabs = new SidebarRightTabRegistry(context)
  const openTab = vi.fn()
  context.provide('sidebarRightTabs', tabs)
  context.provide('sidebarRight', { openTab })
  context.provide('locale', new LocaleRuntime(context))
  context.provide('sessions', {
    list: createSnapshotStore({ byId: { [SESSION_ID]: { cwd: '/workspace' } } }),
    binding: () => ({ session: session?.session ?? {} }),
  })
  context.provide('conversation', {})
  context.provide('uiConversation', {
    events: { register: vi.fn() },
    views: { register: vi.fn() },
    binding: () => ({ target: () => createSnapshotStore([]) }),
  })
  const fiber = context.plugin({ inject: [...inject], apply })
  onTestFinished(async () => { await fiber.dispose() })
  await fiber.await()
  const registered = context.slots.entries('sidebar.right.pane.tab')[0]!
  const face = (registered.inject as unknown as (sessionId: SessionId) => SubmittingFace)(SESSION_ID)
  return { context, tabs, openTab, fiber, registered, face }
}

describe('Creative Sidebar integration', () => {
  it('registers a guide page and keyed body without opening a second workspace', async () => {
    const { context, tabs, registered, openTab } = await bench()
    const definition = tabs.get('creative')!
    const translate = context.locale.bind(NS)
    expect(definition.id).toBe('@deepseek-ai/dsh-creative')
    expect(definition.title('sidebar://creative')).toBe(translate('workbench.title'))
    expect(definition.guide?.map(entry => [entry.title(), entry.description?.()])).toEqual([
      [translate('workbench.title'), translate('workbench.description')],
    ])
    expect(registered.options.key).toBe(definition.id)
    expect(registered.store).toBeDefined()
    expect(openTab).not.toHaveBeenCalled()
    expect(context.slots.entries('tool.call.toolview')).toHaveLength(2)
  })

  it('reveals the Creative tab with Session-addressed navigation parameters', async () => {
    const { context, openTab, face } = await bench()
    const fallback = vi.fn(async () => {})
    await context.waterfall('conversation/open-file', SESSION_ID, '/workspace/正文/第001章.md', fallback)
    expect(openTab).toHaveBeenCalledWith('creative', { params: { creativeFile: { sessionId: SESSION_ID, path: '正文/第001章.md' } } })
    expect(fallback).not.toHaveBeenCalled()
    const tabId = 'creative-tab' as TabId
    expect(face.consumeFileNavigation(tabId, 1)).toBe(true)
    expect(face.consumeFileNavigation(tabId, 1)).toBe(false)
    expect(face.consumeFileNavigation(tabId, 2)).toBe(true)
    expect(face.consumeFileNavigation('another-tab' as TabId, 1)).toBe(true)
  })

  it.each(['README.md', '/another-workspace/正文/第001章.md'])('delegates %s to the normal file preview', async (path) => {
    const { context, openTab } = await bench()
    const fallback = vi.fn(async () => {})
    await context.waterfall('conversation/open-file', SESSION_ID, path, fallback)
    expect(fallback).toHaveBeenCalledOnce()
    expect(openTab).not.toHaveBeenCalled()
  })

  it('removes its guide, body, tool views, and file interception on unload', async () => {
    const { context, tabs, fiber, openTab } = await bench()
    await fiber.dispose()
    expect(tabs.get('creative')).toBeUndefined()
    expect(context.slots.entries('sidebar.right.pane.tab')).toEqual([])
    expect(context.slots.entries('tool.call.toolview')).toEqual([])
    const fallback = vi.fn(async () => {})
    await context.waterfall('conversation/open-file', SESSION_ID, '正文/第001章.md', fallback)
    expect(fallback).toHaveBeenCalledOnce()
    expect(openTab).not.toHaveBeenCalled()
  })
})

describe('production submission ownership', () => {
  it('retires the local echo when the prompt never settles', async () => {
    const session = fakeSession('throws')
    const { face } = await bench(session)
    const requestId = face.beginProductionSubmission('创造 SHOT-001 的关键帧')
    expect(requestId).toBe('rpc-1')
    await expect(face.sendProductionPrompt('创造 SHOT-001 的关键帧', requestId)).rejects.toThrow('transport lost')
    expect(session.abandon).toHaveBeenCalledOnce()
  })

  it('leaves retirement to prompt() when the Session refuses the identified request', async () => {
    const session = fakeSession('rejected')
    const { face } = await bench(session)
    const requestId = face.beginProductionSubmission('创造 SHOT-001 的关键帧')
    await expect(face.sendProductionPrompt('创造 SHOT-001 的关键帧', requestId)).rejects.toThrow('queue full')
    // prompt() settled and retired the identified echo itself; nothing else owns it.
    expect(session.abandon).not.toHaveBeenCalled()
  })

  it('never abandons an accepted submission', async () => {
    const session = fakeSession('accepted')
    const { face } = await bench(session)
    const requestId = face.beginProductionSubmission('创造 SHOT-001 的关键帧')
    await face.sendProductionPrompt('创造 SHOT-001 的关键帧', requestId)
    expect(session.prompt).toHaveBeenCalledOnce()
    expect(session.abandon).not.toHaveBeenCalled()
  })
})
