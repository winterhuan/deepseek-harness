import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-shell'
import { defineTool, TOOL_ABORTED, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defaultDramaSkillRoot, defaultVideoRecapSkillRoot } from './skill-provider.ts'
import { currentProduceConfig, resolveProduceEnvs, type ProduceConfig } from './produce-settings.ts'

/** Model-facing tool running one pinned creative production script with forwarded credentials. */
export const CREATIVE_PRODUCE_RUN_TOOL_NAME = 'creative_produce_run'

/** Pinned production scripts this tool may run; anything else is rejected. */
export const PRODUCE_ENTRIES = ['drama', 'video-voiceover', 'video-recap', 'video-doctor'] as const
/** One runnable pinned production script. */
export type ProduceEntry = typeof PRODUCE_ENTRIES[number]

/** Provider adapters the drama entry accepts. */
export const DRAMA_ADAPTERS = ['gpt-image-2', 'minimax-h3', 'minimax-music', 'seedance', 'agnes-image', 'agnes-video'] as const
/** One drama provider adapter. */
export type DramaAdapter = typeof DRAMA_ADAPTERS[number]

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    produce: 'produce'
  }
}

/** Model-supplied argument vector cap: adapters take file-scale input on stdin, not argv. */
const MAX_ARGV_ENTRIES = 64
/** One argument may name a file or carry flags, never a document. */
const MAX_ARGV_ENTRY_CHARS = 8_192
/** Job documents ride stdin; beyond this the caller stages a file instead. */
const MAX_STDIN_BYTES = 1_048_576

/**
 * Script contract error categories worth retrying with the next configured
 * key. These verdicts blame the credential (invalid, forbidden, or exhausted),
 * never the confirmed job — so a sibling key may succeed where this one
 * cannot. Any other failure returns as-is: retrying a bad job, a provider
 * outage, or a timeout with another key risks double work or double spend.
 */
const KEY_FAILOVER_CATEGORIES: ReadonlySet<string> = new Set([
  'authentication',
  'permission',
  'rate_limit',
])

/** Rotation cursor spreading consecutive calls across the resolved key variants. */
let produceKeyRotation = 0

/**
 * Upper bound on foreground attempts within one call. Rotation already spreads
 * consecutive calls across the pool; this bounds one call's worst case when
 * every tried key fails with a key-scoped verdict, so a fully dead pool of
 * thousands cannot spawn thousands of subprocesses before returning.
 */
const MAX_KEY_ATTEMPTS = 16

/**
 * Same-key retries after the pool is exhausted, rate_limit verdicts only. A
 * transient throttle often clears within seconds, so one key earns a couple
 * of spaced retries; authentication and permission failures never re-spend a
 * key the verdict already condemned.
 */
const MAX_SAME_KEY_RETRIES = 2

/** First backoff wait between rate-limit verdicts; doubles per consecutive verdict. */
const FAILOVER_BASE_DELAY_MS = 1000

/** Upper bound on one backoff wait between rate-limit verdicts. */
const FAILOVER_MAX_DELAY_MS = 10000

/**
 * Backoff wait before retrying after consecutive rate-limit verdicts.
 * Attempts within one call are sequential, so no jitter is needed.
 * @param failures - consecutive rate-limit verdicts so far, starting at zero.
 * @param random - zero-to-one sample shaping the wait; injectable for tests.
 * @returns milliseconds to wait, within the base/max bounds.
 */
export function keyFailoverDelayMs(failures: number, random: () => number = Math.random): number {
  const exponential = FAILOVER_BASE_DELAY_MS * 2 ** Math.min(Math.max(failures, 0), 10)
  return Math.min(exponential * (0.75 + 0.5 * random()), FAILOVER_MAX_DELAY_MS)
}

/** The tool-call abort failure, shared by every cancellation point. */
function abortError(): HarnessError {
  const error = new HarnessError('tool call aborted', TOOL_ABORTED)
  error.name = 'AbortError'
  return error
}

/**
 * Wait unless the tool call aborts first.
 * @param delayMs - milliseconds to wait.
 * @param signal - the tool call's abort signal.
 * @returns true when the wait elapsed, false when aborted.
 */
export function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Read the script contract verdict out of foreground stdout, if it parses.
 * @param stdout - the collected standard output.
 * @returns the contract error category, or undefined for success or
 * non-contract output.
 */
export function contractErrorCategory(stdout: string): string | undefined {
  let document: unknown
  try {
    document = JSON.parse(stdout)
  } catch {
    // Non-contract output carries no verdict; only a parsed contract failure can fail over.
    return undefined
  }
  if (typeof document !== 'object' || document === null || !('error' in document)) return undefined
  const error = (document as { readonly error?: unknown }).error
  if (typeof error !== 'object' || error === null || !('category' in error)) return undefined
  const category = (error as { readonly category?: unknown }).category
  return typeof category === 'string' ? category : undefined
}

/** Options for building the produce-run tool. */
export interface ProduceToolOptions {
  /** Composition entry seeding the profile when no settings provider is mounted. */
  readonly entry?: ProduceConfig
}

function scriptFor(entry: Exclude<ProduceEntry, 'drama'>, videoSkillRoot: string): string {
  if (entry === 'video-voiceover') return resolve(videoSkillRoot, 'video-voiceover/scripts/voiceover.py')
  if (entry === 'video-recap') return resolve(videoSkillRoot, 'video-recap/scripts/recap_cli.py')
  return resolve(videoSkillRoot, 'video-recap/scripts/doctor.py')
}

/**
 * Select the drama script for one adapter. Agnes adapters live in their own
 * script beside the pinned upstream file, so the upstream module stays
 * byte-identical to its manifest pin; every other adapter keeps the
 * upstream entry point.
 * @param adapter - the confirmed drama adapter, if the entry takes one.
 * @param dramaSkillRoot - the bundled short-drama skill root.
 * @returns the runnable pinned script.
 */
export function dramaScriptFor(adapter: DramaAdapter | undefined, dramaSkillRoot: string): string {
  if (adapter !== undefined && adapter.startsWith('agnes-')) {
    return resolve(dramaSkillRoot, 'short-drama-produce/scripts/agnes_adapters.py')
  }
  return resolve(dramaSkillRoot, 'short-drama-produce/scripts/provider_adapters.py')
}

/**
 * Quote one argv element for the shell seam without interpreting it.
 * @param value - the raw argument text.
 * @returns the single-quoted shell token.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function checkedArgv(argv: readonly string[] | undefined): string[] {
  const entries = argv ?? []
  if (entries.length > MAX_ARGV_ENTRIES) throw new Error(`creative_produce_run argv holds at most ${String(MAX_ARGV_ENTRIES)} entries.`)
  for (const entry of entries) {
    if (entry === '' || entry.length > MAX_ARGV_ENTRY_CHARS) {
      throw new Error('creative_produce_run argv entries must be non-empty and short; pass documents on stdin.')
    }
  }
  return [...entries]
}

function checkedStdin(stdin: string | undefined): string | undefined {
  if (stdin !== undefined && Buffer.byteLength(stdin) > MAX_STDIN_BYTES) {
    throw new Error('creative_produce_run stdin exceeds 1 MiB; stage the document as a file instead.')
  }
  return stdin
}

function resolveWorkdir(workdir: string | undefined, agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (workdir === undefined) {
    if (cwd === undefined) throw new Error('creative_produce_run needs a session working directory.')
    return cwd
  }
  if (cwd !== undefined && !isAbsolute(workdir)) return resolve(cwd, workdir)
  return workdir
}

/**
 * Build the produce-run tool. Credentials resolve per call from the
 * creative-produce profile; nothing is cached across calls.
 * @param options - composition entry seeding the profile without a settings provider.
 * @returns the registered tool definition.
 */
export function createCreativeProduceRunTool(options: ProduceToolOptions = {}): ToolDefinition {
  const entryConfig = options.entry ?? {}
  return defineTool({
    name: CREATIVE_PRODUCE_RUN_TOOL_NAME,
    description: 'Run one pinned creative production script with the configured credentials forwarded explicitly. Subprocess children start credential-scrubbed, so provider_adapters.py and the video scripts never see ambient keys; this tool resolves the creative-produce profile per call and forwards it as explicit environment. A key field naming several references rotates across them, and one stored value may itself list keys separated by newlines for bulk pools; a foreground run that fails with an authentication, permission, or rate-limit verdict retries with the next key, waiting with exponential backoff between rate-limit verdicts, bounded at sixteen attempts per call. Only call after the creator confirmed the exact current job.',
    parameters: {
      entry: { type: 'string', required: true, enum: PRODUCE_ENTRIES, description: 'Which pinned script runs: drama adapters, video voiceover, recap, or doctor.' },
      adapter: { type: 'string', enum: DRAMA_ADAPTERS, description: 'Required for entry drama: the provider adapter to invoke.' },
      argv: { type: 'array', items: { type: 'string' }, description: 'Arguments after the script and adapter; job documents ride stdin.' },
      stdin: { type: 'string', description: 'Bytes written to the script stdin, e.g. the confirmed job JSON.' },
      workdir: { type: 'string', description: 'Working directory; defaults to the session workspace.' },
      timeoutMs: { type: 'number', description: 'Executor timeout; background runs ignore it.' },
      run_in_background: { type: 'boolean', description: 'Return a produce job id immediately (collect with job_output, stop with job_kill). No timeout applies.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['background', 'foreground'], description: 'How the script ran.' },
          jobId: { type: 'string', description: 'Produce job id; set only for background runs.' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], description: 'Script exit code; set only for foreground runs.' },
          stdout: { type: 'string', description: 'Collected stdout; set only for foreground runs.' },
          stderr: { type: 'string', description: 'Collected stderr; set only for foreground runs.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started produce job ${value.jobId ?? 'unknown'}`
          : `produce exited ${value.exitCode === undefined ? 'unknown' : String(value.exitCode)}\n${value.stdout ?? ''}${value.stderr === undefined || value.stderr === '' ? '' : `\nstderr:\n${value.stderr}`}`,
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('creative_produce_run requires a calling DSH Agent.')
      const agent = exec.agent
      const entry = args.entry
      const adapter = args.adapter
      if (entry === 'drama' && adapter === undefined) throw new Error('creative_produce_run entry drama requires adapter.')
      if (entry !== 'drama' && adapter !== undefined) throw new Error('creative_produce_run adapter applies only to entry drama.')
      const argv = checkedArgv(args.argv)
      const stdin = checkedStdin(args.stdin)
      const dramaSkillRoot = defaultDramaSkillRoot()
      const script = entry === 'drama'
        ? dramaScriptFor(adapter, dramaSkillRoot)
        : scriptFor(entry, defaultVideoRecapSkillRoot())
      const scriptStat = await stat(script).catch(() => undefined)
      if (scriptStat?.isFile() !== true) throw new Error(`creative_produce_run bundled script is missing: ${script}`)
      const shell = agent.ctx.get('shell')
      if (shell === undefined) throw new Error('creative_produce_run requires the DSH shell executor.')
      const section = currentProduceConfig(agent.ctx, entryConfig)
      const envs = await resolveProduceEnvs(agent.ctx, section)
      const start = produceKeyRotation % envs.length
      produceKeyRotation += 1
      const policy = agent.ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
      const workdir = resolveWorkdir(args.workdir, agent)
      const command = ['python3', script, ...(adapter === undefined ? [] : [adapter]), ...argv].map(shellQuote).join(' ')
      const request = {
        command,
        workdir,
        ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
        ...stdin !== undefined ? { stdin } : {},
        ...policy !== undefined ? { sandboxPolicy: policy } : {},
      }
      if (args.run_in_background === true) {
        if (exec.signal.aborted) throw abortError()
        const jobs = agent.ctx.get('jobs')
        if (jobs === undefined) throw new Error('background produce jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        const label = adapter === undefined ? `produce ${entry}` : `produce ${entry}:${adapter}`
        const initial = envs[start]
        /* v8 ignore next -- resolveProduceEnvs always yields at least one environment. */
        if (initial === undefined) throw new Error('creative_produce_run resolved no key environment.')
        const initialEnv = initial
        const jobId = jobs.start({
          kind: 'produce',
          label,
          owner: agent,
          run: () => {
            const proc = shell.start(shell.resolve({ ...request, env: initialEnv }))
            return {
              cancel: () => { proc.kill() },
              done: proc.done.then(() => ({ status: 'completed' as const, detail: `exit code: ${String(proc.exitCode)}` })),
              readOutput: () => proc.readOutput().delta,
            }
          },
        })
        return { kind: 'background' as const, jobId }
      }
      // Distinct keys first, then a couple of spaced same-key retries when only
      // a transient throttle stands between the pool and a result. The first
      // attempt runs immediately; only a rate_limit verdict waits, with an
      // escalating delay, while authentication and permission verdicts move to
      // the next key at once.
      const distinctBudget = Math.min(envs.length, MAX_KEY_ATTEMPTS)
      const runOnce = (env: Record<string, string>) =>
        shell.run(shell.resolve({ ...request, env, signal: exec.signal }))
      let failures = 0
      let offset = 0
      let env = envs[start]
      /* v8 ignore next -- resolveProduceEnvs always yields at least one environment. */
      if (env === undefined) throw new Error('creative_produce_run resolved no key environment.')
      let result = await runOnce(env)
      for (;;) {
        if (result.aborted) throw abortError()
        const category = contractErrorCategory(result.stdout.text)
        const freshLeft = offset + 1 < distinctBudget
        const retriesLeft = offset + 1 < MAX_KEY_ATTEMPTS
        const sameKeyRetry = category === 'rate_limit'
          && !freshLeft
          && offset + 1 - distinctBudget < MAX_SAME_KEY_RETRIES
        if (category === undefined || !KEY_FAILOVER_CATEGORIES.has(category)
          || (!freshLeft && !sameKeyRetry) || !retriesLeft) {
          return {
            kind: 'foreground' as const,
            exitCode: result.exitCode,
            stdout: result.stdout.text,
            stderr: result.stderr.text,
          }
        }
        if (category === 'rate_limit') {
          const waited = await cancellableDelay(keyFailoverDelayMs(failures), exec.signal)
          if (!waited) throw abortError()
          failures += 1
        }
        offset += 1
        const next = envs[(start + offset) % envs.length]
        /* v8 ignore next -- rotation only revisits keys the pool already yielded. */
        if (next === undefined) throw new Error('creative_produce_run resolved no key environment.')
        env = next
        result = await runOnce(env)
      }
    },
  })
}

/**
 * Register the produce-run tool on the tools runtime.
 * @param context - creative plugin context owning the registration.
 * @param options - composition entry seeding the profile without a settings provider.
 */
export function registerCreativeProduceRunTool(context: Context, options: ProduceToolOptions = {}): void {
  context.tools.register(createCreativeProduceRunTool(options))
}
