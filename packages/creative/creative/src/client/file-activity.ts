import type { AssistantChatData, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationTimelineSnapshot,
  PartialAssistant,
  RunningToolCall,
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isCreativeTextPath, parseCreativePath, type CreativeDomain } from '../project-path.ts'

/** The DSH filesystem tool families whose streaming arguments this module projects. */
export type MutationToolName = 'write' | 'edit' | 'str_replace_editor'

/** One live or streaming file mutation observed in the conversation. */
export interface FileMutationActivity {
  readonly callId: string
  readonly name: MutationToolName
  readonly argsRaw: string
  readonly stage: 'streaming' | 'running'
  readonly path: string | undefined
  readonly operation: 'replace-file' | 'replace-text' | 'insert-text' | undefined
  readonly oldText: string | undefined
  readonly newText: string | undefined
  readonly replaceAll: boolean
}

interface JsonStringPrefix {
  readonly value: string
  readonly complete: boolean
}

/** The four workbench panes a workspace path or preference selects. */
export type WorkbenchMode = CreativeDomain

/** Locale key of each workbench pane's display label. */
export const WORKBENCH_LABEL_KEYS: Readonly<Record<WorkbenchMode, 'workbench.story' | 'workbench.drama' | 'workbench.game' | 'workbench.video'>> = {
  story: 'workbench.story',
  drama: 'workbench.drama',
  game: 'workbench.game',
  video: 'workbench.video',
}

/** Minimal file shape the selectors need from the workspace payload. */
export interface WorkspaceFilePath {
  readonly path: string
}

const MUTATING_CALLS = new Set(['write', 'edit', 'str_replace_editor', 'bash', 'run_code', 'creative_role'])

/**
 * Read the latest running Assistant step, including tool-only steps hidden from the Chat list.
 * @param timeline - the assembled conversation timeline snapshot.
 * @returns the newest running assistant step, or `null` when none is running.
 */
export function streamingAssistant(timeline: ConversationTimelineSnapshot): PartialAssistant | null {
  for (const turnNumber of timeline.turnOrder.toReversed()) {
    const turn = timeline.turns.get(turnNumber)
    if (turn === undefined) continue
    for (const step of turn.steps.toReversed()) {
      const assistant: AssistantChatData | undefined = step.data.get('assistant-step')
      if (assistant?.status === 'running') return assistant
    }
  }
  return null
}

function decodeEscape(character: string): string | undefined {
  switch (character) {
    case '"': return '"'
    case '\\': return '\\'
    case '/': return '/'
    case 'b': return '\b'
    case 'f': return '\f'
    case 'n': return '\n'
    case 'r': return '\r'
    case 't': return '\t'
    default: return undefined
  }
}

/**
 * Read a JSON string even while the model is still streaming its closing quote.
 * @param raw - the partial JSON arguments text.
 * @param key - the string property to read.
 * @returns the decoded value so far and whether the closing quote arrived.
 */
export function jsonStringPrefix(raw: string, key: string): JsonStringPrefix | undefined {
  const match = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"\\s*:\\s*"`, 'u').exec(raw)
  if (match === null) return undefined
  let value = ''
  for (let index = match.index + match[0].length; index < raw.length; index += 1) {
    const character = raw[index] ?? ''
    if (character === '"') return { value, complete: true }
    if (character !== '\\') { value += character; continue }
    const escape = raw[index + 1]
    if (escape === undefined) return { value, complete: false }
    if (escape === 'u') {
      const hex = raw.slice(index + 2, index + 6)
      if (!/^[\da-f]{4}$/iu.test(hex)) return { value, complete: false }
      value += String.fromCharCode(Number.parseInt(hex, 16))
      index += 5
      continue
    }
    const decoded = decodeEscape(escape)
    if (decoded === undefined) return { value, complete: false }
    value += decoded
    index += 1
  }
  return { value, complete: false }
}

function completedString(raw: string, key: string): string | undefined {
  const value = jsonStringPrefix(raw, key)
  return value?.complete === true ? value.value : undefined
}

function parsedArgs(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch { return undefined }
}

function mutationFromArgs(name: string, callId: string, argsRaw: string, stage: FileMutationActivity['stage']): FileMutationActivity | undefined {
  const complete = parsedArgs(argsRaw)
  if (name === 'write') {
    return {
      callId, name, argsRaw, stage,
      path: jsonStringPrefix(argsRaw, 'file_path')?.value,
      operation: 'replace-file',
      oldText: undefined,
      newText: jsonStringPrefix(argsRaw, 'content')?.value,
      replaceAll: false,
    }
  }
  if (name === 'edit') {
    return {
      callId, name, argsRaw, stage,
      path: jsonStringPrefix(argsRaw, 'file_path')?.value,
      operation: 'replace-text',
      oldText: completedString(argsRaw, 'old_string'),
      newText: jsonStringPrefix(argsRaw, 'new_string')?.value,
      replaceAll: complete?.replace_all === true,
    }
  }
  if (name !== 'str_replace_editor') return undefined
  const command = completedString(argsRaw, 'command')
  if (command === 'view') return undefined
  const path = jsonStringPrefix(argsRaw, 'path')?.value
  if (command === 'create') {
    return {
      callId, name, argsRaw, stage, path,
      operation: 'replace-file',
      oldText: undefined,
      newText: jsonStringPrefix(argsRaw, 'file_text')?.value,
      replaceAll: false,
    }
  }
  if (command === 'str_replace') {
    return {
      callId, name, argsRaw, stage, path,
      operation: 'replace-text',
      oldText: completedString(argsRaw, 'old_str'),
      newText: jsonStringPrefix(argsRaw, 'new_str')?.value ?? (complete !== undefined ? '' : undefined),
      replaceAll: complete?.replace_all === true,
    }
  }
  if (command === 'insert') {
    return {
      callId, name, argsRaw, stage, path,
      operation: 'insert-text',
      oldText: undefined,
      newText: jsonStringPrefix(argsRaw, 'new_str')?.value,
      replaceAll: false,
    }
  }
  return { callId, name, argsRaw, stage, path, operation: undefined, oldText: undefined, newText: undefined, replaceAll: false }
}

function visitRunning(blocks: readonly ToolCallBlock[], visit: (call: RunningToolCall) => void): void {
  for (const block of blocks) {
    if (!('kind' in block)) visit(block)
    visitRunning(block.subCalls, visit)
  }
}

/** Return every active file mutation in official DSH dispatch order, including nested Code Mode calls. */
/**
 * Return every active file mutation in official DSH dispatch order, including nested Code Mode calls.
 * @param runningCalls - the running tool calls from the conversation snapshot.
 * @param partial - the streaming assistant step, when one is rendering.
 * @returns mutations ordered dispatch-first, streaming calls appended when not already running.
 */
export function fileMutations(
  runningCalls: readonly RunningToolCall[],
  partial: PartialAssistant | null = null,
): FileMutationActivity[] {
  const values: FileMutationActivity[] = []
  visitRunning(runningCalls, (call) => {
    const mutation = mutationFromArgs(call.name, call.callId, call.argsRaw, 'running')
    if (mutation !== undefined) values.push(mutation)
  })
  for (const block of partial?.blocks ?? []) {
    if (block.kind !== 'tool-call') continue
    const value = mutationFromArgs(block.name, block.callId, block.argsRaw, 'streaming')
    if (value !== undefined && !values.some(candidate => candidate.callId === value.callId)) values.push(value)
  }
  return values
}

/**
 * Running calls whose settlement may have changed creative files.
 * @param runningCalls - the running tool calls from the conversation snapshot.
 * @returns their call ids, including nested calls.
 */
export function mutatingCallIds(runningCalls: readonly RunningToolCall[]): ReadonlySet<string> {
  const ids = new Set<string>()
  visitRunning(runningCalls, (call) => { if (MUTATING_CALLS.has(call.name)) ids.add(call.callId) })
  return ids
}

function settledMutationSignals(block: ToolCallBlock): string[] {
  const nested = block.subCalls.flatMap(settledMutationSignals)
  if (!('kind' in block) || block.isError) return nested
  if (block.call === null) return nested
  const mutation = mutationFromArgs(block.call.name, block.callId, block.call.argsRaw, 'running')
  return mutation?.path === undefined ? nested : [`${block.callId}\0${mutation.path}`, ...nested]
}

/**
 * Latest durable successful mutation, used when a fast call skips the live render window.
 * @param chat - the full chat snapshot in dispatch order.
 * @returns the `callId\0path` signal of the newest settled mutation, or `undefined`.
 */
export function latestSettledMutation(chat: ChatSnapshot): string | undefined {
  for (const key of chat.order.toReversed()) {
    const node = chat.nodes.get(key)
    if (node?.kind !== 'tool-call') continue
    const root = (node.data as { readonly root?: ToolCallBlock }).root
    const signal = root === undefined ? undefined : settledMutationSignals(root).at(-1)
    if (signal !== undefined) return signal
  }
  return undefined
}

/**
 * Convert a DSH tool path to the creative-relative path accepted by the narrow route.
 * @param path - the absolute or workspace-relative path a tool call carries.
 * @param cwd - the session working directory that scopes absolute paths.
 * @returns the normalized creative-relative path, or `undefined` outside the
 * creative roots or editable extensions.
 */
export function creativeRelativePath(path: string | undefined, cwd: string | undefined): string | undefined {
  const parsed = parseCreativePath(path, cwd)
  return parsed !== undefined && isCreativeTextPath(parsed) ? parsed.path : undefined
}

/**
 * The workbench pane that owns one workspace path.
 * @param path - workspace-relative path.
 * @returns the owning pane, or `undefined` for non-creative paths.
 */
export function workbenchModeForPath(path: string | undefined): WorkbenchMode | undefined {
  return parseCreativePath(path)?.domain
}

/**
 * Choose the first useful document when a creative workbench opens;
 * stories prefer prose, then outlines, in chapter directories or standalone files.
 * @param files - workspace files to choose from.
 * @param mode - the pane being opened.
 * @returns the highest-preference matching path, or the first match as fallback.
 */
export function preferredWorkbenchFile(
  files: readonly WorkspaceFilePath[],
  mode: WorkbenchMode,
): string | undefined {
  const matching = files.flatMap((file) => {
    const parsed = parseCreativePath(file.path)
    return parsed?.domain === mode ? [{ ...parsed, path: file.path }] : []
  })
  const preferences = mode === 'story'
    ? [/^正文(?:\/.*)?\.md$/u, /^(?:大纲\/.*|小节大纲)\.md$/u, /\.md$/u]
    : mode === 'drama' ? [
      /^剧集\/EP0*1\/剧本\.md$/u,
      /^剧集\/.*\/剧本\.md$/u,
      /^剧集\/EP0*1\/screenplay\.md$/iu,
      /^剧集\/.*\/screenplay\.md$/iu,
      /^项目开发\/creative-brief\.md$/u,
      /^输入\/.*\.md$/u,
      /\.md$/u,
      /^short-drama\.json$/u,
    ] : mode === 'game' ? [
      /^game-adaptations\/[^/]+\/PRODUCT_BRIEF\.md$/u,
      /^game-adaptations\/[^/]+\/design\/GAME_DESIGN\.md$/u,
      /^game-adaptations\/[^/]+\/qa\/verification\.json$/u,
      /^game-adaptations\/[^/]+\/build\/app\/index\.html$/u,
      /\.md$/u,
    ] : [
      /^video-recaps\/[^/]+\/work\/recap_story_plan\.json$/u,
      /^video-recaps\/[^/]+\/work\/narration\.json$/u,
      /^video-recaps\/[^/]+\/work\/assembly_manifest\.json$/u,
    ]
  for (const pattern of preferences) {
    const match = matching.find(file => pattern.test(mode === 'game' || mode === 'video' ? file.path : file.relativePath))
    if (match !== undefined) return match.path
  }
  return matching[0]?.path
}

/**
 * Project one streamed mutation over its immediate predecessor.
 * @param activity - the mutation to apply.
 * @param base - the editor buffer content before the mutation.
 * @returns the projected content, or `undefined` when the mutation cannot be
 * applied to this base.
 */
export function previewMutation(activity: FileMutationActivity, base: string): string | undefined {
  if (activity.operation === 'replace-file') return activity.newText
  if (activity.operation === 'replace-text') {
    if (activity.oldText === undefined || activity.newText === undefined || activity.oldText === '') return undefined
    if (activity.replaceAll) return base.includes(activity.oldText) ? base.split(activity.oldText).join(activity.newText) : undefined
    const at = base.indexOf(activity.oldText)
    return at < 0 ? undefined : `${base.slice(0, at)}${activity.newText}${base.slice(at + activity.oldText.length)}`
  }
  if (activity.operation === 'insert-text') {
    if (activity.newText === undefined) return undefined
    const rawLine = /"insert_line"\s*:\s*(\d+)/u.exec(activity.argsRaw)?.[1]
    if (rawLine === undefined) return undefined
    const line = Number.parseInt(rawLine, 10)
    const parts = base.split('\n')
    const at = Math.max(0, Math.min(parts.length, line))
    parts.splice(at, 0, activity.newText)
    return parts.join('\n')
  }
  return undefined
}
