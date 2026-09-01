import { describe, expect, it } from 'vitest'
import type { ServerResponse, IncomingMessage } from 'node:http'
import { FsError, type FileSystem } from '@deepseek-ai/dsh-fs'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { novelRoutes } from '../src/routes.ts'
import { apply as nodeApply } from '../src/index.ts'

/** The memory backend from board.node.spec, reduced to the two reads the routes make. */
function memoryFs(files: Record<string, string>): FileSystem {
  const store = new Map(Object.entries(files))
  return {
    resolve: async (path: string) => ({ targetKey: `mem://${path}`, displayPath: path }),
    stat: async (target: { targetKey: string }) => {
      const path = target.targetKey.replace('mem://', '')
      if (store.has(path)) return { version: 'v1', type: 'file', size: 1 }
      // Directories are implicit: present when any seeded path lives below them.
      return [...store.keys()].some(key => key.startsWith(`${path}/`))
        ? { version: 'v1', type: 'directory', size: 0 }
        : undefined
    },
    readText: async (target: { targetKey: string }) => {
      const text = store.get(target.targetKey.replace('mem://', ''))
      if (text === undefined) throw Object.assign(new Error('FS_NOT_FOUND'), { name: 'FsError', code: 'FS_NOT_FOUND' })
      return text
    },
    listDir: async (target: { targetKey: string }) => {
      const prefix = `${target.targetKey.replace('mem://', '')}/`
      return [...store.keys()]
        .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map(key => ({ name: key.slice(prefix.length), type: 'file' as const, target: { targetKey: `mem://${key}`, displayPath: key } }))
    },
  } as unknown as FileSystem
}

interface SessionRow {
  header: { cwd?: string }
}

function memorySessions(rows: Record<string, SessionRow>): SessionStore {
  const byId = new Map(Object.entries(rows))
  return {
    get: (id: SessionId) => byId.get(String(id)),
  } as unknown as SessionStore
}

/** Invoke one route handler and capture the response it writes; `null` sends a request without a url. */
async function call(
  route: { handler: (req: IncomingMessage, res: ServerResponse) => unknown },
  query: string,
  method = 'GET',
  url?: string | null,
): Promise<{ status: number; body: string }> {
  let body = ''
  const res = {
    setHeader: () => {},
    statusCode: 0,
    end: (chunk: string) => { body = chunk },
  } as unknown as ServerResponse
  const req = { method, url: url === undefined ? `/novel/x${query}` : url } as unknown as IncomingMessage
  route.handler(req, res)
  await new Promise(resolve => setImmediate(resolve))
  return { status: res.statusCode, body }
}

const SERVICES = {
  fs: memoryFs({
    'outline.md': '# 大纲',
    'chapters/01-雪夜.md': '雪下了一夜。',
  }),
  sessions: memorySessions({
    'session-1': { header: { cwd: '/workspace' } },
    'session-bare': { header: {} },
  }),
}

function routeOf(path: string): { handler: (req: IncomingMessage, res: ServerResponse) => unknown } {
  const route = novelRoutes(SERVICES).find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} missing`)
  return route
}

describe('novel routes', () => {
  it('serves the overview of the session workspace', async () => {
    const { status, body } = await call(routeOf('/novel/overview'), '?sessionId=session-1')
    expect(status).toBe(200)
    const value = JSON.parse(body) as { project: { exists: boolean }; summary: { chapterCount: number } }
    expect(value.project.exists).toBe(true)
    expect(value.summary.chapterCount).toBe(1)
  })

  it('rejects missing, unknown, and workspace-less sessions on both routes', async () => {
    const overview = routeOf('/novel/overview')
    expect((await call(overview, '')).status).toBe(400)
    expect((await call(overview, '?sessionId=ghost')).status).toBe(404)
    expect((await call(overview, '?sessionId=session-bare')).status).toBe(404)
    const document = routeOf('/novel/document')
    expect((await call(document, '?sessionId=ghost&file=outline.md')).status).toBe(404)
    expect((await call(document, '?sessionId=session-bare&file=outline.md')).status).toBe(404)
  })

  it('rejects non-GET requests', async () => {
    expect((await call(routeOf('/novel/overview'), '?sessionId=session-1', 'POST')).status).toBe(405)
    expect((await call(routeOf('/novel/document'), '?sessionId=session-1', 'PUT')).status).toBe(405)
  })

  it('serves one document from the session workspace', async () => {
    const { status, body } = await call(routeOf('/novel/document'), '?sessionId=session-1&file=chapters%2F01-%E9%9B%AA%E5%A4%9C.md')
    expect(status).toBe(200)
    expect(JSON.parse(body)).toEqual({ file: 'chapters/01-雪夜.md', text: '雪下了一夜。', truncated: false })
  })

  it('answers 404 for absent documents and 400 for unservable paths', async () => {
    const document = routeOf('/novel/document')
    expect((await call(document, '?sessionId=session-1&file=ghost.md')).status).toBe(404)
    expect((await call(document, '?sessionId=session-1&file=..%2Fx.md')).status).toBe(400)
    expect((await call(document, '?sessionId=session-1&file=chapters')).status).toBe(400)
  })

  it('answers 400 when the document parameter is missing', async () => {
    expect((await call(routeOf('/novel/document'), '?sessionId=session-1')).status).toBe(400)
  })

  it('treats a request without a url as the root path', async () => {
    expect((await call(routeOf('/novel/overview'), '', 'GET', null)).status).toBe(400)
    expect((await call(routeOf('/novel/document'), '', 'GET', null)).status).toBe(400)
  })

  it('answers 500 when the backend fails', async () => {
    const failing = novelRoutes({ ...SERVICES, fs: {
      resolve: async () => { throw new Error('backend down') },
    } as unknown as FileSystem, sessions: SERVICES.sessions })
    const { status } = await call(failing[0]!, '?sessionId=session-1')
    expect(status).toBe(500)
    // The document handler has its own catch arm: one backend failure per route.
    const documentDown = await call(failing[1]!, '?sessionId=session-1&file=outline.md')
    expect(documentDown.status).toBe(500)
  })

  it('answers 500 when the backend throws a non-Error value', async () => {
    const failing = novelRoutes({ ...SERVICES, fs: {
      resolve: async () => { throw 'backend exploded' },
    } as unknown as FileSystem, sessions: SERVICES.sessions })
    const result = await call(failing[0]!, '?sessionId=session-1')
    expect(result.status).toBe(500)
    expect(JSON.parse(result.body)).toEqual({ error: 'internal error' })
  })

  it('answers 404 when the backend reports a missing workspace file', async () => {
    const failing = novelRoutes({ ...SERVICES, fs: {
      resolve: async () => { throw new FsError('gone', 'FS_NOT_FOUND') },
    } as unknown as FileSystem, sessions: SERVICES.sessions })
    const result = await call(failing[0]!, '?sessionId=session-1')
    expect(result.status).toBe(404)
    expect(JSON.parse(result.body)).toEqual({ error: 'workspace file not found' })
    // The document handler maps the same backend error to 404 on its own catch.
    const documentGone = await call(failing[1]!, '?sessionId=session-1&file=outline.md')
    expect(documentGone.status).toBe(404)
    expect(JSON.parse(documentGone.body)).toEqual({ error: 'workspace file not found' })
  })
})

describe('node-half apply', () => {
  it('registers both routes through an effect and disposes them with it', () => {
    const registered: string[] = []
    const disposed: string[] = []
    const ctx = {
      fs: SERVICES.fs,
      sessions: SERVICES.sessions,
      get: (name: string) => name === 'webServer' ? {
        register: (route: { path: string }) => {
          registered.push(route.path)
          return () => { disposed.push(route.path) }
        },
      } : undefined,
      effect: (cb: () => () => void, _label: string) => cb(),
    }
    nodeApply(ctx as never)
    expect(registered).toEqual(['/novel/overview', '/novel/document'])
    expect(disposed).toEqual([])
    // The effect body returned the combined disposer; unwinding removes both.
    ctx.effect = (cb: () => () => void) => {
      const dispose = cb()
      dispose()
      return dispose
    }
    nodeApply(ctx as never)
    expect(disposed).toEqual(['/novel/overview', '/novel/document'])
  })

  it('mounts as a no-op without a webserver (transport-less deployments)', () => {
    let effects = 0
    const ctx = {
      fs: SERVICES.fs,
      sessions: SERVICES.sessions,
      get: () => undefined,
      effect: (cb: () => () => void, _label: string) => { effects += 1; return cb() },
    }
    nodeApply(ctx as never)
    expect(effects).toBe(0)
  })
})
