import { describe, expect, it } from 'vitest'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import {
  DOCUMENT_BYTE_CAP, countWords, normalizeBoard, readBoard, readDocument, readOverview, sanitizeDocumentPath,
} from '../src/board.ts'

/** In-memory single-root backend over a flat relative-path map; enough for the reads board.ts performs. */
class MemoryFs {
  private readonly files = new Map<string, string>()
  private seq = 0

  /** Seed one file at a workspace-relative path. */
  seed(path: string, text: string): void {
    this.files.set(path, text)
  }

  async resolve(path: string): Promise<{ targetKey: string; displayPath: string }> {
    if (path.includes('..')) throw new Error('FS_NOT_FOUND')
    return { targetKey: `mem://${path}`, displayPath: path }
  }

  async stat(target: { targetKey: string }): Promise<{ version: string; type: 'file' | 'directory'; size: number } | undefined> {
    const path = this.pathOf(target)
    const text = this.files.get(path)
    if (text !== undefined) return { version: `v${String(++this.seq)}`, type: 'file', size: text.length }
    // Directories are implicit: present when any seeded path lives below them.
    const isDir = [...this.files.keys()].some(key => key.startsWith(`${path}/`))
    if (isDir) return { version: `v${String(++this.seq)}`, type: 'directory', size: 0 }
    return undefined
  }

  async readText(target: { targetKey: string }): Promise<string> {
    const text = this.files.get(this.pathOf(target))
    if (text === undefined) throw new Error('FS_NOT_FOUND')
    return text
  }

  async listDir(target: { targetKey: string }): Promise<{ name: string; type: 'file'; target: { targetKey: string; displayPath: string } }[]> {
    const prefix = `${this.pathOf(target)}/`
    return [...this.files.keys()]
      .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map(key => ({ name: key.slice(prefix.length), type: 'file' as const, target: { targetKey: `mem://${key}`, displayPath: key } }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private pathOf(target: { targetKey: string }): string {
    return target.targetKey.replace('mem://', '')
  }
}

/** The memory backend read through the FileSystem interface board.ts consumes. */
const toFs = (fs: MemoryFs): FileSystem => fs as unknown as FileSystem

const CWD = '/workspace'

function boardDocument(): string {
  return JSON.stringify({
    formatVersion: 1,
    chapters: {
      '01-雪夜.md': { status: 'final' },
      '02-火车站.md': { status: 'draft', title: '火车站' },
    },
    foreshadows: [
      { id: 'f01', summary: '车票上的日期是明天', plantedIn: '01-雪夜.md' },
      { id: 'f02', summary: '修表匠的右耳', plantedIn: '01-雪夜.md', paidoffIn: '02-火车站.md' },
    ],
  })
}

describe('normalizeBoard', () => {
  it('normalizes a full board', () => {
    const board = normalizeBoard(JSON.parse(boardDocument()))
    expect(board.formatVersion).toBe(1)
    expect(board.chapters['02-火车站.md']).toEqual({ status: 'draft', title: '火车站' })
    expect(board.foreshadows[1]!.paidoffIn).toBe('02-火车站.md')
  })

  it('degrades unknown shapes to defaults', () => {
    expect(normalizeBoard(null)).toEqual({ formatVersion: 1, chapters: {}, foreshadows: [] })
    expect(normalizeBoard({ chapters: { 'a.md': { status: 'bogus' } }, foreshadows: [{ summary: 3 }] }).chapters['a.md']!.status).toBe('draft')
    const degraded = normalizeBoard({
      chapters: { 'a.md': { status: 'bogus' }, 'b.md': null, 'c.md': 'junk' },
      foreshadows: [{ summary: 3 }, null, 7],
    })
    expect(degraded.chapters['b.md']).toEqual({ status: 'draft' })
    expect(degraded.chapters['c.md']).toEqual({ status: 'draft' })
    expect(degraded.foreshadows).toEqual([
      { id: 'f01', summary: '' },
      { id: 'f02', summary: '' },
      { id: 'f03', summary: '' },
    ])
    expect(normalizeBoard({ chapters: [], foreshadows: {} }).formatVersion).toBe(1)
    expect(normalizeBoard({ formatVersion: 2 }).formatVersion).toBe(2)
  })
})

describe('countWords', () => {
  it('counts non-whitespace characters', () => {
    expect(countWords('雪下 了一夜\n\t')).toBe(5)
    expect(countWords('')).toBe(0)
  })
})

describe('readBoard', () => {
  it('returns undefined when the board is absent', async () => {
    const fs = new MemoryFs()
    await expect(readBoard(toFs(fs), CWD)).resolves.toBeUndefined()
  })

  it('reads the seeded board', async () => {
    const fs = new MemoryFs()
    fs.seed('.novel/board.json', boardDocument())
    const board = await readBoard(toFs(fs), CWD)
    expect(board?.foreshadows).toHaveLength(2)
  })
})

describe('readOverview', () => {
  it('reports an empty workspace as no project', async () => {
    const fs = new MemoryFs()
    const value = await readOverview(toFs(fs), CWD)
    expect(value.project.exists).toBe(false)
    expect(value.summary.chapterCount).toBe(0)
  })

  it('derives chapters, statuses, characters, and summary from a full workspace', async () => {
    const fs = new MemoryFs()
    fs.seed('.novel/board.json', boardDocument())
    fs.seed('outline.md', '# 雪夜列车')
    fs.seed('chapters/01-雪夜.md', '雪下了一夜，火车没有来。')
    fs.seed('chapters/02-火车站.md', '站台空无一人。')
    fs.seed('chapters/notes.txt', 'ignored')
    fs.seed('characters/林见舟.md', '# 林见舟')
    const value = await readOverview(toFs(fs), CWD)
    expect(value.project.exists).toBe(true)
    expect(value.outline).toBe(true)
    expect(value.chapters.map(row => row.chapter)).toEqual(['01-雪夜.md', '02-火车站.md'])
    expect(value.chapters.map(row => row.status)).toEqual(['final', 'draft'])
    expect(value.chapters.map(row => row.words)).toEqual([12, 7])
    expect(value.characters).toEqual(['林见舟.md'])
    expect(value.summary).toEqual({
      totalWords: 19,
      chapterCount: 2,
      byStatus: { draft: 1, revised: 0, final: 1 },
      openForeshadowCount: 1,
    })
  })

  it('reads unboarded chapters as draft', async () => {
    const fs = new MemoryFs()
    fs.seed('chapters/03-尾站.md', '终点。')
    const value = await readOverview(toFs(fs), CWD)
    expect(value.chapters[0]!.status).toBe('draft')
    expect(value.foreshadows).toEqual([])
  })
})

describe('sanitizeDocumentPath', () => {
  it('accepts plain relative .md paths', () => {
    expect(sanitizeDocumentPath('chapters/01-雪夜.md')).toBe('chapters/01-雪夜.md')
  })

  it('rejects traversal, absolute, backslash, non-md, and empty paths', () => {
    expect(() => sanitizeDocumentPath('../secrets.md')).toThrow('relative')
    expect(() => sanitizeDocumentPath('chapters/../../etc/passwd.md')).toThrow('relative')
    expect(() => sanitizeDocumentPath('/etc/passwd.md')).toThrow('relative')
    expect(() => sanitizeDocumentPath('chapters\\01.md')).toThrow('/"')
    expect(() => sanitizeDocumentPath('chapters/01.txt')).toThrow('.md')
    expect(() => sanitizeDocumentPath('')).toThrow('non-empty')
    expect(() => sanitizeDocumentPath('a/'.repeat(257) + 'x.md')).toThrow('512')
  })
})

describe('readDocument', () => {
  it('returns undefined for absent files', async () => {
    const fs = new MemoryFs()
    await expect(readDocument(toFs(fs), CWD, 'outline.md')).resolves.toBeUndefined()
  })

  it('serves small files verbatim', async () => {
    const fs = new MemoryFs()
    fs.seed('outline.md', '# 大纲')
    await expect(readDocument(toFs(fs), CWD, 'outline.md')).resolves.toEqual({ file: 'outline.md', text: '# 大纲', truncated: false })
  })

  it('rejects unservable paths', async () => {
    const fs = new MemoryFs()
    await expect(readDocument(toFs(fs), CWD, '../x.md')).rejects.toThrow('relative')
  })

  it('truncates oversize files at the byte cap without splitting a code point', async () => {
    const fs = new MemoryFs()
    const ascii = 'a'.repeat(DOCUMENT_BYTE_CAP)
    fs.seed('big.md', `${ascii}b`)
    const value = await readDocument(toFs(fs), CWD, 'big.md')
    expect(value?.truncated).toBe(true)
    expect(value?.text).toHaveLength(DOCUMENT_BYTE_CAP)

    // Two ASCII bytes shift every 4-byte astral char, so the cap lands inside
    // one: the cut must back off to its lead byte instead of splitting it.
    const emoji = `ab${'🎅'.repeat(70_000)}`
    fs.seed('emoji.md', emoji)
    const emojiValue = await readDocument(toFs(fs), CWD, 'emoji.md')
    expect(emojiValue?.truncated).toBe(true)
    expect(new TextEncoder().encode(emojiValue!.text).length).toBeLessThanOrEqual(DOCUMENT_BYTE_CAP)
    expect(emojiValue!.text.length).toBeGreaterThan(0)
    expect(/[\uD800-\uDBFF]$/.test(emojiValue!.text)).toBe(false)
  })
})
