import { describe, expect, it } from 'vitest'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import {
  DOCUMENT_BYTE_CAP, EPISODES_DIR, normalizeBoard, readBoard, readDocument,
  readEpisode, readOverview, sanitizeEpisodeDocumentPath,
} from '../src/board.ts'
import { isEpisodeDirectory, parseEpisodeProjection as parseProjection } from '../src/projection.ts'
import type { EpisodeStage } from '../src/board.ts'

/** In-memory backend over a flat map; enough for the reads board.ts performs. */
class MemoryFs {
  private readonly files = new Map<string, string>()
  private seq = 0

  /** Seed one file at a workspace-relative path. */
  seed(path: string, text: string): void {
    this.files.set(path, text)
  }

  async resolve(path: string, _opts?: { cwd: string }): Promise<{ targetKey: string; displayPath: string }> {
    if (path.includes('..')) throw new Error('FS_NOT_FOUND')
    return { targetKey: `mem://${path}`, displayPath: path }
  }

  async stat(target: { targetKey: string }): Promise<{ version: string; type: 'file' | 'directory'; size: number } | undefined> {
    const path = this.pathOf(target)
    const text = this.files.get(path)
    if (text !== undefined) return { version: `v${String(++this.seq)}`, type: 'file', size: text.length }
    const isDir = [...this.files.keys()].some(key => key.startsWith(`${path}/`))
    if (isDir) return { version: `v${String(++this.seq)}`, type: 'directory', size: 0 }
    return undefined
  }

  async readText(target: { targetKey: string }): Promise<string> {
    const text = this.files.get(this.pathOf(target))
    if (text === undefined) throw new Error('FS_NOT_FOUND')
    return text
  }

  async listDir(target: { targetKey: string }): Promise<{ name: string; type: 'file' | 'directory'; target: unknown }[]> {
    const path = this.pathOf(target)
    const prefix = `${path}/`
    const entries = [...this.files.keys()]
      .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/') && key !== path)
      .map(key => ({ name: key.slice(prefix.length), type: 'file' as const, target: { targetKey: `mem://${key}`, displayPath: key } }))
    // Implicit directories: any seeded path directly below contributes a dir entry.
    const names = new Set(entries.map(entry => entry.name))
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.includes('/')) names.add(rest.slice(0, rest.indexOf('/')))
    }
    const out: Array<{ name: string; type: 'file' | 'directory'; target: unknown }> = [...entries]
    for (const name of names) {
      if (!out.some(entry => entry.name === name)) out.push({ name, type: 'directory', target: { targetKey: `mem://${prefix}${name}`, displayPath: `${prefix}${name}` } })
    }
    return out
  }

  private pathOf(target: { targetKey: string }): string {
    return target.targetKey.replace('mem://', '')
  }
}

const toFs = (fs: MemoryFs): FileSystem => fs as unknown as FileSystem
const CWD = '/workspace'

const EP1 = `${EPISODES_DIR}/EP001`

function docs() {
  return {
    '剧本.md': '## EP001-SC001 雪夜\n一行。\n',
    '视觉设定.md': '## ASSET-001 主角 人物\n## ASSET-002 站台 场景\n',
    '分镜.md': '## SHOT-001 开场 2 秒\n引用 ASSET-001。\n',
    '图片提示词.md': '## IMG-001 开场画面\n### 可复制提示词\n```\n雪夜站台\n```\n',
    '视频提示词.md': '## MOTION-001 推近 SHOT-001\n',
  }
}

describe('normalizeBoard', () => {
  it('normalizes a full board', () => {
    const board = normalizeBoard(JSON.parse(JSON.stringify({
      formatVersion: 1,
      projectTitle: '雪夜列车',
      productionForm: '竖屏短剧',
      episodes: {
        [EP1]: { stage: 'storyboard', title: '初雪' },
        [`${EPISODES_DIR}/EP002`]: { stage: 'bogus' as EpisodeStage, pendingProduction: ['镜头 3'] },
      },
    })))
    expect(board.projectTitle).toBe('雪夜列车')
    expect(board.episodes[EP1]!.stage).toBe('storyboard')
    expect(board.episodes[`${EPISODES_DIR}/EP002`]!.stage).toBe('develop')
    expect(board.episodes[`${EPISODES_DIR}/EP002`]!.pendingProduction).toEqual([ '镜头 3' ])
  })

  it('degrades unknown shapes', () => {
    expect(normalizeBoard(null)).toEqual({ formatVersion: 1, episodes: {} })
    expect(normalizeBoard({ formatVersion: 2 }).formatVersion).toBe(2)
  })
})

describe('readBoard / readOverview', () => {
  it('returns undefined when the board is absent', async () => {
    const fs = new MemoryFs()
    await expect(readBoard(toFs(fs), CWD)).resolves.toBeUndefined()
  })

  it('reads a seeded board', async () => {
    const fs = new MemoryFs()
    fs.seed('.drama/board.json', JSON.stringify({ formatVersion: 1, projectTitle: '雪夜列车', episodes: { [EP1]: { stage: 'develop' } } }))
    const board = await readBoard(toFs(fs), CWD)
    expect(board?.projectTitle).toBe('雪夜列车')
    expect(board?.episodes[EP1]?.stage).toBe('develop')
  })

  it('reports an empty workspace as no project', async () => {
    const fs = new MemoryFs()
    const value = await readOverview(toFs(fs), CWD)
    expect(value.project.exists).toBe(false)
    expect(value.episodes).toEqual([])
  })

  it('reads board and episode documents and media', async () => {
    const fs = new MemoryFs()
    fs.seed('.drama/board.json', JSON.stringify({
      formatVersion: 1,
      projectTitle: '雪夜列车',
      episodes: { [EP1]: { stage: 'storyboard', title: '初雪' } },
    }))
    for (const [name, body] of Object.entries(docs())) fs.seed(`${EP1}/${name}`, body)
    fs.seed(`${EP1}/制作成果/shot-01.png`, '')
    fs.seed(`${EP1}/制作成果/clip.mp4`, '')
    fs.seed(`${EP1}/notes.txt`, 'ignored')
    const value = await readOverview(toFs(fs), CWD)
    expect(value.project.exists).toBe(true)
    expect(value.projectTitle).toBe('雪夜列车')
    expect(value.episodes).toHaveLength(1)
    const row = value.episodes[0]!
    expect(row.episode).toBe(EP1)
    expect(row.title).toBe('初雪')
    expect(row.stage).toBe('storyboard')
    expect(row.documents).toEqual(['剧本.md', '视觉设定.md', '分镜.md', '图片提示词.md', '视频提示词.md'])
    expect(row.mediaCount).toBe(2)
  })

  it('lists an episode by present documents when unboarded', async () => {
    const fs = new MemoryFs()
    fs.seed(`${EP1}/剧本.md`, '# 脚本')
    fs.seed(`${EP1}/视觉设定.md`, '## ASSET-1 主角')
    const value = await readOverview(toFs(fs), CWD)
    expect(value.episodes[0]!.stage).toBe('develop')
    expect(value.episodes[0]!.documents).toEqual(['剧本.md', '视觉设定.md'])
  })
})

describe('sanitizeEpisodeDocumentPath', () => {
  it('accepts plain episode .md paths', () => {
    expect(sanitizeEpisodeDocumentPath(`${EP1}/分镜.md`)).toBe(`${EP1}/分镜.md`)
  })
  it('rejects traversal / non-episode roots', () => {
    expect(() => sanitizeEpisodeDocumentPath('../x.md')).toThrow('relative')
    expect(() => sanitizeEpisodeDocumentPath('outline.md')).toThrow('episode directory')
    expect(() => sanitizeEpisodeDocumentPath(`${EP1}/x.txt`)).toThrow('.md')
  })
})

describe('readDocument / readEpisode', () => {
  it('returns undefined for absent files', async () => {
    const fs = new MemoryFs()
    await expect(readDocument(toFs(fs), CWD, `${EP1}/分镜.md`)).resolves.toBeUndefined()
  })

  it('serves a document and parses the episode projection', async () => {
    const fs = new MemoryFs()
    for (const [name, body] of Object.entries(docs())) fs.seed(`${EP1}/${name}`, body)
    const doc = await readDocument(toFs(fs), CWD, `${EP1}/分镜.md`)
    expect(doc?.text).toContain('SHOT-001')
    const value = await readEpisode(toFs(fs), CWD, EP1)
    expect(value?.projection.shots).toHaveLength(1)
    expect(value?.projection.visualAssets).toHaveLength(2)
    expect(value?.projection.imagePrompts).toHaveLength(1)
    expect(value?.projection.motions).toHaveLength(1)
    expect(value?.stage).toBe('video-prompts')
  })

  it('returns undefined for an absent episode directory', async () => {
    const fs = new MemoryFs()
    await expect(readEpisode(toFs(fs), CWD, EP1)).resolves.toBeUndefined()
  })

  it('truncates oversize documents at the byte cap without splitting a code point', async () => {
    const fs = new MemoryFs()
    fs.seed(`${EP1}/分镜.md`, `# 分镜\n${'a'.repeat(DOCUMENT_BYTE_CAP)}b`)
    const doc = await readDocument(toFs(fs), CWD, `${EP1}/分镜.md`)
    expect(doc?.truncated).toBe(true)
    expect(new TextEncoder().encode(doc!.text).length).toBeLessThanOrEqual(DOCUMENT_BYTE_CAP)
  })
})

describe('parseEpisodeProjection', () => {
  it('flags duplicate ids and unresolved references', () => {
    const projection = parseProjection({
      '视觉设定.md': '## ASSET-001 主角\n## ASSET-001 主角改\n',
      '分镜.md': '## SHOT-001 x\n引用了 ASSET-999。\n',
    }, EP1)
    expect(projection.diagnostics.some(d => d.code === 'duplicate_id')).toBe(true)
    expect(projection.diagnostics.some(d => d.code === 'unresolved_reference')).toBe(true)
    expect(projection.targets.length).toBeGreaterThan(0)
  })
})

describe('isEpisodeDirectory', () => {
  it('matches episode dirs only', () => {
    expect(isEpisodeDirectory(`${EPISODES_DIR}/EP007`)).toBe(true)
    expect(isEpisodeDirectory(`${EPISODES_DIR}/EP7`)).toBe(false)
  })
})
