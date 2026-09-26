/**
 * The creative production page's controller: six staged provider keys plus the
 * runtime profile, and that no literal ever reaches the settings section.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  CREATIVE_PRODUCE_NS,
  CreativeProduceCardController,
  type CreativeProduceSettings,
} from '../src/client/creative-produce-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites(host: StubConfigForm<CreativeProduceSettings>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as CreativeProduceSettings, user })
    return Promise.resolve(true)
  })
}

/** The page plugin's context, scripted down to the namespaces a page reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

function produceCredentials(configured: Record<string, boolean> = {}) {
  const refs = ['OPENAI_API_KEY', 'ARK_API_KEY', 'MINIMAX_API_KEY', 'MIMO_API_KEY', 'FISH_API_KEY', 'AGNES_API_KEY']
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: Object.fromEntries(refs.map(ref => [ref, { configured: configured[ref] ?? false, writable: true }])),
  }))
  const set = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
  return { ctx: ctxWith({ credentials: { describe, set } }), describe, set }
}

describe('CreativeProduceCardController', () => {
  it('names the creative-produce namespace', () => {
    expect(CREATIVE_PRODUCE_NS).toBe('creative-produce')
  })

  it('reads all six credential states in one describe call', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    const credentials = produceCredentials({ ARK_API_KEY: true, MIMO_API_KEY: true })
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    const state = () => controller.inject().hooks.creativeProduceCard.getSnapshot()

    host.publish({ status: 'ready', writable: true, value: { seedanceModel: 'seedance-2-5' }, user: {} })
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })
    await vi.waitFor(() => { expect(state().keys.arkApiKey.configured).toBe(true) })

    expect(credentials.describe).toHaveBeenCalledWith(
      ['OPENAI_API_KEY', 'ARK_API_KEY', 'MINIMAX_API_KEY', 'MIMO_API_KEY', 'FISH_API_KEY', 'AGNES_API_KEY'],
    )
    expect(state()).toMatchObject({
      seedanceModel: { text: 'seedance-2-5', overridden: false },
      keys: {
        openaiApiKey: { configured: false, writable: true },
        arkApiKey: { configured: true, writable: true },
        mimoApiKey: { configured: true, writable: true },
      },
    })
  })

  it('writes a staged key through the credentials domain, never the settings section', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    acceptWrites(host)
    const credentials = produceCredentials()
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('fishApiKey', ' fish-secret ')
    expect(face.hooks.creativeProduceCard.getSnapshot().dirty).toBe(true)
    expect(credentials.set).not.toHaveBeenCalled()

    credentials.describe.mockImplementation(() => Promise.resolve({
      ok: true as const,
      value: { FISH_API_KEY: { configured: true, writable: true } },
    }))
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith('FISH_API_KEY', 'fish-secret')
    expect(host.mutate).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(face.hooks.creativeProduceCard.getSnapshot()).toMatchObject({ dirty: false })
    })
  })

  it('keeps the stored key when the draft is left blank', () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    const credentials = produceCredentials({ OPENAI_API_KEY: true })
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('openaiApiKey', '   ')
    expect(face.hooks.creativeProduceCard.getSnapshot().dirty).toBe(false)
    face.save()

    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('stages profile fields as ordinary section edits', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    acceptWrites(host)
    const credentials = produceCredentials()
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('seedanceModel', 'seedance-2-5')
    face.edit('ttsProvider', 'mimo-tts')
    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledTimes(1) })

    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['seedanceModel'], value: 'seedance-2-5' },
      { op: 'set', path: ['ttsProvider'], value: 'mimo-tts' },
    ], undefined)
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('re-reads when the Host reports a watched reference changed', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    const credentials = produceCredentials()
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })
    credentials.describe.mockClear()

    // Another reference is not this page's business.
    controller.refreshCredential('OTHER_KEY')
    expect(credentials.describe).not.toHaveBeenCalled()

    // A key written on another surface reaches this page only through this signal.
    credentials.describe.mockImplementation(() => Promise.resolve({
      ok: true as const,
      value: { MINIMAX_API_KEY: { configured: true, writable: true } },
    }))
    controller.refreshCredential('MINIMAX_API_KEY')

    await vi.waitFor(() => {
      expect(controller.inject().hooks.creativeProduceCard.getSnapshot().keys.minimaxApiKey.configured).toBe(true)
    })
  })

  it('addresses the renamed reference when writing', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    acceptWrites(host)
    const credentials = produceCredentials()
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: { arkApiKeyEnv: 'ARK_KEY_V2' }, user: {} })
    const face = controller.inject()

    face.edit('arkApiKey', 'rotated')
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith('ARK_KEY_V2', 'rotated')
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('drops an answer that settled after its reference was renamed', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    const credentials = produceCredentials()
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    const state = () => controller.inject().hooks.creativeProduceCard.getSnapshot()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })

    type CredentialView = { ok: true; value: Record<string, { configured: boolean; writable: boolean }> }
    let releaseFirst!: (response: CredentialView) => void
    credentials.describe.mockImplementationOnce(() => new Promise<CredentialView>((resolve) => { releaseFirst = resolve }))
    const settled = credentials.describe.mock.calls.length
    host.publish({ status: 'ready', writable: true, value: { arkApiKeyEnv: 'ARK_KEY_V2' }, user: {} })
    // The hanging read registered synchronously inside publish.
    expect(credentials.describe).toHaveBeenCalledTimes(settled + 1)
    // The reference moves again while the first read is still in flight.
    host.publish({ status: 'ready', writable: true, value: { arkApiKeyEnv: 'ARK_KEY_V3' }, user: {} })
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalledTimes(settled + 2) })
    // The late answer still describes the superseded reference: it must not publish.
    releaseFirst({ ok: true, value: { ARK_KEY_V2: { configured: true, writable: true } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(credentials.describe).toHaveBeenCalledTimes(settled + 2)
    expect(state().keys.arkApiKey).toMatchObject({ configured: false })
  })

  it('keeps reporting the last answer when the credentials read fails', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    const describe = vi.fn(() => Promise.resolve({
      ok: false as const, error: { code: 'gateway/internal', message: 'down' },
    }))
    const set = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
    const controller = new CreativeProduceCardController(host.scope, ctxWith({ credentials: { describe, set } }))
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    expect(face.hooks.creativeProduceCard.getSnapshot().keys.openaiApiKey).toMatchObject({
      configured: false, writable: true,
    })
  })

  it('writes a bulk pool through the credentials domain in one write', async () => {
    const host = stubConfigForm<CreativeProduceSettings>()
    acceptWrites(host)
    const credentials = produceCredentials()
    const controller = new CreativeProduceCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    credentials.describe.mockImplementation(() => Promise.resolve({
      ok: true as const,
      value: { AGNES_API_KEY: { configured: true, writable: true } },
    }))
    await expect(face.saveKeys('agnesApiKey', '  bulk-a\nbulk-b\n')).resolves.toBe(true)

    expect(credentials.set).toHaveBeenCalledWith('AGNES_API_KEY', 'bulk-a\nbulk-b')
    expect(host.mutate).not.toHaveBeenCalled()
    await expect(face.saveKeys('agnesApiKey', '   ')).resolves.toBe(false)
  })
})
