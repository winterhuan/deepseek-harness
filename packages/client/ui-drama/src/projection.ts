/**
 * The `short-drama/v1` projection: parse one episode's five creator-first
 * Markdown documents into shots, visual assets, image-prompt entries, motion
 * entries, and navigable diagnostics. This is the READ side of the browser
 * short-drama workbench — it never writes a parallel creator truth, never
 * pre-creates documents, and only reports what the owned Markdown declares.
 *
 * The projection is pure over the document text and is shared by the host
 * routes (which read the files) and the client view (which presents the parsed
 * value). Document grammar follows the Drama Skills 0.6 creator-first contract
 * as adapted by the `drama` agent preset:
 * - `剧本.md` scenes `## EP001-SC001 …`
 * - `视觉设定.md` identification-anchored asset entries (`ASSET-…`)
 * - `分镜.md` `SHOT-*` entries with duration / source / references
 * - `图片提示词.md` `IMG-*` entries with a fenced `可复制提示词` block
 * - `视频提示词.md` `MOTION-*` entries
 * @module @deepseek-ai/dsh-client-ui-drama/projection
 */

/** Protocol version the projection claims to implement. */
export const PRODUCTION_PROTOCOL_VERSION = 'short-drama/v1'

/** A severity tag for one projection diagnostic. */
export type DiagnosticSeverity = 'error' | 'warning'

/** One navigable projection diagnostic. */
export interface ProjectionDiagnostic {
  readonly severity: DiagnosticSeverity
  readonly code: string
  readonly path: string
  readonly line: number
  readonly targetId?: string
  readonly message: string
}

/** A cross-document target the workbench can navigate to. */
export interface ProjectionTarget {
  readonly path: string
  readonly line: number
  readonly id: string
}

/** An `SHOT-*` storyboard entry from `剧集/分镜.md`. */
export interface Shot {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly line: number
  readonly durationSeconds?: number
  readonly source?: string
  readonly purpose?: string
  readonly references: readonly string[]
}

/** A character/scene/prop entry from `剧集/视觉设定.md`. */
export interface VisualAsset {
  readonly id: string
  readonly title: string
  readonly kind: 'character' | 'scene' | 'prop' | 'unknown'
  readonly path: string
  readonly line: number
  readonly stableId: boolean
}

/** An `IMG-*` image-prompt entry from `剧集/图片提示词.md`. */
export interface ImagePrompt {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly line: number
  readonly prompt: string
}

/** A `MOTION-*` motion entry from `剧集/视频提示词.md`. */
export interface MotionPrompt {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly line: number
  readonly shotId?: string
  readonly prompt: string
}

/** The parsed projection for one episode directory. */
export interface EpisodeProjection {
  readonly protocolVersion: typeof PRODUCTION_PROTOCOL_VERSION
  readonly episodeDirectory: string
  readonly documents: readonly string[]
  readonly shots: readonly Shot[]
  readonly visualAssets: readonly VisualAsset[]
  readonly imagePrompts: readonly ImagePrompt[]
  readonly motions: readonly MotionPrompt[]
  readonly targets: ReadonlyArray<readonly [string, ProjectionTarget]>
  readonly diagnostics: readonly ProjectionDiagnostic[]
}

/** The creator Markdown document names, in canonical order. */
export const CREATOR_DOCUMENTS = ['剧本.md', '视觉设定.md', '分镜.md', '图片提示词.md', '视频提示词.md'] as const

/** An episode directory path matcher (`剧集/EPxxx`). */
const EPISODE_RE = /^剧集\/EP\d{3,}$/u

/** Whether a path names an episode directory (`剧集/EPxxx`). */
export function isEpisodeDirectory(path: string): boolean {
  return EPISODE_RE.test(path.replaceAll('\\', '/').replace(/\/+$/, ''))
}

/** One markdown line with its 1-based line number. */
interface Line {
  readonly line: number
  readonly text: string
}

function splitLines(text: string): readonly Line[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((raw, index) => ({ line: index + 1, text: raw }))
}

/** A `#{2,4} <PREFIX>-<ID> <title>` heading extraction. */
function prefixed(text: string, prefix: string): RegExpExecArray | null {
  return new RegExp(`^#{2,4}[ \\t]+(${prefix}-[0-9A-Z-]+)[ \\t]*(.*)$`, 'u').exec(text)
}

/**
 * Parse one episode directory's documents into a projection. Missing
 * documents contribute empty lists; malformed entries and unresolved links
 * surface as diagnostics instead of silent guesses.
 * @param documents - map of document filename to its raw text.
 * @param episodeDirectory - the reporting episode directory path.
 * @returns the parsed episode projection.
 */
export function parseEpisodeProjection(
  documents: Readonly<Record<string, string>>,
  episodeDirectory: string,
): EpisodeProjection {
  const shots: Shot[] = []
  const visualAssets: VisualAsset[] = []
  const imagePrompts: ImagePrompt[] = []
  const motions: MotionPrompt[] = []
  const diagnostics: ProjectionDiagnostic[] = []
  const targetMap = new Map<string, ProjectionTarget>()
  const seen = new Map<string, string>()

  const note = (
    severity: DiagnosticSeverity, code: string, path: string, line: number, message: string, targetId?: string,
  ) => diagnostics.push({
    severity,
    code,
    path,
    line,
    message,
    ...targetId !== undefined ? { targetId } : {},
  })

  const addTarget = (id: string, path: string, line: number): void => {
    if (id.length === 0) return
    if (seen.has(id)) {
      note('error', 'duplicate_id', path, line, `重复 ID ${id}（首次出现在 ${seen.get(id)}）`, id)
      return
    }
    seen.set(id, path)
    targetMap.set(id, { path, line, id })
  }

  // ── 视觉设定.md: `ASSET-…` identification-anchored entries ─────────────
  for (const { line, text } of splitLines(documents['视觉设定.md'] ?? '')) {
    const match = prefixed(text, 'ASSET')
    if (match !== null) {
      const id = match[1] ?? ''
      const title = (match[2] ?? '').trim()
      addTarget(id, '视觉设定.md', line)
      const kind = /地点|场景/u.test(title) ? 'scene'
        : /道具/u.test(title) ? 'prop'
          : /人物|角色/u.test(title) ? 'character' : 'unknown'
      visualAssets.push({ id, title, path: '视觉设定.md', line, kind, stableId: /变体|状态/u.test(title) })
    }
  }

  // ── 分镜.md: `SHOT-…` entries ─────────────────────────────────────────────
  const storyboardText = documents['分镜.md'] ?? ''
  const storyRefs = structuredRefsFrom(storyboardText)
  for (const { line, text } of splitLines(storyboardText)) {
    const match = prefixed(text, 'SHOT')
    if (match !== null) {
      const id = match[1] ?? ''
      const title = (match[2] ?? '').trim()
      addTarget(id, '分镜.md', line)
      const source = /(?:来源|source)[:：][ \t]*(SC\d+)/iu.exec(text)?.[1]
      const durationMatch = /(\d+(?:\.\d+)?)[ \t]*秒/u.exec(text)
      const refs = storyRefs.filter(ref => ref !== id)
      shots.push({
        id, title, path: '分镜.md', line, purpose: title, references: refs,
        ...source !== undefined ? { source } : {},
        ...durationMatch !== null ? { durationSeconds: Number(durationMatch[1]) } : {},
      })
    }
  }

  // ── 图片提示词.md: `IMG-…` entries with a fenced 可复制提示词 block ──────
  let current: ImagePrompt | undefined
  let currentPrompt: string[] = []
  let fence = false
  for (const { line, text } of splitLines(documents['图片提示词.md'] ?? '')) {
    const header = /^#{2,4}[ \t]+(IMG-[0-9A-Za-z-]+)[ \t]*(.*)$/u.exec(text)
    if (header !== null) {
      if (current !== undefined) imagePrompts.push({ ...current, prompt: currentPrompt.join('') })
      const id = header[1] ?? ''
      addTarget(id, '图片提示词.md', line)
      current = { id, title: (header[2] ?? '').trim(), path: '图片提示词.md', line, prompt: '' }
      currentPrompt = []
      fence = false
      continue
    }
    if (current === undefined) continue
    if (/^\s*```/u.test(text)) { fence = !fence; continue }
    if (fence && text.trim() !== '') currentPrompt.push(`${text}\n`)
  }
  if (current !== undefined) imagePrompts.push({ ...current, prompt: currentPrompt.join('') })

  // ── 视频提示词.md: `MOTION-…` entries ─────────────────────────────────────
  for (const { line, text } of splitLines(documents['视频提示词.md'] ?? '')) {
    const header = prefixed(text, 'MOTION')
    if (header !== null) {
      const id = header[1] ?? ''
      const title = (header[2] ?? '').trim()
      addTarget(id, '视频提示词.md', line)
      const shotMatch = /SHOT-([0-9]+[A-Z0-9-]*)/u.exec(title)
      motions.push({
        id, title, path: '视频提示词.md', line, prompt: '',
        ...shotMatch !== null ? { shotId: `SHOT-${shotMatch[1]}` } : {},
      })
    }
  }

  // ── cross-document health ──────────────────────────────────────────────────
  for (const shot of shots) {
    for (const ref of shot.references) {
      if (ref.startsWith('SC') || seen.has(ref)) continue
      note('warning', 'unresolved_reference', '分镜.md', shot.line,
        `镜头 ${shot.id} 引用了未定义的 '${ref}'`, shot.id)
    }
  }
  for (const motion of motions) {
    if (motion.shotId !== undefined && !shots.some(shot => shot.id === motion.shotId)) {
      note('warning', 'unresolved_shot', '视频提示词.md', motion.line,
        `运动提示词 ${motion.id} 指向不存在的镜头 ${motion.shotId}`, motion.id)
    }
  }

  const documentsPresent = CREATOR_DOCUMENTS.filter(name => (documents[name] ?? '') !== '')
  return {
    protocolVersion: PRODUCTION_PROTOCOL_VERSION,
    episodeDirectory,
    documents: documentsPresent,
    shots,
    visualAssets,
    imagePrompts,
    motions,
    targets: [...targetMap.entries()],
    diagnostics,
  }
}

/**
 * Collect every structured cross-document token (`SHOT-`/`IMG-`/`ASSET-`/
 * `MOTION-`) mentioned anywhere in a document body, for unresolved-reference
 * checks. Tokens on their own heading line and their own id are filtered by
 * the caller.
 * @param text - the document body to scan.
 * @returns the ordered structured tokens found.
 */
function structuredRefsFrom(text: string): string[] {
  return [...text.matchAll(/\b(?:SHOT|IMG|ASSET|MOTION)-[0-9]+[A-Z0-9-]*\b/gu)].map(match => match[0])
}
