/**
 * Workspace-facing core of the novel panel: read the novelist preset's
 * on-disk project conventions and derive the read-only values the HTTP
 * surface serves. The board document format is shared with the preset's
 * `novel-tools.js` (the writing side); this module is the reading side and
 * must stay shape-compatible with it. Word count is the non-whitespace
 * character count the novelist preset documents for CJK manuscripts.
 * @module @deepseek-ai/dsh-client-ui-novel/board
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'

/** Board document path inside the session workspace. */
export const BOARD_FILE = '.novel/board.json'
/** Chapter files live here, one `NN-章名.md` per chapter. */
export const CHAPTERS_DIR = 'chapters'
/** Character sheets live here, one `<名字>.md` per character. */
export const CHARACTERS_DIR = 'characters'

/** Chapter status vocabulary owned by the novelist preset's board tools. */
export const CHAPTER_STATUSES = ['draft', 'revised', 'final'] as const

/** One chapter status. */
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number]

/** Largest chapter document body served, in UTF-8 bytes; longer text truncates. */
export const DOCUMENT_BYTE_CAP = 200 * 1024

/** One outline/characters entry as the reading side normalizes it. */
export interface BoardDocument {
  /** Board format version; unknown files report the current `1`. */
  formatVersion: number
  /** Per-chapter state keyed by chapter file name (`NN-章名.md`). */
  chapters: Record<string, { status: ChapterStatus; title?: string }>
  /** Foreshadow ledger rows in registration order. */
  foreshadows: ForeshadowRow[]
}

/** One foreshadow ledger row. */
export interface ForeshadowRow {
  /** Ledger id (`f01`, …) assigned at registration. */
  id: string
  /** One-sentence foreshadow content. */
  summary: string
  /** Chapter that plants the foreshadow. */
  plantedIn?: string
  /** Chapter that pays it off; absent while open. */
  paidoffIn?: string
}

/** One chapter row of the overview value. */
export interface ChapterRow {
  /** Chapter file name (`NN-章名.md`). */
  chapter: string
  /** Board status; files missing from the board read as `draft`. */
  status: ChapterStatus
  /** Non-whitespace character count of the chapter body. */
  words: number
}

/** The `/novel/overview` response value. */
export interface OverviewValue {
  /** Whether the workspace holds a novel project at all. */
  project: { exists: boolean }
  /** Chapter rows sorted by file name. */
  chapters: ChapterRow[]
  /** Character sheet file names, sorted. */
  characters: string[]
  /** Whether `outline.md` exists. */
  outline: boolean
  /** Foreshadow ledger rows. */
  foreshadows: ForeshadowRow[]
  /** Tool-owned derived tracking views present in the workspace, sorted. */
  trackingViews: string[]
  /** Derived totals. */
  summary: {
    totalWords: number
    chapterCount: number
    byStatus: Record<ChapterStatus, number>
    openForeshadowCount: number
  }
}

/** The `/novel/document` response value. */
export interface DocumentValue {
  /** Workspace-relative path actually served. */
  file: string
  /** Document text, truncated to {@link DOCUMENT_BYTE_CAP} bytes when oversize. */
  text: string
  /** Whether the text was cut by the byte cap. */
  truncated: boolean
}

/** Whitespace run excluded from the visible-character count. */
const WHITE_SPACE = /[\t\n\u000b\u000c\r \u0085\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000]/gu

/**
 * Visible-character count over the visible body — the CJK manuscript word
 * convention shared with the preset's `novel_track` tool: a recognizable
 * frontmatter block, leading blank lines, and the first ATX heading do not
 * count.
 * @param text - the document text to count.
 * @returns the number of visible characters.
 */
export function countWords(text: string): number {
  let lines = text.replace(/\r\n?/g, '\n').replace(/^\ufeff/, '').split('\n')
  if (lines[0] === '---') {
    const closing = lines.slice(1, 201).findIndex(line => line === '---' || line === '...')
    if (closing >= 1) lines = lines.slice(closing + 2)
  }
  while (lines.length > 0 && /^[\t \u3000]*$/.test(lines[0] ?? '')) lines = lines.slice(1)
  if (lines.length > 0 && /^[\t ]{0,3}#{1,6}[\t ]+\S/.test(lines[0] ?? '')) lines = lines.slice(1)
  return lines.join('\n').replace(WHITE_SPACE, '').length
}

/**
 * Normalize an unknown board file into the canonical document. The board is
 * durable file content written by preset tools and hand-editable by authors,
 * so unknown shapes degrade to defaults instead of failing the panel.
 * @param parsed - the JSON.parse result of the board file.
 * @returns the canonical board document.
 */
export function normalizeBoard(parsed: unknown): BoardDocument {
  const root = parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const chapters = root.chapters !== null && typeof root.chapters === 'object' && !Array.isArray(root.chapters)
    ? root.chapters as Record<string, unknown>
    : {}
  const foreshadows = Array.isArray(root.foreshadows) ? root.foreshadows : []
  return {
    formatVersion: typeof root.formatVersion === 'number' ? root.formatVersion : 1,
    chapters: Object.fromEntries(Object.entries(chapters).map(([file, entry]) => {
      const row = entry !== null && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      return [file, {
        status: CHAPTER_STATUSES.find(status => status === row.status) ?? 'draft',
        ...typeof row.title === 'string' ? { title: row.title } : {},
      }]
    })),
    foreshadows: foreshadows.map((entry, index) => {
      const row = entry !== null && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      return {
        id: typeof row.id === 'string' ? row.id : `f${String(index + 1).padStart(2, '0')}`,
        summary: typeof row.summary === 'string' ? row.summary : '',
        ...typeof row.plantedIn === 'string' ? { plantedIn: row.plantedIn } : {},
        ...typeof row.paidoffIn === 'string' ? { paidoffIn: row.paidoffIn } : {},
      }
    }),
  }
}

/**
 * Read the board document, returning `undefined` when the file is absent.
 * @param fs - filesystem backend resolving workspace-relative paths.
 * @param cwd - absolute session workspace root.
 * @returns the canonical board document, or `undefined` when absent.
 */
export async function readBoard(fs: FileSystem, cwd: string): Promise<BoardDocument | undefined> {
  const target = await fs.resolve(BOARD_FILE, { cwd })
  if (await fs.stat(target) === undefined) return undefined
  return normalizeBoard(JSON.parse(await fs.readText(target)))
}

/** List `.md` file names directly inside a workspace directory, sorted; absent directories list empty. */
async function listMarkdown(fs: FileSystem, dir: string, cwd: string): Promise<string[]> {
  const target = await fs.resolve(dir, { cwd })
  if (await fs.stat(target) === undefined) return []
  const entries = await fs.listDir(target)
  return entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort()
}

/**
 * Derive the overview value for one session workspace. Chapter statuses come
 * from the board; files missing from the board read as `draft`. A workspace
 * with neither board nor chapters reports `project.exists: false`.
 * @param fs - filesystem backend resolving workspace-relative paths.
 * @param cwd - absolute session workspace root.
 * @returns the overview value served by the panel.
 */
export async function readOverview(fs: FileSystem, cwd: string): Promise<OverviewValue> {
  const [board, chapterFiles, characters, outlineTarget] = await Promise.all([
    readBoard(fs, cwd),
    listMarkdown(fs, CHAPTERS_DIR, cwd),
    listMarkdown(fs, CHARACTERS_DIR, cwd),
    fs.resolve('outline.md', { cwd }),
  ])
  const outline = await fs.stat(outlineTarget) !== undefined
  const chapters: ChapterRow[] = await Promise.all(chapterFiles.map(async (file) => {
    const target = await fs.resolve(`${CHAPTERS_DIR}/${file}`, { cwd })
    return {
      chapter: file,
      status: board?.chapters[file]?.status ?? 'draft',
      words: countWords(await fs.readText(target)),
    }
  }))
  const byStatus = Object.fromEntries(CHAPTER_STATUSES.map(status => [
    status,
    chapters.filter(row => row.status === status).length,
  ])) as Record<ChapterStatus, number>
  const trackingViews = await listTrackingViews(fs, cwd)
  return {
    project: { exists: board !== undefined || chapters.length > 0 || outline },
    chapters,
    characters,
    outline,
    foreshadows: board?.foreshadows ?? [],
    trackingViews,
    summary: {
      totalWords: chapters.reduce((sum, row) => sum + row.words, 0),
      chapterCount: chapters.length,
      byStatus,
      openForeshadowCount: (board?.foreshadows ?? []).filter(row => row.paidoffIn === undefined).length,
    },
  }
}

/** Derived-view roots the tracking tools regenerate; each is listed recursively one level deep. */
const TRACKING_VIEW_DIRS = ['.novel', '.novel/角色状态', '.novel/时间线', '.novel/逐章记录'] as const

/**
 * List the tracking views the tools have generated, sorted, so the panel can
 * offer them as plain documents. Only files under `.novel/` count; absent
 * directories contribute nothing.
 * @param fs - filesystem backend resolving workspace-relative paths.
 * @param cwd - absolute session workspace root.
 * @returns workspace-relative paths of the present views.
 */
async function listTrackingViews(fs: FileSystem, cwd: string): Promise<string[]> {
  const lists = await Promise.all(TRACKING_VIEW_DIRS.map(async (dir) => {
    const target = await fs.resolve(dir, { cwd })
    if (await fs.stat(target) === undefined) return []
    const entries = await fs.listDir(target)
    return entries
      .filter(entry => entry.type === 'file' && entry.name.endsWith('.md'))
      .map(entry => `${dir}/${entry.name}`)
  }))
  return lists.flat().sort()
}

/**
 * Validate a requested workspace-relative document path. Only relative paths
 * of `.md` files inside the workspace are servable; absolute paths, parent
 * traversal, backslashes, and other extensions are rejected.
 * @param file - the requested document path.
 * @returns the validated workspace-relative path.
 * @throws when the path escapes the workspace or is not a servable `.md` path.
 */
export function sanitizeDocumentPath(file: string): string {
  if (file.length === 0 || file.length > 512) throw new Error('document path must be a non-empty string of at most 512 characters')
  if (file.includes('\\') || file.includes('\0')) throw new Error('document path must use "/" separators')
  const segments = file.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('document path must be relative and must not traverse out of the workspace')
  }
  if (!file.endsWith('.md')) throw new Error('only .md documents are served')
  return file
}

/**
 * Read one workspace document for the panel, truncating oversize bodies.
 * @param fs - filesystem backend resolving workspace-relative paths.
 * @param cwd - absolute session workspace root.
 * @param file - workspace-relative `.md` path (already validated or raw).
 * @returns the document value, or `undefined` when the file is absent.
 * @throws when the path fails {@link sanitizeDocumentPath}.
 */
export async function readDocument(fs: FileSystem, cwd: string, file: string): Promise<DocumentValue | undefined> {
  const path = sanitizeDocumentPath(file)
  const target = await fs.resolve(path, { cwd })
  if (await fs.stat(target) === undefined) return undefined
  const text = await fs.readText(target)
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= DOCUMENT_BYTE_CAP) return { file: path, text, truncated: false }
  // Back the byte cut off any UTF-8 continuation byte so the decoded prefix
  // never splits a code point (an astral char is one lead byte plus
  // continuations, so the boundary walk lands on its lead byte).
  let cut = DOCUMENT_BYTE_CAP
  while (cut > 0) {
    const byte = bytes[cut]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    cut -= 1
  }
  return { file: path, text: new TextDecoder().decode(bytes.slice(0, cut)), truncated: true }
}
