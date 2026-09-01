/**
 * Game studio workspace HTTP API.
 * @module @deepseek-ai/dsh-host-game-studio/workspace-route
 */

import { createHash } from 'node:crypto'
import { readFile as readNodeFile, stat as nodeStat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, type FileSystem, type FsInfo, type FsTarget, type FsVersion } from '@deepseek-ai/dsh-fs'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session, SessionStore } from '@deepseek-ai/dsh-session'
import { defaultNovelToGameSkillRoot } from './skill-provider.js'
import { WorkspaceVerificationTracker } from './verification-tracker.js'

const GAME_DIRECTORY = 'game-adaptations'
const EDITABLE_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.jsonl', '.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
])
const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.m4a', 'audio/mp4'],
])
const MEDIA_MAX_BYTES = 256 * 1024 * 1024
const FILE_LIMIT = 1_000
const PREVIEW_FILE_LIMIT = 32 * 1024 * 1024
const BUNDLED_GAME_EXAMPLE = 'jin-ping-mei'

const verificationTracker = new WorkspaceVerificationTracker()

interface WorkspaceFile {
  readonly path: string
  readonly bytes: number
  readonly version: string
  readonly kind: 'text' | 'media'
  readonly mimeType?: string | undefined
}

export interface GameVerificationSummary {
  readonly status: 'NOT_RUN' | 'FAIL' | 'PASS'
  readonly checks: Readonly<Record<string, 'NOT_RUN' | 'FAIL' | 'PASS'>>
  readonly runId?: string | undefined
  readonly limitations: readonly { readonly scope: string; readonly reason: string }[]
  readonly binding: import('./verification-tracker.js').GameVerificationBinding
  readonly verifiedPreviewVersion?: string | undefined
}

export interface GameProjectSummary {
  readonly id: string
  readonly root: string
  readonly title: string
  readonly source: 'workspace' | 'example'
  readonly previewReady: boolean
  readonly previewUrl?: string | undefined
  readonly previewVersion: string
  readonly verification: GameVerificationSummary
}

export interface WorkspacePayload {
  readonly cwd: string
  readonly files: readonly WorkspaceFile[]
  readonly games: readonly GameProjectSummary[]
  readonly mode: 'dsh-session'
}

interface ReadFileResult {
  readonly content: string
  readonly bytes: number
  readonly version: string
}

class WorkspaceHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

interface WorkspaceContext {
  readonly fs: FileSystem
  readonly sandboxPolicy: SandboxPolicyService
  readonly cwd: string
  readonly root: FsTarget
  readonly session: Session
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

function sendMedia(request: IncomingMessage, response: ServerResponse, bytes: Uint8Array, mimeType: string): void {
  const range = request.headers.range
  let start = 0
  let end = bytes.byteLength - 1
  let status = 200
  if (typeof range === 'string') {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range.trim())
    if (match !== null) {
      const requestedStart = match[1] === '' ? 0 : Number(match[1])
      const requestedEnd = match[2] === '' ? end : Number(match[2])
      const rangeValid = Number.isSafeInteger(requestedStart)
        && Number.isSafeInteger(requestedEnd)
        && requestedStart >= 0
        && requestedStart <= requestedEnd
        && requestedStart < bytes.byteLength
      if (rangeValid) {
        start = requestedStart
        end = Math.min(requestedEnd, end)
        status = 206
      }
    }
  }
  const body = bytes.subarray(start, end + 1)
  response.writeHead(status, {
    'content-type': mimeType,
    'content-length': body.byteLength,
    'cache-control': 'private, max-age=60',
    'accept-ranges': 'bytes',
    ...(status === 206 ? { 'content-range': `bytes ${String(start)}-${String(end)}/${String(bytes.byteLength)}` } : {}),
    'x-content-type-options': 'nosniff',
  })
  response.end(Buffer.from(body))
}

async function jsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const value = Buffer.from(chunk)
    size += value.byteLength
    if (size > maxBytes) throw new WorkspaceHttpError(413, '请求内容过大。')
    chunks.push(value)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new WorkspaceHttpError(400, '请求必须是 JSON 对象。')
  }
}

function safeRelativePath(path: string): boolean {
  return path !== ''
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
}

function assertGamePath(path: string, kind: 'text' | 'media'): void {
  if (!path.startsWith(`${GAME_DIRECTORY}/`)) {
    throw new WorkspaceHttpError(403, '文件路径不在游戏创作工作台中。')
  }
  if (kind === 'text') {
    if (!EDITABLE_EXTENSIONS.has(extname(path).toLocaleLowerCase())) {
      throw new WorkspaceHttpError(415, '工作台不支持编辑该文件类型。')
    }
  } else {
    if (!MEDIA_TYPES.has(extname(path).toLocaleLowerCase())) {
      throw new WorkspaceHttpError(415, '目标不是受支持的媒体文件。')
    }
  }
  if (!safeRelativePath(path)) {
    throw new WorkspaceHttpError(403, '文件路径不合法。')
  }
}

function requireRegularFile(info: FsInfo | undefined): FsInfo {
  if (info === undefined) throw new WorkspaceHttpError(404, '文件不存在。')
  if (info.type !== 'file') throw new WorkspaceHttpError(415, '目标不是可编辑的普通文件。')
  return info
}

async function readVersionedText(fs: FileSystem, target: FsTarget, maxBytes: number): Promise<ReadFileResult> {
  const before = requireRegularFile(await fs.stat(target))
  if (before.size !== undefined && before.size > maxBytes) throw new WorkspaceHttpError(413, '文件超过工作台大小限制。')
  const content = await fs.readText(target)
  const after = requireRegularFile(await fs.stat(target))
  if (before.version !== after.version) throw new WorkspaceHttpError(409, '文件正在被修改，请重试。')
  return { content, bytes: Buffer.byteLength(content), version: after.version }
}

export function gameRoot(path: string): boolean {
  const parts = path.split('/')
  const name = parts[1]
  return parts.length === 2 && parts[0] === GAME_DIRECTORY && name !== undefined
    && name !== '' && name !== '.' && name !== '..' && name.length <= 128
    && !name.startsWith('.') && !name.includes('\\')
}

function mapFsError(error: unknown): WorkspaceHttpError | undefined {
  if (!(error instanceof FsError)) return undefined
  switch (error.code) {
    case 'FS_NOT_FOUND': return new WorkspaceHttpError(404, '文件不存在。')
    case 'FS_TOO_LARGE': return new WorkspaceHttpError(413, '文件超过工作台大小限制。')
    case 'FS_NOT_TEXT':
    case 'FS_NOT_REGULAR_FILE': return new WorkspaceHttpError(415, '目标不是可编辑的文本文件。')
    case 'FS_PERMISSION_DENIED':
    case 'FS_SANDBOX_DENIED': return new WorkspaceHttpError(403, '当前 DSH 权限不允许修改该文件。')
    case 'FS_STALE_VERSION':
    case 'FS_NOT_OBSERVED': return new WorkspaceHttpError(412, '文件已在磁盘上更新。请处理冲突后再保存。')
    case 'FS_ABORTED': return new WorkspaceHttpError(409, '文件操作已取消。')
    default: return new WorkspaceHttpError(500, 'DSH 文件系统操作失败。')
  }
}

async function workspaceContext(context: Context, rawId: string): Promise<WorkspaceContext> {
  if (rawId === '') throw new WorkspaceHttpError(400, '缺少 DSH sessionId。')
  const sessionStore = context.sessions as SessionStore
  const session = sessionStore.get(rawId as import('@deepseek-ai/dsh-session').SessionId)
  if (session === undefined) throw new WorkspaceHttpError(404, 'DSH 会话不可用。')
  const cwd = session.header.cwd
  if (cwd === undefined) throw new WorkspaceHttpError(409, '当前 DSH 会话没有工作目录。')
  const fs = context.fs as FileSystem
  const sandboxPolicy = context.sandboxPolicy as SandboxPolicyService
  const root = await fs.resolve(cwd)
  return { fs, sandboxPolicy, cwd, root, session }
}

async function assertWritablePath(context: WorkspaceContext, path: string, kind: 'text' | 'media' = 'text'): Promise<FsTarget> {
  assertGamePath(path, kind)
  const target = await context.fs.resolve(path, { cwd: context.cwd })
  if (!context.fs.contains(context.root, target)) throw new WorkspaceHttpError(403, '文件路径离开了 DSH 工作目录。')
  return target
}

async function listFiles(context: WorkspaceContext): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = []
  const target = await context.fs.resolve(GAME_DIRECTORY, { cwd: context.cwd })
  if (!context.fs.contains(context.root, target)) return files
  const info = await context.fs.stat(target)
  if (info?.type !== 'directory') return files
  const walk = async (path: string, directory: FsTarget): Promise<void> => {
    for (const entry of await context.fs.listDir(directory)) {
      if (entry.name.startsWith('.') || !context.fs.contains(context.root, entry.target)) continue
      const childPath = `${path}/${entry.name}`
      if (entry.type === 'directory') await walk(childPath, entry.target)
      else if (entry.type === 'file') {
        const isText = EDITABLE_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())
        const isMedia = MEDIA_TYPES.has(extname(entry.name).toLocaleLowerCase())
        if (!isText && !isMedia) continue
        const statInfo = entry.version === undefined || entry.size === undefined ? await context.fs.stat(entry.target) : undefined
        const version = entry.version ?? statInfo?.version
        const mimeType = isMedia ? MEDIA_TYPES.get(extname(entry.name).toLocaleLowerCase()) : undefined
        if (version !== undefined) {
          files.push({ path: childPath, bytes: entry.size ?? statInfo?.size ?? 0, version, kind: isText ? 'text' : 'media', mimeType })
        }
      }
      if (files.length >= FILE_LIMIT) return
    }
  }
  await walk(GAME_DIRECTORY, target)
  return files.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'))
}

function headingTitle(content: string | undefined, fallback: string): string {
  const heading = content?.split(/\r?\n/u).find(line => /^#\s+/u.test(line))
  return heading?.replace(/^#\s+/u, '').replace(/^PRODUCT_BRIEF\s*[·・:]?\s*/iu, '').trim() || fallback
}

function token(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function untoken(value: string): string {
  try { return Buffer.from(value, 'base64url').toString('utf8') }
  catch { throw new WorkspaceHttpError(400, '游戏预览标识无效。') }
}

async function previewDigest(
  fs: FileSystem,
  root: FsTarget,
  projectRoot: string,
  cwd: string,
): Promise<{ readonly ready: boolean; readonly version: string }> {
  const appPath = `${projectRoot}/build/app`
  const app = await fs.resolve(appPath, { cwd })
  if (!fs.contains(root, app)) return { ready: false, version: 'missing' }
  const info = await fs.stat(app)
  if (info?.type !== 'directory') return { ready: false, version: 'missing' }
  const entries: string[] = []
  let ready = false
  const visit = async (directory: FsTarget, path: string): Promise<void> => {
    for (const entry of await fs.listDir(directory)) {
      if (entry.name.startsWith('.') || !fs.contains(app, entry.target)) continue
      const childPath = path === '' ? entry.name : `${path}/${entry.name}`
      if (entry.type === 'directory') await visit(entry.target, childPath)
      else if (entry.type === 'file') {
        const meta = entry.version === undefined ? await fs.stat(entry.target) : undefined
        const version = entry.version ?? meta?.version
        if (version !== undefined) entries.push(`${childPath}\0${version}`)
        if (childPath === 'index.html') ready = true
      }
      if (entries.length >= 5_000) return
    }
  }
  await visit(app, '')
  return { ready, version: createHash('sha256').update(entries.sort().join('\n')).digest('hex').slice(0, 16) }
}

function normalizedVerification(value: unknown, binding: import('./verification-tracker.js').GameVerificationBinding, verifiedPreviewVersion?: string): GameVerificationSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'NOT_RUN', checks: {}, limitations: [], binding }
  }
  const record = value as Record<string, unknown>
  const status = record.status === 'PASS' || record.status === 'FAIL' ? record.status : 'NOT_RUN'
  const rawChecks = typeof record.checks === 'object' && record.checks !== null && !Array.isArray(record.checks)
    ? record.checks as Record<string, unknown>
    : {}
  const checks: Record<string, 'NOT_RUN' | 'FAIL' | 'PASS'> = {}
  for (const name of ['launch', 'render', 'input', 'coreLoop', 'outcome', 'restart']) {
    const check = rawChecks[name]
    checks[name] = check === 'PASS' || check === 'FAIL' ? check : 'NOT_RUN'
  }
  const completeRun = typeof record.completeRun === 'object' && record.completeRun !== null && !Array.isArray(record.completeRun)
    ? record.completeRun as Record<string, unknown>
    : {}
  const limitations = Array.isArray(record.limitations) ? record.limitations.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    return typeof item.scope === 'string' && typeof item.reason === 'string'
      ? [{ scope: item.scope, reason: item.reason }]
      : []
  }) : []
  return {
    status,
    checks,
    runId: typeof completeRun.id === 'string' ? completeRun.id : undefined,
    limitations,
    binding,
    verifiedPreviewVersion,
  }
}

async function workspaceGameProjects(
  context: WorkspaceContext,
  files: readonly WorkspaceFile[],
  sessionId: string,
): Promise<GameProjectSummary[]> {
  const roots = [...new Set(files.flatMap((file) => {
    const parts = file.path.split('/')
    return parts[0] === GAME_DIRECTORY && parts[1] !== undefined ? [`${GAME_DIRECTORY}/${parts[1]}`] : []
  }))].filter(gameRoot).sort()
  return Promise.all(roots.map(async (root) => {
    const id = root.slice(`${GAME_DIRECTORY}/`.length)
    const qaPath = `${root}/qa/verification.json`
    const qaFile = files.find(file => file.path === qaPath)
    const [brief, qa, preview] = await Promise.all([
      readTextSafe(context, `${root}/PRODUCT_BRIEF.md`),
      readTextSafe(context, qaPath),
      previewDigest(context.fs, context.root, root, context.cwd).catch(() => ({ ready: false, version: 'unavailable' })),
    ])
    let verification: unknown
    try { verification = qa === undefined ? undefined : JSON.parse(qa) as unknown }
    catch { verification = undefined }
    const freshness = verificationTracker.observe(`${sessionId}\0${root}`, qaFile?.version, preview.version)
    return {
      id: `workspace:${id}`,
      root,
      title: headingTitle(brief, id),
      source: 'workspace' as const,
      previewReady: preview.ready,
      previewUrl: preview.ready
        ? `/game-studio/preview/workspace/${token(sessionId)}/${token(root)}/index.html`
        : undefined,
      previewVersion: preview.version,
      verification: normalizedVerification(verification, freshness.binding, freshness.verifiedPreviewVersion),
    }
  }))
}

async function readTextSafe(context: WorkspaceContext, path: string): Promise<string | undefined> {
  try {
    const target = await assertWritablePath(context, path, 'text')
    const result = await readVersionedText(context.fs, target, Number.MAX_SAFE_INTEGER)
    return result.content
  } catch {
    return undefined
  }
}

async function bundledGameExample(): Promise<GameProjectSummary> {
  const root = resolve(defaultNovelToGameSkillRoot(), `../examples/${BUNDLED_GAME_EXAMPLE}`)
  const [example, verification, manifest] = await Promise.all([
    readNodeFile(resolve(root, 'example.json'), 'utf8'),
    readNodeFile(resolve(root, 'qa/verification.json'), 'utf8'),
    readNodeFile(resolve(defaultNovelToGameSkillRoot(), '../manifest.json'), 'utf8'),
  ] as const)
  const exampleJson = JSON.parse(example) as { readonly title?: unknown }
  const manifestJson = JSON.parse(manifest) as { readonly upstream?: { readonly commit?: unknown } }
  const previewVersion = typeof manifestJson.upstream?.commit === 'string' ? manifestJson.upstream.commit.slice(0, 16) : 'bundled'
  return {
    id: `example:${BUNDLED_GAME_EXAMPLE}`,
    root: `examples/${BUNDLED_GAME_EXAMPLE}`,
    title: typeof exampleJson.title === 'string' ? exampleJson.title : '示例游戏项目',
    source: 'example',
    previewReady: true,
    previewUrl: `/game-studio/preview/example/${BUNDLED_GAME_EXAMPLE}/index.html`,
    previewVersion,
    verification: normalizedVerification(JSON.parse(verification) as unknown, 'PINNED', previewVersion),
  }
}

function previewContentType(path: string): string {
  switch (extname(path).toLocaleLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    case '.wasm': return 'application/wasm'
    case '.mp3': return 'audio/mpeg'
    case '.ogg': return 'audio/ogg'
    default: return 'application/octet-stream'
  }
}

function previewAssetSources(request: IncomingMessage): string {
  const authority = request.headers.host
  if (authority === undefined) return "'none'"
  const prefix = `${authority}/game-studio/preview/`
  return `http://${prefix} https://${prefix}`
}

export function previewContentSecurityPolicy(assets: string): string {
  return [
    'sandbox allow-scripts allow-forms allow-modals allow-downloads allow-same-origin',
    "default-src 'none'",
    `script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: ${assets}`,
    `style-src 'unsafe-inline' ${assets}`,
    `img-src data: blob: ${assets}`,
    `media-src data: blob: ${assets}`,
    `font-src data: ${assets}`,
    `connect-src ${assets}`,
    `worker-src blob: ${assets}`,
    `manifest-src ${assets}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
  ].join('; ')
}

function sendPreview(request: IncomingMessage, response: ServerResponse, path: string, bytes: Uint8Array): void {
  const assets = previewAssetSources(request)
  response.writeHead(200, {
    'content-type': previewContentType(path),
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'cross-origin',
    'access-control-allow-origin': '*',
    'content-security-policy': previewContentSecurityPolicy(assets),
  })
  response.end(bytes)
}

async function previewBytes(context: Context, pathname: string): Promise<{ readonly path: string; readonly bytes: Uint8Array }> {
  let segments: string[]
  try {
    segments = pathname.split('/').slice(3).map(segment => decodeURIComponent(segment))
  } catch {
    throw new WorkspaceHttpError(400, '游戏预览地址无效。')
  }
  const kind = segments.shift()
  if (kind === 'example') {
    const id = segments.shift()
    const path = segments.join('/') || 'index.html'
    if (id !== BUNDLED_GAME_EXAMPLE || !safeRelativePath(path)) throw new WorkspaceHttpError(404, '游戏示例不存在。')
    const appRoot = resolve(defaultNovelToGameSkillRoot(), `../examples/${BUNDLED_GAME_EXAMPLE}/build/app`)
    const target = resolve(appRoot, path)
    const escaped = relative(appRoot, target)
    if (escaped.startsWith('..') || isAbsolute(escaped)) throw new WorkspaceHttpError(403, '预览资源离开了游戏目录。')
    const info = await nodeStat(target).catch(() => undefined)
    if (!info?.isFile()) throw new WorkspaceHttpError(404, '预览资源不存在。')
    if (info.size > PREVIEW_FILE_LIMIT) throw new WorkspaceHttpError(413, '预览资源过大。')
    return { path, bytes: await readNodeFile(target) }
  }
  if (kind === 'workspace') {
    const session = segments.shift()
    const project = segments.shift()
    const path = segments.join('/') || 'index.html'
    if (session === undefined || project === undefined || !safeRelativePath(path)) throw new WorkspaceHttpError(400, '游戏预览地址无效。')
    const ctx = await workspaceContext(context, untoken(session))
    const root = untoken(project)
    if (!gameRoot(root)) throw new WorkspaceHttpError(403, '游戏项目路径无效。')
    const appRoot = await ctx.fs.resolve(`${root}/build/app`, { cwd: ctx.cwd })
    const target = await ctx.fs.resolve(`${root}/build/app/${path}`, { cwd: ctx.cwd })
    if (!ctx.fs.contains(ctx.root, appRoot) || !ctx.fs.contains(appRoot, target)) {
      throw new WorkspaceHttpError(403, '预览资源离开了游戏目录。')
    }
    const info = requireRegularFile(await ctx.fs.stat(target))
    if (info.size !== undefined && info.size > PREVIEW_FILE_LIMIT) throw new WorkspaceHttpError(413, '预览资源过大。')
    return { path, bytes: await ctx.fs.readBytes(target, undefined, PREVIEW_FILE_LIMIT) }
  }
  throw new WorkspaceHttpError(404, '游戏预览不存在。')
}

function handle(context: Context, maxBytes: number) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const gamePreview = url.pathname.startsWith('/game-studio/preview/')
      if (gamePreview && request.method === 'GET') {
        const preview = await previewBytes(context, url.pathname)
        sendPreview(request, response, preview.path, preview.bytes)
        return
      }
      if (url.pathname === '/game-studio/workspace' && request.method === 'GET') {
        const ctx = await workspaceContext(context, url.searchParams.get('sessionId') ?? '')
        const files = await listFiles(ctx)
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const games = [
          ...await workspaceGameProjects(ctx, files, sessionId),
          await bundledGameExample().catch(() => undefined),
        ].filter((game): game is GameProjectSummary => game !== undefined)
        sendJson(response, 200, { cwd: ctx.cwd, files, games, mode: 'dsh-session' })
        return
      }
      if (url.pathname === '/game-studio/file' && request.method === 'GET') {
        const ctx = await workspaceContext(context, url.searchParams.get('sessionId') ?? '')
        const path = url.searchParams.get('path')
        if (path === null) throw new WorkspaceHttpError(400, '缺少文件路径。')
        const target = await assertWritablePath(ctx, path, 'text')
        const file = await readVersionedText(ctx.fs, target, maxBytes)
        sendJson(response, 200, { path, ...file })
        return
      }
      if (url.pathname === '/game-studio/media' && request.method === 'GET') {
        const ctx = await workspaceContext(context, url.searchParams.get('sessionId') ?? '')
        const path = url.searchParams.get('path')
        if (path === null) throw new WorkspaceHttpError(400, '缺少媒体文件路径。')
        assertGamePath(path, 'media')
        const target = await assertWritablePath(ctx, path, 'media')
        const mimeType = MEDIA_TYPES.get(extname(path).toLocaleLowerCase())
        if (mimeType === undefined) throw new WorkspaceHttpError(415, '目标不是受支持的媒体文件。')
        const info = requireRegularFile(await ctx.fs.stat(target))
        if (info.size !== undefined && info.size > MEDIA_MAX_BYTES) throw new WorkspaceHttpError(413, '媒体文件超过工作台预览大小限制。')
        sendMedia(request, response, await ctx.fs.readBytes(target, undefined, MEDIA_MAX_BYTES), mimeType)
        return
      }
      if (url.pathname === '/game-studio/file' && request.method === 'PUT') {
        const ctx = await workspaceContext(context, url.searchParams.get('sessionId') ?? '')
        const path = url.searchParams.get('path')
        if (path === null) throw new WorkspaceHttpError(400, '缺少文件路径。')
        const input = await jsonBody(request, maxBytes * 6 + 1_024)
        if (typeof input.content !== 'string') throw new WorkspaceHttpError(400, 'content 必须是字符串。')
        if (typeof input.baseVersion !== 'string' || input.baseVersion === '') throw new WorkspaceHttpError(400, 'baseVersion 必须是有效版本。')
        if (Buffer.byteLength(input.content) > maxBytes) throw new WorkspaceHttpError(413, '文件超过工作台大小限制。')
        const target = await assertWritablePath(ctx, path, 'text')
        const outcome = await ctx.fs.writeText(
          target,
          input.content,
          { kind: 'replaceIfVersion', version: input.baseVersion as FsVersion },
          undefined,
          ctx.sandboxPolicy.resolve({ session: ctx.session }),
        )
        sendJson(response, 200, { path, content: outcome.after, bytes: Buffer.byteLength(outcome.after), version: outcome.version })
        return
      }
      sendJson(response, 404, { error: 'Game studio route not found.' })
    } catch (error) {
      const mapped = error instanceof WorkspaceHttpError ? error : mapFsError(error)
      if (mapped === undefined) {
        const logger = context.logger ? context.logger('game-studio') : undefined
        if (logger !== undefined) logger.error('workspace route failed', error)
      }
      sendJson(response, mapped?.status ?? 500, { error: mapped?.message ?? 'Game studio workspace operation failed.' })
    }
  }
}

/**
 * Register the game-studio workspace routes on the webserver.
 * @param ctx - Cordis context.
 * @param options - route options.
 */
export function registerWorkspaceRoute(ctx: Context, options: { readonly maxBytes?: number } = {}): void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return
  const maxBytes = options.maxBytes ?? 2_097_152
  ctx.effect(() => {
    const route: WebRoute = {
      kind: 'prefix',
      path: '/game-studio',
      handler: handle(ctx, maxBytes),
    }
    return webServer.register(route)
  }, 'game-studio-host: workspace API routes')
}
