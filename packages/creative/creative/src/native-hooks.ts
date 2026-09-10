import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { isCreativeTextPath, parseCreativePath, projectPath } from './project-path.ts'

const MUTATION_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])

/** A detected mutation tool call against a `正文/` prose file inside the session workspace. */
export interface StoryMutation {
  readonly root: string
  readonly path: string
  readonly chapter?: number
}

function mutationPath(name: string, args: unknown): string | undefined {
  if (!MUTATION_TOOLS.has(name) || typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  if (name === 'str_replace_editor') {
    if (!new Set(['create', 'str_replace', 'insert']).has(String(record.command))) return undefined
    return typeof record.path === 'string' && record.path.trim() !== '' ? record.path : undefined
  }
  return typeof record.file_path === 'string' && record.file_path.trim() !== '' ? record.file_path : undefined
}

/**
 * Recognize a mutation tool call against a `正文/` prose file from raw arguments.
 * @param name - tool name; only the DSH filesystem mutation families qualify.
 * @param args - tool arguments, accepted in relative, absolute, and URI forms.
 * @param cwd - the calling Agent's session working directory, if any.
 * @returns the detected mutation with workspace-relative path and chapter number,
 * or `undefined` when the call is not a prose mutation.
 */
export function detectStoryMutation(name: string, args: unknown, cwd: string | undefined): StoryMutation | undefined {
  const rawPath = mutationPath(name, args)
  if (cwd === undefined || rawPath === undefined) return undefined
  const parsed = parseCreativePath(rawPath, cwd)
  if (parsed?.role !== 'body' || !isCreativeTextPath(parsed)) return undefined
  const root = projectPath(cwd.replaceAll('\\', '/').replace(/\/$/u, ''), parsed.projectRoot).replace(/\/$/u, '')
  const chapterText = /第0*(\d+)章/u.exec(parsed.relativePath)?.[1]
  return { root, path: parsed.path, ...(chapterText === undefined ? {} : { chapter: Number(chapterText) }) }
}

type StoryFileSystem = Pick<FileSystem, 'resolve' | 'contains' | 'stat' | 'listDir'>

async function storyMutation(exec: ToolExecution, fs: StoryFileSystem): Promise<StoryMutation | undefined> {
  const cwd = exec.agent?.session.header.cwd
  const path = mutationPath(exec.name, exec.arguments)
  if (cwd === undefined || path === undefined) return undefined
  try {
    const [rootTarget, mutationTarget] = await Promise.all([
      fs.resolve(cwd, { signal: exec.signal }),
      fs.resolve(path, { cwd, signal: exec.signal }),
    ])
    if (!fs.contains(rootTarget, mutationTarget)) return undefined
  } catch { return undefined }
  return detectStoryMutation(exec.name, exec.arguments, cwd)
}

async function target(fs: StoryFileSystem, root: string, path: string, signal?: AbortSignal): Promise<FsTarget> {
  const [project, file] = await Promise.all([
    fs.resolve(root, { ...(signal === undefined ? {} : { signal }) }),
    fs.resolve(path, { cwd: root, ...(signal === undefined ? {} : { signal }) }),
  ])
  if (!fs.contains(project, file)) throw new Error('Creative 文档与大纲、追踪状态必须位于同一项目。')
  return file
}

async function exists(fs: StoryFileSystem, root: string, path: string, signal?: AbortSignal): Promise<boolean> {
  return target(fs, root, path, signal)
    .then(value => fs.stat(value, signal))
    .then(info => info !== undefined)
}

async function hasChapterOutline(fs: StoryFileSystem, root: string, chapter: number, signal?: AbortSignal): Promise<boolean> {
  const directory = await target(fs, root, '大纲', signal)
  const entries = await fs.listDir(directory, signal).catch(() => [])
  return entries.some(entry => entry.type === 'file'
    && fs.contains(directory, entry.target)
    && Number(/^细纲_第0*(\d+)章.*\.md$/u.exec(entry.name)?.[1]) === chapter)
}

/**
 * Decide whether one prose mutation may proceed in its long-form project.
 * @param fs - the calling Agent's filesystem.
 * @param mutation - the detected mutation to validate.
 * @param signal - cancellation for filesystem probing.
 * @returns a Chinese deny reason when the committed Tracking state lacks the
 * matching chapter outline, or `undefined` to allow the write.
 */
export async function validateStoryMutation(
  fs: StoryFileSystem,
  mutation: StoryMutation,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const parsed = parseCreativePath(mutation.path)
  if (parsed?.role !== 'body') return undefined
  await target(fs, mutation.root, parsed.relativePath, signal)
  if (parsed.relativePath === '正文.md') return undefined
  const hasLongFormLayout = await exists(fs, mutation.root, '大纲', signal)
    || await exists(fs, mutation.root, '追踪', signal)
  if (!hasLongFormLayout) return undefined
  if (!(await exists(fs, mutation.root, '追踪/_tracking-state.json', signal))) {
    // Setup/import must be able to bootstrap an existing manuscript before the
    // canonical Tracking file exists. The Skill remains responsible for
    // creating it; hard guards begin once the project has committed Tracking.
    return undefined
  }
  if (mutation.chapter !== undefined && !(await hasChapterOutline(fs, mutation.root, mutation.chapter, signal))) {
    return `Creative 阻止写入第 ${String(mutation.chapter)} 章：未找到对应的 大纲/细纲_第XXX章*.md。请先完成细纲。`
  }
  return undefined
}

/**
 * Pre-execute waterfall: deny `正文/` chapter writes whose outline is missing.
 * @param exec - the pending tool execution.
 * @param next - the rest of the pre-execute waterfall.
 * @returns the downstream decision, possibly replaced by a deny.
 */
export async function decideStoryMutation(
  exec: ToolExecution,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  const fs = exec.agent?.ctx.get('fs')
  if (fs === undefined) return next()
  const mutation = await storyMutation(exec, fs)
  if (mutation === undefined) return next()
  const reason = await validateStoryMutation(fs, mutation, exec.signal)
  if (reason !== undefined) return { kind: 'deny', reason }
  return next()
}

/**
 * Post-execute waterfall: after a successful DSH filesystem mutation of
 * `正文/`, attach a plugin-sourced reminder to update Tracking, so the next
 * model request carries it. Failed calls and downstream denies or blocks pass
 * through untouched.
 * @param exec - the finished tool execution.
 * @param result - the tool's outcome; failures never gain a reminder.
 * @param next - the rest of the post-execute waterfall.
 * @returns the downstream decision, possibly with an additional context message.
 */
export async function postStoryMutation(
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
): Promise<PostToolDecision> {
  const downstream = await next()
  if (result.isError || downstream.kind !== 'accept') return downstream
  const fs = exec.agent?.ctx.get('fs')
  const mutation = fs === undefined ? undefined : await storyMutation(exec, fs)
  const parsed = parseCreativePath(mutation?.path)
  if (mutation === undefined || parsed === undefined || parsed.relativePath === '正文.md') return downstream
  const reminder = createUserMessage({
    source: { kind: 'plugin', plugin: 'creative' },
    content: [{
      type: 'text',
      text: `<creative-post-write>正文 ${mutation.path} 已变更。继续当前步骤前核对并更新 ${projectPath(parsed.projectRoot, '追踪/_tracking-state.json')} 及对应派生 Tracking 视图；不要把这条提醒当作用户的新写作要求。</creative-post-write>`,
    }],
  })
  return {
    ...downstream,
    additionalContexts: [...downstream.additionalContexts ?? [], reminder],
  }
}

/**
 * Native DSH equivalents of the upstream prose guards. They join DSH's typed
 * tool waterfall, so decisions remain visible in the official approval/tool UI.
 * @param context - the plugin context receiving the waterfall listeners.
 */
export function registerCreativeHooks(context: Context): void {
  context.on('tools/pre-execute', decideStoryMutation)
  context.on('tools/post-execute', postStoryMutation)
}
