/** Pure project discovery shared by the workspace API, writing guards, and Client. */

/** Supported creative domains. */
export type CreativeDomain = 'story' | 'drama' | 'game' | 'video'

/** Story directories recognized at the workspace or book root. */
export const STORY_DIRECTORIES = ['正文', '大纲', '设定', '追踪', '对标', '参考资料'] as const
/** Drama directories recognized at the workspace or book root. */
export const DRAMA_DIRECTORIES = ['输入', '项目开发', '设定集', '剧集', '交付', '创作者决策', '审查'] as const
/** Optional containers whose immediate children are books. */
export const BOOK_CONTAINERS = ['长篇', '短篇'] as const
/** Standalone documents at a project root. */
export const PROJECT_FILES = ['short-drama.json', '正文.md', '设定.md', '小节大纲.md'] as const
/** Root discovery order keeps small preview manifests ahead of large manuscripts. */
export const CREATIVE_DIRECTORIES = ['video-recaps', 'game-adaptations', '拆文库', ...STORY_DIRECTORIES, ...DRAMA_DIRECTORIES] as const

const storyDirectories = new Set<string>(STORY_DIRECTORIES)
const dramaDirectories = new Set<string>(DRAMA_DIRECTORIES)
const projectFiles = new Set<string>(PROJECT_FILES)
const creatorDocuments = new Set(['剧本.md', '视觉设定.md', '分镜.md', '图片提示词.md', '视频提示词.md'])
const mediaTypes: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'], ['.mkv', 'video/x-matroska'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.m4a', 'audio/mp4'],
])

/** A normalized workspace path with its owning project and document role. */
export interface CreativeProjectPath {
  readonly path: string
  /** Workspace-relative project root; the empty string denotes the workspace itself. */
  readonly projectRoot: string
  readonly relativePath: string
  readonly domain: CreativeDomain
  readonly role: 'body' | 'outline' | 'tracking' | 'drama-config' | 'creator-document' | 'episode' | 'document'
  /** Full episode path, also attached to that episode's delivery files. */
  readonly episodePath?: string | undefined
}

/** Project-local metadata returned by the workspace API. */
export interface CreativeProjectSummary {
  readonly root: string
  readonly domains: readonly CreativeDomain[]
  readonly tracking: unknown
  readonly shortDrama: unknown
  readonly metadataErrors: readonly string[]
}

function pathText(raw: string): string | undefined {
  const path = raw.replaceAll('\\', '/')
  if (!path.startsWith('file:')) return path
  try {
    const url = new URL(path)
    if (url.search !== '' || url.hash !== '') return undefined
    const pathname = decodeURIComponent(url.pathname)
    return url.hostname !== '' && url.hostname !== 'localhost'
      ? `//${url.hostname}${pathname}`
      : pathname.replace(/^\/([a-z]:\/)/iu, '$1')
  } catch {
    return undefined
  }
}

/**
 * Normalize a relative path or a path inside the supplied workspace, without filesystem access.
 * @param raw - native path or URI from a tool, file opener, or workspace request.
 * @param cwd - workspace root required for absolute paths and URIs.
 * @returns a relative path, or undefined for invalid paths and workspace escapes.
 */
export function workspaceRelativePath(raw: string | undefined, cwd?: string): string | undefined {
  if (raw === undefined || raw === '' || raw.includes('\0')) return undefined
  const candidate = pathText(raw)
  const root = cwd === undefined ? undefined : pathText(cwd)?.replace(/\/+$/u, '')
  if (candidate === undefined) return undefined
  const absolute = candidate.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(candidate)
  let relative = candidate
  if (absolute) {
    if (root === undefined) return undefined
    const windows = /^[a-z]:\//iu.test(root) || root.startsWith('//')
    const inside = windows ? candidate.toLowerCase().startsWith(`${root.toLowerCase()}/`) : candidate.startsWith(`${root}/`)
    if (!inside) return undefined
    relative = candidate.slice(root.length + 1)
  }
  const segments: string[] = []
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return undefined
      segments.pop()
    } else {
      if (segment.startsWith('.')) return undefined
      segments.push(segment)
    }
  }
  return segments.length === 0 ? undefined : segments.join('/')
}

function domainForLeaf(leaf: string, single: boolean): CreativeDomain | undefined {
  if (storyDirectories.has(leaf) || leaf === '拆文库') return 'story'
  if (dramaDirectories.has(leaf)) return 'drama'
  if (single && projectFiles.has(leaf)) return leaf === 'short-drama.json' ? 'drama' : 'story'
  return undefined
}

/**
 * Resolve only supported root, single-book, and container/book layouts.
 * @param raw - file or directory path, optionally absolute or a URI.
 * @param cwd - workspace root used to scope absolute paths.
 * @returns project identity and role, or undefined outside the supported layouts.
 */
export function parseCreativePath(raw: string | undefined, cwd?: string): CreativeProjectPath | undefined {
  const path = workspaceRelativePath(raw, cwd)
  if (path === undefined) return undefined
  const segments = path.split('/')
  const [first = ''] = segments
  if (first === 'game-adaptations' || first === 'video-recaps') {
    return {
      path,
      projectRoot: segments.slice(0, 2).join('/'),
      relativePath: segments.slice(2).join('/'),
      domain: first === 'game-adaptations' ? 'game' : 'video',
      role: 'document',
    }
  }
  let prefix = 0
  let leaf = first
  let domain = domainForLeaf(first, segments.length === 1)
  if (domain === undefined) {
    prefix = BOOK_CONTAINERS.some(container => container === first) ? 2 : 1
    leaf = segments[prefix] ?? ''
    if (leaf === '拆文库') return undefined
    domain = domainForLeaf(leaf, segments.length === prefix + 1)
  }
  if (domain === undefined) return undefined
  const projectRoot = segments.slice(0, prefix).join('/')
  const body = segments.slice(prefix)
  const relativePath = body.join('/')
  const episode = (leaf === '剧集' || leaf === '交付') && /^EP\d{3,}$/u.test(body[1] ?? '') ? body[1] : undefined
  const episodePath = episode === undefined ? undefined : projectPath(projectRoot, `剧集/${episode}`)
  const role = leaf === '正文' || leaf === '正文.md' ? 'body'
    : leaf === '大纲' || leaf === '小节大纲.md' ? 'outline'
      : leaf === '追踪' ? 'tracking'
        : leaf === 'short-drama.json' ? 'drama-config'
          : leaf === '剧集' && episode !== undefined && body.length === 3 && creatorDocuments.has(body[2] ?? '') ? 'creator-document'
            : episode !== undefined && body.length === 2 ? 'episode' : 'document'
  return { path, projectRoot, relativePath, domain, role, episodePath }
}

/**
 * Join a known project root to one project-relative path.
 * @param root - workspace-relative root, empty for a workspace project.
 * @param relativePath - path inside the project.
 * @returns the full workspace-relative path.
 */
export function projectPath(root: string, relativePath: string): string {
  return root === '' ? relativePath : `${root}/${relativePath}`
}

/**
 * Apply the text-extension policy for a parsed creative path.
 * @param path - recognized project path.
 * @returns whether the workbench can edit this file as text.
 */
export function isCreativeTextPath(path: CreativeProjectPath): boolean {
  if (/\.(?:md|txt|json|jsonl)$/iu.test(path.path)) return true
  if (path.domain === 'game') return /\.(?:html|css|[cm]?js|tsx?|jsx)$/iu.test(path.path)
  return path.domain === 'video' && /\.(?:srt|ass)$/iu.test(path.path)
}

/**
 * Resolve the shared media-extension allowlist without filesystem access.
 * @param path - File path whose final extension determines its media type.
 * @returns The preview MIME type, or undefined for unsupported files.
 */
export function creativeMediaMimeType(path: string): string | undefined {
  return mediaTypes.get(path.slice(path.lastIndexOf('.')).toLowerCase())
}
