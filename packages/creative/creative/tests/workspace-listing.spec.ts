import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { type FileSystem, type FsDirEntry, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { listFiles, registerWorkspaceRoute, workspaceProjects } from '../src/workspace-route.js'

type ListingRealm = Parameters<typeof listFiles>[0]

/**
 * In-memory workspace: `tree` maps absolute directory paths to child names,
 * everything not a directory is a file. Mirrors the dsh-fs shape the route
 * walks, including the branded-id casts used by native-hooks.spec.ts.
 * `versioned` lists file display paths whose directory entries already carry
 * a version and size, like a real filesystem listing; the rest fall back to
 * `stat`, so both resolution paths stay covered.
 */
function memoryRealm(
  tree: Readonly<Record<string, readonly string[]>>,
  versioned: ReadonlySet<string> = new Set(),
  links: Readonly<Record<string, string>> = {},
): ListingRealm {
  const target = (displayPath: string): FsTarget => ({ targetKey: displayPath as FsTarget['targetKey'], displayPath })
  const exists = (displayPath: string): boolean => {
    if (tree[displayPath] !== undefined) return true
    const parent = displayPath.slice(0, displayPath.lastIndexOf('/'))
    const name = displayPath.slice(displayPath.lastIndexOf('/') + 1)
    return (tree[parent] ?? []).includes(name)
  }
  const resolve = async (path: string, options?: { readonly cwd?: string }): Promise<FsTarget> => {
    const absolute = path.startsWith('/') ? path : `${options?.cwd ?? '.'}/${path}`
    return target(links[absolute] ?? absolute)
  }
  const fs = {
    resolve,
    contains: (parent: FsTarget, child: FsTarget) =>
      child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`),
    stat: async (entry: FsTarget): Promise<FsInfo | undefined> => {
      if (!exists(entry.displayPath)) return undefined
      return {
        version: `v-${entry.displayPath}` as FsInfo['version'],
        type: tree[entry.displayPath] !== undefined ? 'directory' : 'file',
        size: 10,
      }
    },
    listDir: async (entry: FsTarget): Promise<FsDirEntry[]> => {
      const names = tree[entry.displayPath] ?? []
      return Promise.all(names.map(async (name) => {
        const displayPath = `${entry.displayPath}/${name}`
        const child = await resolve(name, { cwd: entry.displayPath })
        const observed = versioned.has(displayPath) ? { version: `v-${displayPath}`, size: 10 } as const : {}
        return { name, type: tree[displayPath] !== undefined ? 'directory' : 'file', target: child, ...observed } as FsDirEntry
      }))
    },
  } as unknown as FileSystem
  return { agent: {}, sandboxPolicy: {}, cwd: '/ws', root: target('/ws'), fs } as unknown as ListingRealm
}

function chapters(count: number, width = 4): string[] {
  return Array.from({ length: count }, (_, index) => `第${String(index + 1).padStart(width, '0')}章.md`)
}

/** Every file display path of a `memoryRealm` tree, for versioned listings. */
function allFiles(tree: Readonly<Record<string, readonly string[]>>): Set<string> {
  const directories = new Set(Object.keys(tree))
  const files = new Set<string>()
  for (const [directory, names] of Object.entries(tree)) {
    for (const name of names) {
      const displayPath = `${directory}/${name}`
      if (!directories.has(displayPath)) files.add(displayPath)
    }
  }
  return files
}

describe('creative workspace listing', () => {
  it('omits symlink targets in another project or outside the workspace', async () => {
    const realm = memoryRealm({
      '/ws': ['书甲', '书乙'],
      '/ws/书甲': ['正文', '追踪'],
      '/ws/书甲/正文': ['own.md', 'foreign.md', 'outside.md'],
      '/ws/书甲/追踪': [],
      '/ws/书乙': ['正文', '追踪'],
      '/ws/书乙/正文': ['secret.md'],
      '/ws/书乙/追踪': ['_tracking-state.json'],
    }, new Set(), {
      '/ws/书甲/正文/foreign.md': '/ws/书乙/正文/secret.md',
      '/ws/书甲/正文/outside.md': '/outside/secret.md',
      '/ws/书甲/追踪': '/ws/书乙/追踪',
    })
    expect((await listFiles(realm)).files.map(file => file.path).filter(path => path.startsWith('书甲/'))).toEqual(['书甲/正文/own.md'])
  })
  it('reads metadata from each full project root, including metadata outside the file page', async () => {
    const realm = memoryRealm({
      '/ws': ['书甲', '长篇'],
      '/ws/书甲': ['short-drama.json', '追踪', '剧集'],
      '/ws/书甲/追踪': ['_tracking-state.json'],
      '/ws/书甲/剧集': ['EP001'],
      '/ws/书甲/剧集/EP001': ['分镜.md'],
      '/ws/长篇': ['书乙'],
      '/ws/长篇/书乙': ['short-drama.json', '剧集'],
      '/ws/长篇/书乙/剧集': ['EP001'],
      '/ws/长篇/书乙/剧集/EP001': ['分镜.md'],
    })
    const reads: string[] = []
    realm.fs.readBytes = async (target) => {
      reads.push(target.displayPath)
      return new TextEncoder().encode(JSON.stringify({ project: target.displayPath.includes('/书甲/') ? '甲' : '乙' }))
    }
    const listing = await listFiles(realm)
    expect(listing.files.map(file => file.path)).toContain('长篇/书乙/short-drama.json')
    const withoutConfig = listing.files.filter(file => !file.path.endsWith('short-drama.json'))
    const projects = await workspaceProjects(realm, withoutConfig, 1_024)
    expect(projects.find(project => project.root === '书甲')).toMatchObject({ tracking: { project: '甲' }, shortDrama: { project: '甲' }, metadataErrors: [] })
    expect(projects.find(project => project.root === '长篇/书乙')).toMatchObject({ tracking: null, shortDrama: { project: '乙' }, metadataErrors: [] })
    expect(reads).not.toContain('/ws/short-drama.json')
  })

  it('collects editable and media files across creative roots and reports a complete listing', async () => {
    const realm = memoryRealm({
      '/ws': ['short-drama.json'],
      '/ws/正文': ['第001章.md', 'notes.log', '.hidden.md'],
      '/ws/剧集': ['EP001'],
      '/ws/剧集/EP001': ['剧本.md', 'poster.png'],
      '/ws/video-recaps': ['demo'],
      '/ws/video-recaps/demo': ['project.json', 'frames'],
      '/ws/video-recaps/demo/frames': ['frame.png'],
    })
    const listing = await listFiles(realm)
    expect(listing.truncated).toBe(false)
    expect(listing.files.map(file => file.path)).toEqual([
      '剧集/EP001/剧本.md',
      '剧集/EP001/poster.png',
      '正文/第001章.md',
      'short-drama.json',
      'video-recaps/demo/project.json',
    ])
    expect(listing.files.find(file => file.path === '剧集/EP001/poster.png')).toMatchObject({ kind: 'media', mimeType: 'image/png' })
  })

  it.each(['node_modules', '__pycache__', '.cache'])('prunes %s before dependencies can hide manuscripts or game deliverables', async (directory) => {
    const ignoredPath = `/ws/game-adaptations/demo/build/app/${directory}`
    const realm = memoryRealm({
      '/ws': ['game-adaptations', '正文'],
      '/ws/game-adaptations': ['demo'],
      '/ws/game-adaptations/demo': ['build', 'dist', 'qa'],
      '/ws/game-adaptations/demo/build': ['app'],
      '/ws/game-adaptations/demo/build/app': [directory, 'index.html', 'assets'],
      [ignoredPath]: Array.from({ length: 1_001 }, (_, index) => `dependency-${String(index)}.json`),
      '/ws/game-adaptations/demo/build/app/assets': ['scene.png', 'main.js'],
      '/ws/game-adaptations/demo/dist': ['index.html'],
      '/ws/game-adaptations/demo/qa': ['verification.json'],
      '/ws/正文': ['第001章.md'],
    })
    const listDir = vi.spyOn(realm.fs, 'listDir')
    const listing = await listFiles(realm)
    expect(listing.truncated).toBe(false)
    expect(listing.files.map(file => file.path).sort()).toEqual([
      'game-adaptations/demo/build/app/assets/main.js',
      'game-adaptations/demo/build/app/assets/scene.png',
      'game-adaptations/demo/build/app/index.html',
      'game-adaptations/demo/dist/index.html',
      'game-adaptations/demo/qa/verification.json',
      '正文/第001章.md',
    ].sort())
    expect(listDir.mock.calls.map(([target]) => target.displayPath)).not.toContain(ignoredPath)
  })

  it('prunes dependency directories during book discovery and nested chapter scans', async () => {
    const realm = memoryRealm({
      '/ws': ['node_modules', '__pycache__', '长篇'],
      '/ws/node_modules': ['正文'],
      '/ws/node_modules/正文': ['dependency.md'],
      '/ws/__pycache__': ['正文'],
      '/ws/__pycache__/正文': ['cache.md'],
      '/ws/长篇': ['node_modules', '灯下'],
      '/ws/长篇/node_modules': ['正文'],
      '/ws/长篇/node_modules/正文': ['dependency.md'],
      '/ws/长篇/灯下': ['正文'],
      '/ws/长篇/灯下/正文': ['第001章.md', '__pycache__'],
      '/ws/长篇/灯下/正文/__pycache__': ['cache.json'],
    })
    const listDir = vi.spyOn(realm.fs, 'listDir')
    const listing = await listFiles(realm)
    expect(listing.files.map(file => file.path)).toEqual(['长篇/灯下/正文/第001章.md'])
    for (const directory of [
      '/ws/node_modules', '/ws/__pycache__', '/ws/长篇/node_modules', '/ws/长篇/灯下/正文/__pycache__',
    ]) {
      expect(listDir.mock.calls.map(([target]) => target.displayPath)).not.toContain(directory)
    }
  })

  it('keeps a game preview ready without walking its installed dependencies', async () => {
    const dependencyPath = '/ws/game-adaptations/demo/build/app/node_modules'
    const realm = memoryRealm({
      '/ws/game-adaptations': ['demo'],
      '/ws/game-adaptations/demo': ['build'],
      '/ws/game-adaptations/demo/build': ['app'],
      '/ws/game-adaptations/demo/build/app': ['node_modules', '__pycache__', 'index.html'],
      [dependencyPath]: Array.from({ length: 5_001 }, (_, index) => `dependency-${String(index)}.json`),
      '/ws/game-adaptations/demo/build/app/__pycache__': ['cache.json'],
    })
    const listDir = vi.spyOn(realm.fs, 'listDir')
    const services = { fs: realm.fs, sandboxPolicy: realm.sandboxPolicy }
    const agent = { session: { header: { cwd: realm.cwd } }, ctx: { get: (key: keyof typeof services) => services[key] } }
    let handler: ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined
    const context = {
      effect: (effect: () => () => void) => { onTestFinished(effect()) },
      webServer: { register: (entry: { handler: NonNullable<typeof handler> }) => {
        handler = entry.handler
        return () => { handler = undefined }
      } },
      typert: { lookups: new Map([['agent', { resolve: async () => agent }]]) },
      logger: () => ({ error: vi.fn() }),
    } as unknown as Context
    registerWorkspaceRoute(context, { maxBytes: 1_024 })
    if (handler === undefined) throw new Error('workspace route is not registered')
    let status = 0
    let body: unknown
    await handler({
      method: 'GET', url: `/creative/workspace?sessionId=${randomUUID()}`, headers: { host: 'localhost:3000' },
    } as IncomingMessage, {
      writeHead: (value: number) => { status = value },
      end: (value: string) => { body = JSON.parse(value) as unknown },
    } as unknown as ServerResponse)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      truncated: false,
      games: expect.arrayContaining([expect.objectContaining({ root: 'game-adaptations/demo', previewReady: true })]),
    })
    const visited = listDir.mock.calls.map(([target]) => target.displayPath)
    expect(visited).not.toContain(dependencyPath)
    expect(visited).not.toContain('/ws/game-adaptations/demo/build/app/__pycache__')
  })

  it('does not count excluded video files as unseen content at the file limit', async () => {
    const realm = memoryRealm({
      '/ws/video-recaps': ['demo'],
      '/ws/video-recaps/demo': ['sources', 'frames', 'cache'],
      '/ws/video-recaps/demo/sources': [
        ...Array.from({ length: 1_000 }, (_, index) => `source-${String(index)}.mp4`),
        'notes.json',
      ],
      '/ws/video-recaps/demo/frames': ['frame.png'],
      '/ws/video-recaps/demo/cache': ['recap_run_manifest.json'],
    })
    const listing = await listFiles(realm)
    expect(listing.files).toHaveLength(1_000)
    expect(listing.truncated).toBe(false)
  })

  it('marks the listing truncated when an eligible file exists beyond the limit', async () => {
    const realm = memoryRealm({ '/ws/正文': [...chapters(1_001), '附录.md'] })
    const listing = await listFiles(realm)
    expect(listing.files).toHaveLength(1_000)
    expect(listing.truncated).toBe(true)
  })

  it('does not mark truncation when the workspace holds exactly the limit', async () => {
    const realm = memoryRealm({ '/ws/正文': chapters(1_000) })
    const listing = await listFiles(realm)
    expect(listing.files).toHaveLength(1_000)
    expect(listing.truncated).toBe(false)
  })

  it('discovers book directories holding long-form leaves', async () => {
    const tree = {
      '/ws': ['洪荒：开天余烬', 'notes'],
      '/ws/洪荒：开天余烬': ['大纲', '设定', '追踪'],
      '/ws/洪荒：开天余烬/大纲': ['大纲.md', '细纲_第001章.md'],
      '/ws/洪荒：开天余烬/设定': ['题材定位.md'],
      '/ws/洪荒：开天余烬/追踪': ['上下文.md'],
      '/ws/notes': ['草稿.md'],
    } as const
    const realm = memoryRealm(tree, allFiles(tree))
    const listing = await listFiles(realm)
    expect(listing.truncated).toBe(false)
    expect(listing.files.map(file => file.path)).toEqual([
      '洪荒：开天余烬/大纲/大纲.md',
      '洪荒：开天余烬/大纲/细纲_第001章.md',
      '洪荒：开天余烬/设定/题材定位.md',
      '洪荒：开天余烬/追踪/上下文.md',
    ])
  })

  it('discovers books below 长篇/短篇 containers and short-story single files', async () => {
    const tree = {
      '/ws': ['长篇', '短篇', '拆文库', '.git'],
      '/ws/.git': ['config'],
      '/ws/长篇': ['仙缘', 'notes.txt', '.draft'],
      '/ws/长篇/仙缘': ['正文', '大纲'],
      '/ws/长篇/仙缘/正文': ['第001章_开篇.md'],
      '/ws/长篇/仙缘/大纲': ['大纲.md'],
      '/ws/长篇/.draft': ['正文'],
      '/ws/长篇/.draft/正文': ['草稿.md'],
      '/ws/短篇': ['灯下'],
      '/ws/短篇/灯下': ['正文.md', '设定.md'],
      '/ws/拆文库': ['旧书'],
      '/ws/拆文库/旧书': ['拆文报告.md'],
    } as const
    const realm = memoryRealm(tree, allFiles(tree))
    const listing = await listFiles(realm)
    expect(listing.truncated).toBe(false)
    expect(listing.files.map(file => file.path)).toEqual([
      '拆文库/旧书/拆文报告.md',
      '短篇/灯下/设定.md',
      '短篇/灯下/正文.md',
      '长篇/仙缘/大纲/大纲.md',
      '长篇/仙缘/正文/第001章_开篇.md',
    ])
  })

  it.each([
    { documents: ['设定.md'] },
    { documents: ['小节大纲.md'] },
    { documents: ['正文.md'] },
    { documents: ['设定.md', '小节大纲.md'] },
  ])('discovers short stories containing only $documents', async ({ documents }) => {
    const realm = memoryRealm({
      '/ws': ['灯下', '短篇', 'notes'],
      '/ws/灯下': documents,
      '/ws/短篇': ['未完'],
      '/ws/短篇/未完': documents,
      '/ws/notes': ['草稿.md'],
    })
    const listing = await listFiles(realm)
    expect(listing.truncated).toBe(false)
    expect(listing.files.map(file => file.path).sort()).toEqual(documents.flatMap(name => [
      `灯下/${name}`, `短篇/未完/${name}`,
    ]).sort())
  })

  it('marks the listing truncated when a book holds files beyond the limit', async () => {
    const realm = memoryRealm({
      '/ws': ['大书'],
      '/ws/大书': ['正文'],
      '/ws/大书/正文': chapters(1_001),
    })
    const listing = await listFiles(realm)
    expect(listing.files).toHaveLength(1_000)
    expect(listing.truncated).toBe(true)
  })

  it('marks the listing truncated while collecting short-story single files', async () => {
    const realm = memoryRealm({
      '/ws': ['正文', '短篇'],
      '/ws/正文': chapters(999),
      '/ws/短篇': ['灯下'],
      '/ws/短篇/灯下': ['正文.md', '设定.md', '小节大纲.md'],
    })
    const listing = await listFiles(realm)
    expect(listing.files).toHaveLength(1_000)
    expect(listing.truncated).toBe(true)
    expect(listing.files.map(file => file.path)).toContain('短篇/灯下/正文.md')
    expect(listing.files.map(file => file.path)).not.toContain('短篇/灯下/小节大纲.md')
  })
})
