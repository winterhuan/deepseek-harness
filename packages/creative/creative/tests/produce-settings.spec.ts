import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import {
  CREATIVE_PRODUCE_SETTINGS_NAMESPACE,
  currentProduceConfig,
  keyLines,
  keyReferences,
  registerProduceSettings,
  resolveProduceEnv,
  resolveProduceEnvs,
} from '../src/produce-settings.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function emptyCtx(): Context {
  return { get: () => undefined } as unknown as Context
}

describe('creative produce settings', () => {
  it('serves schema defaults through the creative-produce namespace', async () => {
    expect(CREATIVE_PRODUCE_SETTINGS_NAMESPACE).toBe('creative-produce')
    const ctx = new Context()
    const fiber = ctx.plugin(MemorySettings)
    await fiber.await()
    registerProduceSettings(ctx, {})
    await vi.waitFor(() => {
      expect(ctx.settings.get(CREATIVE_PRODUCE_SETTINGS_NAMESPACE)).toBeDefined()
    })
    expect(ctx.settings.get(CREATIVE_PRODUCE_SETTINGS_NAMESPACE)).toMatchObject({
      openaiApiKeyEnv: 'OPENAI_API_KEY',
      arkApiKeyEnv: 'ARK_API_KEY',
      minimaxApiKeyEnv: 'MINIMAX_API_KEY',
      mimoApiKeyEnv: 'MIMO_API_KEY',
      fishApiKeyEnv: 'FISH_API_KEY',
      agnesApiKeyEnv: 'AGNES_API_KEY',
      ttsProvider: 'auto',
    })
    await ctx.fiber.dispose()
  })

  it('resolves keys from the credentials store ahead of the launch environment', async () => {
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'OPENAI_API_KEY' ? { value: 'stored-key', source: 'store' } : undefined
    })
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const env = await resolveProduceEnv(ctx, { ttsProvider: 'auto' })
    expect(env.OPENAI_API_KEY).toBe('stored-key')
    expect(env.TTS_PROVIDER).toBe('auto')
    expect(resolve).toHaveBeenCalledTimes(6)
  })

  it('falls back to the launch environment and skips unset values', async () => {
    const ctx = {
      get: (name: string) => name === 'launchEnvironment'
        ? { get: (key: string) => key === 'ARK_API_KEY' ? { value: 'env-key' } : undefined }
        : undefined,
    } as unknown as Context
    const env = await resolveProduceEnv(ctx, {
      openaiApiKeyEnv: 'OPENAI_API_KEY',
      seedanceModel: 'seedance-2-5',
      minimaxVideoMinDuration: 4,
    })
    expect(env).toEqual({ ARK_API_KEY: 'env-key', SEEDANCE_MODEL: 'seedance-2-5', MINIMAX_VIDEO_MIN_DURATION: '4' })
  })

  it('honours a renamed reference for both lookup and forwarded name', async () => {
    const resolve = vi.fn(async () => ({ value: 'rotated', source: 'store' }))
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const env = await resolveProduceEnv(ctx, { openaiApiKeyEnv: 'OPENAI_KEY_ROTATED' })
    expect(env.OPENAI_KEY_ROTATED).toBe('rotated')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  it('treats blank and non-finite values as unset', async () => {
    const resolve = vi.fn(async (ref: unknown) => {
      const name = String(ref)
      if (name === 'OPENAI_API_KEY') return { value: '', source: 'store' }
      return undefined
    })
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const env = await resolveProduceEnv(ctx, {
      arkApiKeyEnv: '',
      seedanceMinDuration: Number.NaN,
      seedanceModel: '',
    })
    expect(env.ARK_API_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.SEEDANCE_MIN_DURATION).toBeUndefined()
    expect(env.SEEDANCE_MODEL).toBeUndefined()
  })

  it('reads the settings namespace when served and the entry otherwise', () => {
    const entry = { seedanceModel: 'entry-model' }
    const served = { seedanceModel: 'user-model' }
    const ctx = {
      get: (name: string) => name === 'settings' ? { get: () => served } : undefined,
    } as unknown as Context
    expect(currentProduceConfig(ctx, entry)).toBe(served)
    expect(currentProduceConfig(emptyCtx(), entry)).toBe(entry)
  })

  it('splits comma-separated references and falls back when blank', () => {
    expect(keyReferences('AGNES_A, AGNES_B ,', 'AGNES_API_KEY')).toEqual(['AGNES_A', 'AGNES_B'])
    expect(keyReferences('', 'AGNES_API_KEY')).toEqual(['AGNES_API_KEY'])
    expect(keyReferences(undefined, 'AGNES_API_KEY')).toEqual(['AGNES_API_KEY'])
  })

  it('splits one stored value into a bulk pool, one key per line', () => {
    expect(keyLines('sk-a\nsk-b\n\n  sk-c  \n')).toEqual(['sk-a', 'sk-b', 'sk-c'])
    expect(keyLines('')).toEqual([])
  })

  it('resolves one environment per key variant in rotation order', async () => {
    const resolve = vi.fn(async (ref: unknown) => ({ value: `stored-${String(ref)}`, source: 'store' }))
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const envs = await resolveProduceEnvs(ctx, {
      agnesApiKeyEnv: 'AGNES_A, AGNES_B ,',
      openaiApiKeyEnv: 'OPENAI_API_KEY',
    })
    expect(envs).toHaveLength(2)
    expect(envs[0]).toMatchObject({ AGNES_A: 'stored-AGNES_A', OPENAI_API_KEY: 'stored-OPENAI_API_KEY' })
    expect(envs[1]).toMatchObject({ AGNES_B: 'stored-AGNES_B', OPENAI_API_KEY: 'stored-OPENAI_API_KEY' })
    expect(envs[1]?.AGNES_A).toBeUndefined()
    expect(resolve).toHaveBeenCalledTimes(7)
  })

  it('leaves unresolvable keys unset instead of forwarding blanks', async () => {
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'AGNES_A' ? { value: 'stored-a', source: 'store' } : undefined
    })
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const envs = await resolveProduceEnvs(ctx, { agnesApiKeyEnv: 'AGNES_A,AGNES_B' })
    expect(envs).toHaveLength(1)
    expect(envs[0]).toMatchObject({ AGNES_A: 'stored-a' })
    expect(envs[0]?.AGNES_B).toBeUndefined()
  })

  it('expands one bulk value into one attempt per line under the same reference', async () => {
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'AGNES_POOL' ? { value: 'bulk-a\n\nbulk-b\n', source: 'store' } : undefined
    })
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const envs = await resolveProduceEnvs(ctx, { agnesApiKeyEnv: 'AGNES_POOL' })
    expect(envs).toHaveLength(2)
    expect(envs[0]).toEqual({ AGNES_POOL: 'bulk-a' })
    expect(envs[1]).toEqual({ AGNES_POOL: 'bulk-b' })
    expect(resolve).toHaveBeenCalledTimes(6)
  })
})
