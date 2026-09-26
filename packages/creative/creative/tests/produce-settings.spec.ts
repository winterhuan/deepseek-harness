import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  CREATIVE_PRODUCE_SETTINGS_NAMESPACE,
  currentProduceConfig,
  keyLines,
  keyReferences,
  resolveProduceEnv,
  resolveProduceEnvs,
} from '../src/produce-settings.ts'

function emptyCtx(): Context {
  return { get: () => undefined } as unknown as Context
}

describe('creative produce settings', () => {
  it('names the settings section the produce Loader row declares', () => {
    expect(CREATIVE_PRODUCE_SETTINGS_NAMESPACE).toBe('creative-produce')
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

  it('looks up a renamed reference without renaming the adapter environment', async () => {
    const resolve = vi.fn(async (ref: unknown) => String(ref) === 'OPENAI_KEY_ROTATED'
      ? { value: 'rotated', source: 'store' } : undefined)
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const env = await resolveProduceEnv(ctx, { openaiApiKeyEnv: 'OPENAI_KEY_ROTATED' })
    expect(resolve).toHaveBeenCalledWith('OPENAI_KEY_ROTATED')
    expect(env).toEqual({ OPENAI_API_KEY: 'rotated' })
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

  it('reads the settings section the service projects and the entry otherwise', () => {
    const entry = { seedanceModel: 'entry-model' }
    const served = { seedanceModel: 'user-model' }
    const ctx = {
      get: (name: string) => name === 'settings'
        ? { describe: () => [{ ns: CREATIVE_PRODUCE_SETTINGS_NAMESPACE, value: served }, { ns: 'other', value: {} }] }
        : undefined,
    } as unknown as Context
    expect(currentProduceConfig(ctx, entry)).toBe(served)
    expect(currentProduceConfig(emptyCtx(), entry)).toBe(entry)
    const unserved = {
      get: (name: string) => name === 'settings' ? { describe: () => [{ ns: 'other', value: {} }] } : undefined,
    } as unknown as Context
    expect(currentProduceConfig(unserved, entry)).toBe(entry)
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
    expect(envs[0]).toMatchObject({ AGNES_API_KEY: 'stored-AGNES_A', OPENAI_API_KEY: 'stored-OPENAI_API_KEY' })
    expect(envs[1]).toMatchObject({ AGNES_API_KEY: 'stored-AGNES_B', OPENAI_API_KEY: 'stored-OPENAI_API_KEY' })
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
    expect(envs[0]).toEqual({ AGNES_API_KEY: 'stored-a' })
    expect(envs[0]?.AGNES_B).toBeUndefined()
  })

  it('expands a stored bulk pool into canonical adapter environments', async () => {
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'AGNES_POOL' ? { value: 'bulk-a\n\nbulk-b\n', source: 'store' } : undefined
    })
    const ctx = { get: (name: string) => name === 'credentials' ? { resolve } : undefined } as unknown as Context
    const envs = await resolveProduceEnvs(ctx, { agnesApiKeyEnv: 'AGNES_POOL' })
    expect(envs).toHaveLength(2)
    expect(envs[0]).toEqual({ AGNES_API_KEY: 'bulk-a' })
    expect(envs[1]).toEqual({ AGNES_API_KEY: 'bulk-b' })
    expect(resolve).toHaveBeenCalledTimes(6)
  })
})
