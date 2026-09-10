import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, FsTargetKey, FsVersion, type FileSystem, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { registerWorkspaceRoute } from '../src/workspace-route.ts'

const mediaPath = '交付/EP001/final.mp4'
const mediaMaxBytes = 256 * 1_024 * 1_024

async function hostWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-creative-media-'))
  onTestFinished(async () => { await rm(directory, { recursive: true, force: true }) })
  return realpath(directory)
}

function fixture(
  cwd = resolve('virtual-creative-workspace'),
  content: Readonly<Record<string, string>> = { [mediaPath]: 'PEER' },
  links: Readonly<Record<string, string>> = {},
) {
  const files = new Map(Object.entries(content).map(([path, value]) => [resolve(cwd, path), Buffer.from(value)]))
  const fs = {
    resolve: async (path: string, options?: { readonly cwd?: string }): Promise<FsTarget> => {
      const requested = resolve(options?.cwd ?? cwd, path)
      const resolved = resolve(cwd, links[relative(cwd, requested).split(sep).join('/')] ?? requested)
      return { targetKey: FsTargetKey(`peer:${resolved}`), displayPath: resolved }
    },
    contains: (parent: FsTarget, child: FsTarget): boolean => {
      const path = relative(parent.displayPath, child.displayPath)
      return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
    },
    processPath: (target: FsTarget): string => target.displayPath,
    processPathFromHostPath: vi.fn<FileSystem['processPathFromHostPath']>(() => undefined),
    stat: vi.fn(async (target: FsTarget): Promise<FsInfo | undefined> => {
      const bytes = files.get(target.displayPath)
      return bytes === undefined ? undefined : { type: 'file', size: bytes.byteLength, version: FsVersion('peer-version') }
    }),
    readBytes: vi.fn(async (target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> => {
      const bytes = files.get(target.displayPath)
      if (bytes === undefined) throw new FsError('missing media', 'FS_NOT_FOUND')
      if (bytes.byteLength > maxBytes) throw new FsError('media exceeds limit', 'FS_TOO_LARGE')
      return bytes
    }),
  } satisfies Pick<FileSystem, 'resolve' | 'contains' | 'processPath' | 'processPathFromHostPath' | 'stat' | 'readBytes'>
  const services = { fs, sandboxPolicy: {} }
  const agent = { session: { id: 'media-session', header: { cwd } }, ctx: { get: (key: keyof typeof services) => services[key] } }
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
  const requestMedia = async (path = mediaPath, options: { readonly method?: string; readonly range?: string } = {}) => {
    if (handler === undefined) throw new Error('workspace route is not registered')
    const request = Object.assign(Readable.from([]), {
      method: options.method ?? 'GET',
      url: `/creative/media?${new URLSearchParams({ sessionId: 'media-session', path }).toString()}`,
      headers: { host: 'localhost:3000', ...(options.range === undefined ? {} : { range: options.range }) },
    }) as IncomingMessage
    const chunks: Buffer[] = []
    const streams: Readable[] = []
    let status = 0
    let headers: OutgoingHttpHeaders = {}
    const response = Object.assign(new Writable({
      write: (chunk: Uint8Array, _encoding, callback) => { chunks.push(Buffer.from(chunk)); callback() },
    }), {
      headersSent: false,
      writeHead: (value: number, fields: OutgoingHttpHeaders): void => {
        status = value
        headers = fields
        response.headersSent = true
      },
    })
    response.on('pipe', (source: Readable) => { streams.push(source) })
    try {
      await Promise.all([finished(response, { cleanup: true }), handler(request, response as unknown as ServerResponse)])
      await Promise.all(streams.map(source => finished(source, { cleanup: true })))
      return { status, headers, body: Buffer.concat(chunks).toString('utf8') }
    } finally {
      request.destroy()
      response.destroy()
      for (const source of streams) source.destroy()
      await Promise.allSettled(streams.map(source => finished(source, { cleanup: true })))
    }
  }
  return { fs, requestMedia }
}

describe('workspace media HTTP handler', () => {
  it.each(['unmapped', 'different-file', 'root-only', 'file-only'])('uses remote bytes when a host collision is %s', async (mapping) => {
    const cwd = await hostWorkspace()
    await mkdir(join(cwd, '交付/EP001'), { recursive: true })
    await writeFile(join(cwd, mediaPath), 'HOST')
    const { fs, requestMedia } = fixture(cwd)
    if (mapping === 'different-file') fs.processPathFromHostPath.mockImplementation(path => `${path}.different`)
    if (mapping === 'root-only') fs.processPathFromHostPath.mockImplementation(path => path === cwd ? path : undefined)
    if (mapping === 'file-only') fs.processPathFromHostPath.mockImplementation(path => path === join(cwd, mediaPath) ? path : undefined)
    const response = await requestMedia()
    expect(response).toMatchObject({ status: 200, body: 'PEER', headers: { 'content-type': 'video/mp4', 'content-length': 4 } })
    expect(fs.readBytes).toHaveBeenCalledExactlyOnceWith(await fs.resolve(mediaPath), undefined, mediaMaxBytes)
  })

  it.each([
    { range: 'bytes=1-2', status: 206, body: 'EE', length: 2, contentRange: 'bytes 1-2/4' },
    { range: 'bytes=-2', status: 206, body: 'ER', length: 2, contentRange: 'bytes 2-3/4' },
    { range: 'bytes=0-100', status: 206, body: 'PEER', length: 4, contentRange: 'bytes 0-3/4' },
    { range: 'bytes=4-', status: 416, body: '', length: undefined, contentRange: 'bytes */4' },
    { range: 'bytes=0-1,3-3', status: 200, body: 'PEER', length: 4, contentRange: undefined },
  ])('serves remote range $range with status $status', async ({ range, status, body, length, contentRange }) => {
    const { requestMedia } = fixture()
    const response = await requestMedia(mediaPath, { range })
    expect(response).toMatchObject({ status, body })
    expect(response.headers['content-length']).toBe(length)
    expect(response.headers['content-range']).toBe(contentRange)
  })

  it('returns remote HEAD metadata without a response body', async () => {
    const { requestMedia } = fixture()
    expect(await requestMedia(mediaPath, { method: 'HEAD', range: 'bytes=1-2' })).toMatchObject({
      status: 206, body: '', headers: { 'content-length': 2, 'content-range': 'bytes 1-2/4', 'accept-ranges': 'bytes' },
    })
  })

  it.each([
    { method: 'GET', range: undefined, status: 200, body: 'HOST', length: 4 },
    { method: 'GET', range: 'bytes=1-2', status: 206, body: 'OS', length: 2 },
    { method: 'HEAD', range: 'bytes=1-2', status: 206, body: '', length: 2 },
    { method: 'GET', range: 'bytes=4-', status: 416, body: '', length: undefined },
  ])('keeps explicit host-backed $method media streaming for $range', async ({ method, range, status, body, length }) => {
    const cwd = await hostWorkspace()
    await mkdir(join(cwd, '交付/EP001'), { recursive: true })
    await writeFile(join(cwd, mediaPath), 'HOST')
    const { fs, requestMedia } = fixture(cwd, { [mediaPath]: 'HOST' })
    fs.processPathFromHostPath.mockImplementation(path => resolve(path))
    const response = await requestMedia(mediaPath, { method, ...(range === undefined ? {} : { range }) })
    expect(response).toMatchObject({ status, body })
    expect(response.headers['content-length']).toBe(length)
    expect(fs.readBytes).not.toHaveBeenCalled()
  })

  it('rejects known oversized remote media before buffering', async () => {
    const { fs, requestMedia } = fixture()
    fs.stat.mockResolvedValue({ type: 'file', size: mediaMaxBytes + 1, version: FsVersion('large') })
    expect((await requestMedia()).status).toBe(413)
    expect(fs.readBytes).not.toHaveBeenCalled()
  })

  it('keeps the provider byte bound when file size is unavailable', async () => {
    const { fs, requestMedia } = fixture()
    fs.stat.mockResolvedValue({ type: 'file', version: FsVersion('unknown-size') })
    fs.readBytes.mockRejectedValue(new FsError('media exceeds limit', 'FS_TOO_LARGE'))
    expect((await requestMedia()).status).toBe(413)
    expect(fs.readBytes).toHaveBeenCalledExactlyOnceWith(await fs.resolve(mediaPath), undefined, mediaMaxBytes)
  })

  it.each([
    { path: 'private/output.mp4', status: 403 },
    { path: '交付/EP001/../output.mp4', status: 403 },
    { path: '交付/EP001/script.md', status: 415 },
  ])('rejects disallowed media path $path before reading', async ({ path, status }) => {
    const { fs, requestMedia } = fixture()
    expect((await requestMedia(path)).status).toBe(status)
    expect(fs.readBytes).not.toHaveBeenCalled()
  })

  it.each([
    { target: '乙/交付/EP001/final.mp4', status: 403 },
    { target: '../outside/final.mp4', status: 403 },
    { target: '甲/交付/EP001/source.mp4', status: 200 },
  ])('checks the canonical project of a symlink to $target', async ({ target, status }) => {
    const path = '甲/交付/EP001/final.mp4'
    const { fs, requestMedia } = fixture(undefined, { [target]: 'PEER' }, { [path]: target })
    const response = await requestMedia(path)
    expect(response.status).toBe(status)
    if (status === 200) {
      expect(response.body).toBe('PEER')
      expect(fs.readBytes).toHaveBeenCalledExactlyOnceWith(await fs.resolve(target), undefined, mediaMaxBytes)
    } else {
      expect(fs.readBytes).not.toHaveBeenCalled()
    }
  })
})
