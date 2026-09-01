/**
 * The drama preset's tracking protocol, exercised through the real plugin
 * module against an in-memory fs backend: the board carries the semantic
 * state, `drama_track` commits version-guarded transactions, and every derived
 * view (`剧集/规划.md`, `.drama/连续性.md`) is regenerated from the board —
 * hand-edited views are repairable through `drama_track` `check`.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PLUGIN_URL = fileURLToPath(new URL('../presets/drama/plugins/drama-tools.js', import.meta.url))

type FsFile = { content: string; version: number }

/** Minimal fs backend shaped like the ctx.fs contract used by the plugin. */
function memoryFs(files = new Map<string, FsFile>()) {
  const exists = (path: string): boolean => [...files.keys()].some(key => key === path || key.startsWith(`${path}/`))
  return {
    files,
    async resolve(path: string) { return path },
    async stat(path: string) {
      return exists(path) ? { type: 'file', version: files.get(path)?.version ?? 0 } : undefined
    },
    async readText(path: string) {
      const file = files.get(path)
      if (file === undefined) throw new Error(`missing ${path}`)
      return file.content
    },
    async writeText(path: string, content: string) {
      files.set(path, { content, version: (files.get(path)?.version ?? 0) + 1 })
    },
    async makeDir(path: string) {
      if (!exists(path)) files.set(path, { content: '', version: 0 })
    },
    async listDir(path: string) {
      return [...files.keys()]
        .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(key => key.slice(path.length + 1))
        .filter(key => key !== '')
    },
  }
}

async function bootTools(fs = memoryFs()) {
  const registry = new Map<string, { execute: (args: never, exec: unknown) => Promise<unknown> }>()
  const plugin = await import(PLUGIN_URL) as {
    name: string
    inject: string[]
    apply: (ctx: { tools: unknown; fs: unknown; effect: (body: () => () => void, label: string) => void }) => void
  }
  const registered: string[] = []
  plugin.apply({
    tools: { register: (definition: { name: string }) => {
      registry.set(definition.name, definition as never)
      registered.push(definition.name)
      return () => { registry.delete(definition.name) }
    } },
    fs,
    effect: (body: () => (() => void)) => { body(); return () => {} },
  })
  const call = (name: string, args: object, cwd = '/workspace') =>
    (registry.get(name) as { execute: (args: never, exec: unknown) => Promise<unknown> })
      .execute(args as never, { agent: { session: { header: { cwd } } } })
  return { fs, call, registered, registry }
}

describe('drama preset tools', () => {
  it('registers the five tools and disposes them with the effect', async () => {
    const fs = memoryFs()
    const plugin = await import(PLUGIN_URL) as {
      name: string
      inject: string[]
      apply: (ctx: {
        tools: { register: (definition: { name: string }) => () => void }
        fs: unknown
        effect: (body: () => () => void) => () => void
      }) => void
    }
    expect(plugin.name).toBe('drama-tools')
    expect(plugin.inject).toEqual(['tools', 'fs'])
    const disposed: string[] = []
    const reg = new Map<string, unknown>()
    let disposal: (() => void) | undefined
    plugin.apply({
      tools: { register: (definition: { name: string }) => {
        reg.set(definition.name, definition)
        return () => { disposed.push(definition.name); reg.delete(definition.name) }
      } },
      fs,
      effect: (body: () => () => void) => { disposal = body(); return disposal },
    })
    expect([...reg.keys()].sort()).toEqual([
      'drama_board', 'drama_episode', 'drama_memory', 'drama_scaffold', 'drama_track',
    ])
    disposal?.()
    expect(disposed).toHaveLength(5)
    expect(reg.size).toBe(0)
  })

  it('scaffolds create-if-absent and never overwrites existing files', async () => {
    const { fs, call } = await bootTools()
    const first = await call('drama_scaffold', { title: '测试短剧', productionForm: '实拍' }) as string
    expect(first).toContain('.drama/board.json')
    expect(first).toContain('剧集/')
    const board = await fs.readText('.drama/board.json')
    const parsed = JSON.parse(board) as { projectTitle: string; productionForm: string }
    expect(parsed.projectTitle).toBe('测试短剧')
    expect(parsed.productionForm).toBe('实拍')
    const second = await call('drama_scaffold', {}) as string
    expect(second).toContain('已完整')
    expect(await fs.readText('.drama/board.json')).toBe(board)
  })

  it('registers an episode and commits a versioned track transaction with derived views', async () => {
    const { fs, call } = await bootTools()
    await call('drama_scaffold', { title: '测试短剧' })
    await call('drama_track', {
      mode: 'commit',
      episode: '剧集/EP001',
      stage: 'screenplay',
      summary: '第一集落地',
      registerAsset: { kind: 'character', name: '林一', anchor: '落魄青年' },
    }) as { stateRevision: number }
    const board = JSON.parse(await fs.readText('.drama/board.json')) as { episodes: Record<string, { stage: string }> }
    expect(board.episodes['剧集/EP001']).toMatchObject({ stage: 'screenplay' })
    const plan = await fs.readText('剧集/规划.md')
    expect(plan).toContain('剧集/EP001')
    const continuity = await fs.readText('.drama/连续性.md')
    expect(continuity).toContain('character 林一')
  })

  it('registers a second episode without inventing documents', async () => {
    const { fs, call } = await bootTools()
    await call('drama_scaffold', {})
    await call('drama_track', { mode: 'commit', episode: '剧集/EP001', stage: 'assets' })
    await call('drama_track', { mode: 'commit', episode: '剧集/EP002', stage: 'develop' })
    const board = await call('drama_board', {}) as { episodes: unknown[]; summary: { episodeCount: number } }
    expect(board.summary.episodeCount).toBe(2)
    // No creator documents are ever pre-created.
    await expect(fs.readText('剧集/EP001/剧本.md')).rejects.toThrow(/missing/)
  })

  it('repairs hand-edited derived views through a check and a commit', async () => {
    const { fs, call } = await bootTools()
    await call('drama_scaffold', {})
    await call('drama_track', { mode: 'commit', episode: '剧集/EP001', stage: 'storyboard' })
    await fs.writeText('剧集/规划.md', '手改内容')
    const check = await call('drama_track', { mode: 'check' }) as { viewsToRewrite: { path: string }[] }
    expect(check.viewsToRewrite.some(item => item.path === '剧集/规划.md')).toBe(true)
    const commit = await call('drama_track', { mode: 'commit', episode: '剧集/EP001', stage: 'produce' }) as { derived: string[] }
    expect(commit.derived).toContain('剧集/规划.md')
    expect(await fs.readText('剧集/规划.md')).toContain('剧集/EP001')
    const healed = await call('drama_track', { mode: 'check' }) as { viewsToRewrite: unknown[] }
    expect(healed.viewsToRewrite).toEqual([])
  })

  it('remembers and forgets author courtesies', async () => {
    const { call } = await bootTools()
    const record = await call('drama_memory', { action: 'record', statement: '爽点要落地' }) as { receipt: string; total: number }
    expect(record.receipt).toBe('Author Memory Receipt')
    const query = await call('drama_memory', { action: 'query' }) as { entries: { statement: string }[] }
    expect(query.entries.map(entry => entry.statement)).toEqual(['爽点要落地'])
    await call('drama_memory', { action: 'forget', statement: '爽点要落地' })
    const after = await call('drama_memory', { action: 'query' }) as { entries: unknown[] }
    expect(after.entries).toHaveLength(0)
  })

  it('requires a session workspace for every tool call', async () => {
    const { registry } = await bootTools()
    const scaffold = registry.get('drama_scaffold') as { execute: (ctx: never, exec: unknown) => Promise<unknown> }
    await expect(scaffold.execute({} as never, {})).rejects.toThrow(/session cwd/)
  })
})
