/**
 * The novelist preset's tracking protocol, exercised through the real plugin
 * module against an in-memory fs backend: the board carries the semantic
 * state, `novel_track` commits revision-checked transactions with the
 * wordcount band contract, and every derived view under `.novel/` is
 * regenerated from the state.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PLUGIN_URL = fileURLToPath(new URL('../presets/novelist/plugins/novel-tools.js', import.meta.url))

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
    async listDir(path: string) {
      return [...files.keys()]
        .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(key => key.slice(path.length + 1))
    },
  }
}

/** Boot the real plugin module against one fs backend and return its tools. */
/** Shape read back from a `novel_wordcount` call. */
interface MeasuredWords {
  actual: number
  status: string
  remainingUserRange: { min: number; max: number }
}

/** Shape read back from a `novel_board_read` call. */
interface BoardSnapshot {
  stateRevision: number
  lastChapter: number
  context: { longTermConstraints: string[]; nextChapterCommitments: string[] }
  characterNames: string[]
  foreshadows: { id: string; status: string; importance: string; plannedPayoffIn: number | null }[]
}

async function bootTools(fs = memoryFs()) {
  const registry = new Map<string, { execute: (args: never, exec: unknown) => Promise<unknown> }>()
  const plugin = await import(PLUGIN_URL) as {
    name: string
    inject: string[]
    apply: (ctx: { tools: unknown; fs: unknown; effect: (body: () => () => void, label: string) => void }) => void
  }
  void plugin
  const registered: string[] = []
  plugin.apply({
    tools: { register: (definition: { name: string }) => {
      registry.set(definition.name, definition as never)
      registered.push(definition.name)
      return () => { registry.delete(definition.name) }
    } },
    fs,
    effect: (body: () => () => void) => { body(); return () => {} },
  })
  const call = (name: string, args: object, cwd = '/workspace') =>
    (registry.get(name) as { execute: (args: never, exec: unknown) => Promise<unknown> })
      .execute(args as never, { agent: { session: { header: { cwd } } } })
  return { fs, call, registered, registry }
}

const BODY_2900 = `# 第一章 登场\n\n${'雾'.repeat(2900)}`
const BODY_100 = `# 第二章 短\n\n${'短'.repeat(100)}`
const SNAPSHOT = {
  identity: '落魄船工',
  location: '码头',
  goal: '翻身',
  state: '迈出第一步',
  abilities: ['水性好'],
  relationships: [],
  knowledge: [],
  openThreads: ['第一单能否做成'],
}

async function scaffoldedProject(fs: ReturnType<typeof memoryFs>) {
  await fs.writeText('chapters/01-登场.md', BODY_2900)
  await fs.writeText('chapters/02-短章.md', BODY_100)
}

describe('novelist preset tools', () => {
  it('registers the six tools and disposes them with the effect', async () => {
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
    expect(plugin.name).toBe('novelist-tools')
    expect(plugin.inject).toEqual(['tools', 'fs'])
    const disposed: string[] = []
    const registry = new Map<string, unknown>()
    let effectDisposal: (() => void) | undefined
    plugin.apply({
      tools: { register: (definition: { name: string }) => {
        registry.set(definition.name, definition)
        return () => { disposed.push(definition.name); registry.delete(definition.name) }
      } },
      fs,
      effect: (body: () => () => void) => { effectDisposal = body(); return effectDisposal },
    })
    expect([...registry.keys()].sort()).toEqual([
      'novel_board_read', 'novel_board_update', 'novel_memory', 'novel_scaffold', 'novel_track', 'novel_wordcount',
    ])
    effectDisposal?.()
    expect(disposed).toHaveLength(6)
    expect(registry.size).toBe(0)
  })

  it('scaffolds create-if-absent and never overwrites existing files', async () => {
    const { fs, call } = await bootTools()
    await scaffoldedProject(fs)
    const first = await call('novel_scaffold', {}) as string
    expect(first).toContain('- outline.md')
    expect(first).toContain('- .novel/board.json')
    const outline = await fs.readText('outline.md')
    const second = await call('novel_scaffold', {}) as string
    expect(second).toContain('项目骨架已完整')
    expect(await fs.readText('outline.md')).toBe(outline)
  })

  it('initializes tracking once and refuses a second init', async () => {
    const { call } = await bootTools()
    const init = await call('novel_track', {
      action: 'init',
      bookTitle: '测试之书',
      position: { volume: '第一卷', volumeStartChapter: 1, storyTime: '开篇', scene: '码头' },
      longTermConstraints: ['爽点要落地'],
      nextChapterCommitments: ['主角登场'],
      characters: { 林一: SNAPSHOT },
    }) as { stateRevision: number; lastChapter: number; viewProblems: string[] }
    expect(init.stateRevision).toBe(0)
    expect(init.viewProblems).toEqual([])
    await expect(call('novel_track', { action: 'init' })).rejects.toThrow(/绝不覆盖/)
  })

  it('commits an in-band chapter transaction and regenerates every derived view', async () => {
    const { fs, call } = await bootTools()
    await scaffoldedProject(fs)
    await call('novel_track', {
      action: 'init',
      bookTitle: '测试之书',
      longTermConstraints: ['爽点要落地'],
      characters: { 林一: SNAPSHOT },
    })
    const commit = await call('novel_track', {
      action: 'commit',
      mode: 'append',
      chapter: 1,
      chapterTitle: '登场',
      expectedRevision: 0,
      result: '林一在码头接下第一单',
      characterChanges: [{ name: '林一', change: '接下第一单' }],
      characterSnapshots: { 林一: { ...SNAPSHOT, location: '码头' } },
      foreshadowChanges: [{ action: 'upsert', id: 'F01', summary: '船底暗记', plantedIn: '01-登场.md', status: '已埋', importance: '高' }],
      timelineChanges: [
        { action: 'upsert', id: 'E01', objectiveFact: '林一接单', readerKnowledge: '读者知道林一接了单', revealStatus: '已揭示', characters: ['林一'] },
        { action: 'upsert', id: 'E02', objectiveFact: '幕后黑手是船长', readerKnowledge: '', revealStatus: '未揭示' },
      ],
      longTermConstraints: ['爽点要落地'],
      continuityRisks: [],
      activeCharacters: ['林一'],
      wordTarget: 3000,
    }) as { stateRevision: number; words: { actual: number; status: string; resolution: string } }
    expect(commit.stateRevision).toBe(1)
    expect(commit.words).toMatchObject({ actual: 2900, status: 'internal_pass', resolution: 'within_user_band' })
    const card = await fs.readText('.novel/上下文.md')
    for (const section of ['当前位置', '长期约束', '核心角色状态', '活跃伏笔', '近三章速记', '下一章承诺', '连贯性风险']) {
      expect(card).toContain(`## ${section}`)
    }
    const reader = await fs.readText('.novel/时间线/读者已知.md')
    expect(reader).toContain('| E01 |')
    expect(reader).not.toContain('E02')
    expect(await fs.readText('.novel/角色状态/林一.md')).toContain('# 林一｜当前状态')
    expect(await fs.readText('.novel/逐章记录/第001章.md')).toContain('林一在码头接下第一单')
    const check = await call('novel_track', { action: 'check' }) as { ok: boolean; stateRevision: number; lastChapter: number }
    expect(check).toMatchObject({ ok: true, stateRevision: 1, lastChapter: 1 })
  })

  it('rejects stale revisions, wrong chapter numbers, and band-out lengths', async () => {
    const { fs, call } = await bootTools()
    await scaffoldedProject(fs)
    await call('novel_track', { action: 'init', characters: { 林一: SNAPSHOT } })
    await expect(call('novel_track', {
      action: 'commit', mode: 'append', chapter: 1, expectedRevision: 7, result: 'x', wordTarget: 3000,
    })).rejects.toThrow(/expectedRevision/)
    await expect(call('novel_track', {
      action: 'commit', mode: 'append', chapter: 2, expectedRevision: 0, result: 'x', wordTarget: 3000,
    })).rejects.toThrow(/append 章号/)
    await expect(call('novel_track', {
      action: 'commit', mode: 'append', chapter: 1, expectedRevision: 0, result: 'x', wordTarget: 100,
    })).rejects.toThrow(/带外/)
    const accept = await call('novel_track', {
      action: 'commit', mode: 'append', chapter: 1, expectedRevision: 0, result: '接受短章',
      wordTarget: 100, acceptCurrentLength: true,
    }) as { words: { resolution: string } }
    expect(accept.words.resolution).toBe('accepted_current_length')
    await call('novel_track', {
      action: 'commit', mode: 'append', chapter: 2, expectedRevision: 1, result: '短但接受', wordTarget: 3000, acceptCurrentLength: true,
    })
    await expect(call('novel_track', {
      action: 'commit', mode: 'append', chapter: 3, expectedRevision: 2, result: 'x', wordTarget: 3000, acceptCurrentLength: true,
    })).rejects.toThrow(/必须恰有一个正文文件/)
  })

  it('demands explicit retirement when context items leave the state', async () => {
    const { fs, call } = await bootTools()
    await scaffoldedProject(fs)
    await call('novel_track', { action: 'init', longTermConstraints: ['爽点要落地'] })
    await fs.writeText('chapters/03-终章.md', `# 第三章\n\n${'雾'.repeat(2900)}`)
    await expect(call('novel_track', {
      action: 'commit', mode: 'append', chapter: 1, expectedRevision: 0, result: 'x', wordTarget: 3000,
      longTermConstraints: [], continuityRisks: [],
    })).rejects.toThrow(/retiredContextItems/)
    const commit = await call('novel_track', {
      action: 'commit', mode: 'append', chapter: 1, expectedRevision: 0, result: 'x', wordTarget: 3000,
      longTermConstraints: [], continuityRisks: [], retiredContextItems: ['爽点要落地'],
    }) as { stateRevision: number }
    expect(commit.stateRevision).toBe(1)
  })

  it('repairs hand-edited derived views through a revision transaction', async () => {
    const { fs, call } = await bootTools()
    await scaffoldedProject(fs)
    await call('novel_track', { action: 'init', characters: { 林一: SNAPSHOT } })
    await call('novel_track', {
      action: 'commit', mode: 'append', chapter: 1, expectedRevision: 0, result: '一章',
      characterChanges: [{ name: '林一', change: '接单' }], characterSnapshots: { 林一: SNAPSHOT },
      wordTarget: 3000,
    })
    await fs.writeText('.novel/伏笔.md', '手改内容')
    const broken = await call('novel_track', { action: 'check' }) as { ok: boolean; problems: string[] }
    expect(broken.ok).toBe(false)
    expect(broken.problems.join('\n')).toContain('.novel/伏笔.md')
    await call('novel_track', {
      action: 'commit', mode: 'revision', chapter: 1, expectedRevision: 1, result: '一章', wordTarget: 3000,
    })
    const healed = await call('novel_track', { action: 'check' }) as { ok: boolean }
    expect(healed.ok).toBe(true)
  })

  it('measures word counts without writing anything', async () => {
    const { fs, call } = await bootTools()
    await scaffoldedProject(fs)
    const before = fs.files.get('chapters/01-登场.md')?.version
    const measured = await call('novel_wordcount', { file: '01-登场.md', target: 3000 }) as MeasuredWords
    expect(measured).toMatchObject({ actual: 2900, status: 'internal_pass', remainingUserRange: { min: 0, max: 550 } })
    expect(fs.files.get('chapters/01-登场.md')?.version).toBe(before)
  })

  it('keeps the author memory with receipts, kinds, and confirm/forget', async () => {
    const { fs, call } = await bootTools()
    const record = await call('novel_memory', {
      action: 'record', kind: 'prose_style', statement: '短句白描', source: '我就喜欢短句',
    }) as { receipt: string; id: string; status: string }
    expect(record.receipt).toBe('Author Memory Receipt')
    const pending = await call('novel_memory', {
      action: 'record', kind: 'story_design', statement: '少写感情线', source: '可能吧', pending: true,
    }) as { id: string }
    const query = await call('novel_memory', { action: 'query', kinds: ['prose_style'] }) as { entries: { statement: string }[] }
    expect(query.entries.map(entry => entry.statement)).toEqual(['短句白描'])
    await call('novel_memory', { action: 'confirm', id: pending.id })
    const all = await call('novel_memory', { action: 'list' }) as { entries: unknown[] }
    expect(all.entries).toHaveLength(2)
    await call('novel_memory', { action: 'forget', id: pending.id })
    const after = await call('novel_memory', { action: 'list' }) as { entries: unknown[] }
    expect(after.entries).toHaveLength(1)
    const stored = JSON.parse(await fs.readText('.story/author-memory.json')) as { entries: unknown[] }
    expect(stored.entries).toHaveLength(1)
  })

  it('reads the board with tracking context and v2 foreshadow fields', async () => {
    const { call } = await bootTools()
    await call('novel_track', {
      action: 'init',
      bookTitle: '测试之书',
      position: { volume: '第一卷', volumeStartChapter: 1, storyTime: '开篇', scene: '码头' },
      longTermConstraints: ['爽点要落地'],
      nextChapterCommitments: ['主角登场'],
      characters: { 林一: SNAPSHOT },
      foreshadows: [{ id: 'F01', summary: '船底暗记', plantedIn: '00-序.md', importance: '高' }],
    })
    await call('novel_board_update', {
      action: 'record_foreshadow', summary: '新伏笔', plantedIn: '01-登场.md', importance: '低', plannedPayoffIn: 5,
    })
    await call('novel_board_update', { action: 'set_chapter_status', chapter: '01-登场.md', status: 'revised', target: 3000 })
    const board = await call('novel_board_read', {}) as BoardSnapshot
    expect(board.stateRevision).toBe(0)
    expect(board.context.longTermConstraints).toEqual(['爽点要落地'])
    expect(board.characterNames).toEqual(['林一'])
    expect(board.foreshadows[0]).toMatchObject({ id: 'F01', status: '已埋', importance: '高' })
    expect(board.foreshadows[1]).toMatchObject({ status: '已埋', importance: '低', plannedPayoffIn: 5 })
  })

  it('requires a session workspace for every tool call', async () => {
    const { registry } = await bootTools()
    const scaffold = registry.get('novel_scaffold') as { execute: (args: never, exec: unknown) => Promise<unknown> }
    await expect(scaffold.execute({} as never, {})).rejects.toThrow(/session cwd/)
  })
})
