/**
 * Workspace-facing core of the short-drama panel: read the `drama` preset's
 * on-disk project conventions and derive the read-only values the HTTP
 * surface serves. The board document format is shared with the preset's
 * `drama-tools.js` (the writing side); this module is the reading side and
 * must stay shape-compatible with it. The five-document episode projection is
 * derived by `projection.ts`.
 * @module @deepseek-ai/dsh-client-ui-drama/board
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import {
  CREATOR_DOCUMENTS,
  parseEpisodeProjection,

  type EpisodeProjection,
} from './projection.ts'

/** Board document path inside the session workspace. */
export const BOARD_FILE = '.drama/board.json'
/** Episode workspace directories live here. */
export const EPISODES_DIR = '剧集'
/** Per-episode media delivery directory name (inside an episode directory). */
export const PRODUCE_DIR = '制作成果'

/** Largest creator document body served, in UTF-8 bytes; longer text truncates. */
export const DOCUMENT_BYTE_CAP = 512 * 1024

/** Stage vocabulary owned by the drama preset's board tools. */
export const EPISODE_STAGES = ['develop', 'screenplay', 'assets', 'storyboard', 'image-prompts', 'video-prompts', 'produce', 'review'] as const

/** One stage. */
export type EpisodeStage = (typeof EPISODE_STAGES)[number]

/** One registered episode row in the board. */
export interface BoardEpisode {
  stage: EpisodeStage
  title?: string
  pendingProduction?: string[]
}

/** Board document as the reading side normalizes it. */
export interface BoardDocument {
  formatVersion: number
  projectTitle?: string
  productionForm?: string
  episodes: Record<string, BoardEpisode>
}

/** One episode row of the overview value. */
export interface EpisodeOverviewRow {
  /** Episode directory path (`剧集/EP001`). */
  episode: string
  title?: string
  stage: EpisodeStage
  /** Present creator Markdown filenames, ordered. */
  documents: string[]
  /** Number of media files under `剧集/<EP>/制作成果/`. */
  mediaCount: number
}

/** The `/drama/overview` response value. */
export interface OverviewValue {
  /** Whether the workspace holds a short-drama project at all. */
  project: { exists: boolean }
  /** Project title when the board defines one. */
  projectTitle?: string
  /** Project production form when the board defines one. */
  productionForm?: string
  /** Episode rows sorted by directory name. */
  episodes: EpisodeOverviewRow[]
  /** Ledger asset counts keyed by kind. */
  assetKindCounts: Record<string, number>
  /** Total creator-marked pending production items across episodes. */
  pendingProductionCount: number
}

/** The `/drama/document` response value. */
export interface DocumentValue {
  /** Workspace-relative path actually served. */
  file: string
  /** Document text, truncated to {@link DOCUMENT_BYTE_CAP} bytes when oversize. */
  text: string
  /** Whether the text was cut by the byte cap. */
  truncated: boolean
}

/** A media file under an episode's `制作成果/` directory. */
export interface MediaRecord {
  /** Workspace-relative path. */
  path: string
  /** Basename. */
  name: string
  kind: 'image' | 'video' | 'other'
}

/** The `/drama/episode` response value. */
export interface EpisodeValue {
  episode: string
  /** Board row title when the board defines one. */
  title?: string
  /** Board stage, or the present-document-derived stage when unregistered. */
  stage: EpisodeStage
  /** Present creator Markdown filenames, ordered. */
  documents: string[]
  /** Media under `剧集/<EP>/制作成果/`. */
  media: MediaRecord[]
  /** Parsed {@link EpisodeProjection} over the present documents. */
  projection: EpisodeProjection
}

/** Media extensions classified for display. */
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/iu
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/iu

/** Media display kind for a filename. */
function mediaKind(name: string): MediaRecord['kind'] {
  return IMAGE_EXT_RE.test(name) ? 'image' : VIDEO_EXT_RE.test(name) ? 'video' : 'other'
}

/**
 * Normalize an unknown board file into the canonical model. The board is
 * durable workspace content written by preset tools and hand-editable by
 * authors, so unknown shapes degrade to defaults instead of failing the panel.
 * @param parsed - the JSON.parse result of the board file.
 * @returns the canonical board document.
 */
export function normalizeBoard(parsed: unknown): BoardDocument {
  const root = parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const episodesSource = root.episodes !== null && typeof root.episodes === 'object' && !Array.isArray(root.episodes)
    ? root.episodes as Record<string, unknown> : {}
  const normalized: Record<string, BoardEpisode> = {}
  for (const [dir, raw] of Object.entries(episodesSource)) {
    const row = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const stage = EPISODE_STAGES.includes(row.stage as EpisodeStage) ? row.stage as EpisodeStage : 'develop'
    const episode: BoardEpisode = { stage }
    if (typeof row.title === 'string') episode.title = row.title
    if (Array.isArray(row.pendingProduction)) {
      episode.pendingProduction = row.pendingProduction.filter((item): item is string => typeof item === 'string')
    }
    normalized[dir] = episode
  }
  return {
    formatVersion: typeof root.formatVersion === 'number' ? root.formatVersion : 1,
    ...typeof root.projectTitle === 'string' ? { projectTitle: root.projectTitle } : {},
    ...typeof root.productionForm === 'string' ? { productionForm: root.productionForm } : {},
    episodes: normalized,
  }
}

/**
 * Read the board document, returning `undefined` when the file is absent.
 * @param fs - filesystem backend resolving workspace-relative paths.
 * @param cwd - absolute session workspace root.
 * @returns The canonical board document, or `undefined` when absent.
 */
export async function readBoard(fs: FileSystem, cwd: string): Promise<BoardDocument | undefined> {
  const target = await fs.resolve(BOARD_FILE, { cwd })
  if (await fs.stat(target) === undefined) return undefined
  return normalizeBoard(JSON.parse(await fs.readText(target)))
}

/** List first-level entry names directly inside a workspace directory; absent directories list empty. */
async function listNames(fs: FileSystem, dir: string, cwd: string): Promise<string[]> {
  const target = await fs.resolve(dir, { cwd })
  if (await fs.stat(target) === undefined) return []
  return (await fs.listDir(target))
    .filter(entry => entry.type === 'file' || entry.type === 'directory')
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

/** Episode directory names (`剧集/EPxxx`) found in the workspace. */
async function scanEpisodeDirs(fs: FileSystem, cwd: string): Promise<string[]> {
  return (await listNames(fs, EPISODES_DIR, cwd))
    .map(name => name.replace(/\/+$/, ''))
    .filter(name => /^EP\d{3,}$/u.test(name))
    .map(name => `${EPISODES_DIR}/${name}`)
}

/** Which of the five creator Markdown documents exist for an episode. */
async function episodeDocuments(fs: FileSystem, cwd: string, episode: string): Promise<string[]> {
  const names = new Set(await listNames(fs, episode, cwd))
  return CREATOR_DOCUMENTS.filter(name => names.has(name))
}

/** List media records under `剧集/<EP>/制作成果/`. */
async function episodeMedia(fs: FileSystem, cwd: string, episode: string): Promise<MediaRecord[]> {
  const dir = `${episode}/${PRODUCE_DIR}`
  const target = await fs.resolve(dir, { cwd })
  if (await fs.stat(target) === undefined) return []
  const entries = await fs.listDir(target)
  return entries
    .filter(entry => entry.type === 'file')
    .map(entry => ({ path: `${dir}/${entry.name}`, name: entry.name, kind: mediaKind(entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
}

/**
 * Derive the overview value for one session workspace. Episode rows come from
 * the filesystem and read their stage from the board; a workspace with no
 * episode directory and no board reports `project.exists: false`.
 * @param {FileSystem} fs - Filesystem backend resolving workspace-relative paths.
 * @param {string} cwd - Absolute session workspace root.
 * @returns The overview value served by the panel.
 */
export async function readOverview(fs: FileSystem, cwd: string): Promise<OverviewValue> {
  const board = await readBoard(fs, cwd)
  const episodes: EpisodeOverviewRow[] = []
  for (const episode of await scanEpisodeDirs(fs, cwd)) {
    const row = board?.episodes[episode]
    episodes.push({
      episode,
      ...row?.title !== undefined ? { title: row.title } : {},
      stage: row?.stage ?? 'develop',
      documents: await episodeDocuments(fs, cwd, episode),
      mediaCount: (await episodeMedia(fs, cwd, episode)).length,
    })
  }
  const pendingProductionCount = Object.values(board?.episodes ?? {})
    .reduce((sum, row) => sum + (row.pendingProduction?.length ?? 0), 0)
  return {
    project: { exists: board !== undefined || episodes.length > 0 },
    ...board?.projectTitle !== undefined ? { projectTitle: board.projectTitle } : {},
    ...board?.productionForm !== undefined ? { productionForm: board.productionForm } : {},
    episodes,
    assetKindCounts: { character: 0, scene: 0, prop: 0, state: 0, unknown: 0 },
    pendingProductionCount,
  }
}

/**
 * Validate a requested workspace-relative creator document path. Only relative
 * `.md` paths inside one episode directory are servable; absolute paths,
 * parent traversal, backslashes and other extensions are rejected.
 * @param {string} file - The requested document path.
 * @returns The validated workspace-relative path.
 * @throws When the path escapes one episode directory or is not a `.md` path.
 */
export function sanitizeEpisodeDocumentPath(file: string): string {
  if (file.length === 0 || file.length > 512) throw new Error('document path must be a non-empty string of at most 512 characters')
  if (file.includes('\\') || file.includes('\0')) throw new Error('document path must use "/" separators')
  const segments = file.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('document path must be relative and must not traverse out of the workspace')
  }
  if (!file.endsWith('.md')) throw new Error('only .md documents are served')
  const first = segments[0] ?? ''
  const second = segments[1] ?? ''
  if (first !== EPISODES_DIR || !/^EP\d{3,}$/u.test(second)) {
    throw new Error('episode document path must start with an episode directory under 剧集/')
  }
  return file
}

/**
 * Read one workspace creator document for the panel, truncating oversize
 * bodies. The UTF-8 cut is backed off any continuation byte so the decoded
 * prefix never splits a code point.
 * @param fs - Filesystem backend resolving workspace-relative paths.
 * @param cwd - Absolute session workspace root.
 * @param file - Workspace-relative episode `.md` path (raw or validated).
 * @returns The document value, or `undefined` when absent.
 * @throws When the path fails {@link sanitizeEpisodeDocumentPath}.
 */
export async function readDocument(fs: FileSystem, cwd: string, file: string): Promise<DocumentValue | undefined> {
  const path = sanitizeEpisodeDocumentPath(file)
  const target = await fs.resolve(path, { cwd })
  if (await fs.stat(target) === undefined) return undefined
  const text = await fs.readText(target)
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= DOCUMENT_BYTE_CAP) return { file: path, text, truncated: false }
  let cut = DOCUMENT_BYTE_CAP
  while (cut > 0) {
    const byte = bytes[cut]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    cut -= 1
  }
  return { file: path, text: new TextDecoder().decode(bytes.slice(0, cut)), truncated: true }
}

/**
 * Derive the episode view for one episode directory: the board row, the
 * present creator documents, the parsed projection and the media list.
 * @param fs - Filesystem backend resolving workspace-relative paths.
 * @param cwd - Absolute session workspace root.
 * @param episode - An episode directory (`剧集/EP001`).
 * @returns The episode value, or `undefined` when the directory is absent.
 */
export async function readEpisode(fs: FileSystem, cwd: string, episode: string): Promise<EpisodeValue | undefined> {
  const dir = normalizeEpisode(episode)
  if (dir === undefined) return undefined
  const dirTarget = await fs.resolve(dir, { cwd })
  if (await fs.stat(dirTarget) === undefined) return undefined
  const board = await readBoard(fs, cwd)
  const row = board?.episodes[dir]
  const documents = await episodeDocuments(fs, cwd, dir)
  const media = await episodeMedia(fs, cwd, dir)
  const textMap: Record<string, string> = {}
  for (const name of documents) {
    const target = await fs.resolve(`${dir}/${name}`, { cwd })
    textMap[name] = await fs.readText(target)
  }
  const projection = parseEpisodeProjection(textMap, dir)
  return {
    episode: dir,
    ...row?.title !== undefined ? { title: row.title } : {},
    stage: row?.stage ?? stageFromProjection(projection),
    documents,
    media,
    projection,
  }
}

/** Normalize an episode path to `剧集/EPxxx`, or `undefined` when invalid. */
function normalizeEpisode(value: string): string | undefined {
  const cleaned = value.replaceAll('\\', '/').replace(/\/+$/, '')
  return /^剧集\/EP\d{3,}$/u.test(cleaned) ? cleaned : undefined
}

/** Best-effort stage from which creator documents exist. */
function stageFromProjection(projection: EpisodeProjection): EpisodeStage {
  if (projection.documents.includes('视频提示词.md')) return 'video-prompts'
  if (projection.documents.includes('图片提示词.md')) return 'image-prompts'
  if (projection.documents.includes('分镜.md')) return 'storyboard'
  if (projection.documents.includes('视觉设定.md')) return 'assets'
  if (projection.documents.includes('剧本.md')) return 'screenplay'
  return 'develop'
}
