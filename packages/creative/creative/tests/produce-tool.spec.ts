import { stat } from 'node:fs/promises'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createCreativeProduceRunTool,
  DRAMA_ADAPTERS,
  CREATIVE_PRODUCE_RUN_TOOL_NAME,
  PRODUCE_ENTRIES,
  cancellableDelay,
  contractErrorCategory,
  dramaScriptFor,
  keyFailoverDelayMs,
  registerCreativeProduceRunTool,
  shellQuote,
} from '../src/produce-tool.ts'

vi.mock('node:fs/promises', () => ({ stat: vi.fn() }))

const mockedStat = vi.mocked(stat)

function allowScript(): void {
  mockedStat.mockResolvedValue({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>)
}

function agentWith(services: Record<string, unknown>, cwd: string | undefined = '/work/story'): Agent {
  return {
    session: { header: { cwd } },
    ctx: { get: (name: string) => services[name] },
  } as unknown as Agent
}

function execWith(agent: Agent | undefined, signal = new AbortController().signal): ToolRunContext {
  const callId = 'call-1' as ToolRunContext['callId']
  return {
    agent,
    signal,
    callId,
    rootCallId: callId,
    name: CREATIVE_PRODUCE_RUN_TOOL_NAME,
    arguments: {},
    token: Symbol('tool') as ToolRunContext['token'],
    deferContext: vi.fn(),
  } as unknown as ToolRunContext
}

function shellMock(): {
  shell: {
    resolve: ReturnType<typeof vi.fn>
    run: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
  }
} {
  return {
    shell: {
      resolve: vi.fn((request: unknown) => request),
      run: vi.fn(async () => ({
        aborted: false,
        exitCode: 0,
        stdout: { text: '{"ok":true}', truncated: false },
        stderr: { text: '', truncated: false },
      })),
      start: vi.fn(() => ({
        kill: vi.fn(() => true),
        done: Promise.resolve(),
        exitCode: 0,
        readOutput: () => ({ delta: 'partial', lossy: false, nextOffset: 7 }),
      })),
    },
  }
}

function rateLimited(stdout = '{"error":{"provider":"agnes-video","category":"rate_limit","code":"http_429","retryable":true}}') {
  return {
    aborted: false,
    exitCode: 1,
    stdout: { text: stdout, truncated: false },
    stderr: { text: '', truncated: false },
  }
}

function authFailed() {
  return {
    aborted: false,
    exitCode: 1,
    stdout: {
      text: '{"error":{"provider":"agnes-video","category":"authentication","code":"http_401","retryable":false}}',
      truncated: false,
    },
    stderr: { text: '', truncated: false },
  }
}

/** Run one closure with virtual time, flushing every backoff wait it schedules. */
async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  try {
    const pending = run()
    await vi.advanceTimersByTimeAsync(1_000_000)
    return await pending
  } finally {
    vi.useRealTimers()
  }
}

describe('creative_produce_run', () => {
  beforeEach(() => {
    mockedStat.mockReset()
    allowScript()
  })
  it('advertises the closed entry set and drama adapters', () => {
    const tool = createCreativeProduceRunTool()
    expect(tool.name).toBe(CREATIVE_PRODUCE_RUN_TOOL_NAME)
    expect(PRODUCE_ENTRIES).toEqual(['drama', 'video-voiceover', 'video-recap', 'video-doctor'])
    expect(DRAMA_ADAPTERS).toContain('seedance')
    expect(DRAMA_ADAPTERS).toEqual(expect.arrayContaining(['agnes-image', 'agnes-video']))
    expect(tool.isConcurrencySafe?.({ entry: 'drama', adapter: 'seedance' })).toBe(false)
  })

  it('reads only contract error categories', () => {
    expect(contractErrorCategory('{"error":{"category":"rate_limit"}}')).toBe('rate_limit')
    expect(contractErrorCategory('{"error":{"category":42}}')).toBeUndefined()
    expect(contractErrorCategory('{"outputs":[]}')).toBeUndefined()
    expect(contractErrorCategory('{"error":{}}')).toBeUndefined()
    expect(contractErrorCategory('not json')).toBeUndefined()
  })

  it('routes Agnes adapters to the Agnes script beside the upstream one', async () => {
    const { shell } = shellMock()
    const agent = agentWith({ shell })
    const tool = createCreativeProduceRunTool()
    expect(dramaScriptFor('agnes-video', '/skills')).toContain('agnes_adapters.py')
    expect(dramaScriptFor('seedance', '/skills')).toContain('provider_adapters.py')
    expect(dramaScriptFor(undefined, '/skills')).toContain('provider_adapters.py')
    await tool.execute({ entry: 'drama', adapter: 'agnes-image', argv: [] }, execWith(agent))
    const routed = shell.resolve.mock.calls[0]?.[0] as Record<string, unknown>
    expect(routed.command).toContain('agnes_adapters.py')
    expect(routed.command).toContain("'agnes-image'")
  })

  it('rotates consecutive calls across configured key variants', async () => {
    const { shell } = shellMock()
    const resolve = vi.fn(async (ref: unknown) => ({ value: `key-${String(ref)}`, source: 'store' }))
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_A,AGNES_B' } })
    await tool.execute({ entry: 'drama', adapter: 'agnes-video', argv: [] }, execWith(agent))
    await tool.execute({ entry: 'drama', adapter: 'agnes-video', argv: [] }, execWith(agent))
    const first = shell.resolve.mock.calls[0]?.[0] as { env: Record<string, string> }
    const second = shell.resolve.mock.calls[1]?.[0] as { env: Record<string, string> }
    const used = [first, second].map(call => Object.keys(call.env).find(key => key.startsWith('AGNES_')))
    expect(new Set(used).size).toBe(2)
    expect(used).toEqual(expect.arrayContaining(['AGNES_A', 'AGNES_B']))
  })

  it('fails over to the next key on authentication or rate-limit verdicts', async () => {
    const { shell } = shellMock()
    const resolve = vi.fn(async (ref: unknown) => ({ value: `key-${String(ref)}`, source: 'store' }))
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_A,AGNES_B' } })
    shell.run
      .mockResolvedValueOnce({
        aborted: false,
        exitCode: 1,
        stdout: {
          text: '{"error":{"provider":"agnes-video","category":"rate_limit","code":"http_429","retryable":true}}',
          truncated: false,
        },
        stderr: { text: '', truncated: false },
      })
      .mockResolvedValueOnce({
        aborted: false,
        exitCode: 0,
        stdout: { text: '{"outputs":[]}', truncated: false },
        stderr: { text: '', truncated: false },
      })
    const result = await tool.execute({ entry: 'drama', adapter: 'agnes-video', argv: [] }, execWith(agent))
    expect(shell.run).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ kind: 'foreground', exitCode: 0, stdout: '{"outputs":[]}', stderr: '' })
    const used = shell.resolve.mock.calls.map((call) => {
      const env = (call[0] as { env: Record<string, string> }).env
      return Object.keys(env).find(key => key.startsWith('AGNES_'))
    })
    expect(new Set(used).size).toBe(2)
  })

  it('returns non-key failures without spending another key', async () => {    const { shell } = shellMock()
    const resolve = vi.fn(async (ref: unknown) => ({ value: `key-${String(ref)}`, source: 'store' }))
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_A,AGNES_B' } })
    shell.run.mockResolvedValueOnce({
      aborted: false,
      exitCode: 1,
      stdout: {
        text: '{"error":{"provider":"agnes-video","category":"invalid_request","code":"invalid_job","retryable":false}}',
        truncated: false,
      },
      stderr: { text: '', truncated: false },
    })
    await tool.execute({ entry: 'drama', adapter: 'agnes-video', argv: [] }, execWith(agent))
    expect(shell.run).toHaveBeenCalledTimes(1)
  })

  it('quotes argv elements without interpreting them', () => {
    expect(shellQuote('plain')).toBe("'plain'")
    expect(shellQuote("a'b; rm -rf /")).toBe("'a'\"'\"'b; rm -rf /'")
  })

  it('runs a drama adapter in the foreground with forwarded env', async () => {
    const { shell } = shellMock()
    const agent = agentWith({ shell })
    const tool = createCreativeProduceRunTool({ entry: { seedanceModel: 'seedance-2-5', ttsProvider: 'auto' } })
    const result = await tool.execute(
      { entry: 'drama', adapter: 'seedance', argv: ['--job', 'job.json'], stdin: '{"id":"j1"}' },
      execWith(agent),
    )
    expect(result).toEqual({ kind: 'foreground', exitCode: 0, stdout: '{"ok":true}', stderr: '' })
    const request = shell.resolve.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.command).toContain('provider_adapters.py')
    expect(request.command).toContain("'seedance'")
    expect(request.workdir).toBe('/work/story')
    expect(request.env).toMatchObject({ SEEDANCE_MODEL: 'seedance-2-5', TTS_PROVIDER: 'auto' })
    expect(request.stdin).toBe('{"id":"j1"}')
  })

  it('resolves relative workdir against the session workspace', async () => {
    const { shell } = shellMock()
    const agent = agentWith({ shell })
    const tool = createCreativeProduceRunTool()
    await tool.execute({ entry: 'video-doctor', argv: [], workdir: 'video-recaps/demo' }, execWith(agent))
    const request = shell.resolve.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.workdir).toBe('/work/story/video-recaps/demo')
    expect(request.command).toContain('doctor.py')
  })

  it('resolves absolute workdir, policy, timeout, and every entry script', async () => {
    const { shell } = shellMock()
    const resolvePolicy = vi.fn(() => ({ mode: 'workspace-write' }))
    const agent = agentWith({ shell, sandboxPolicy: { resolve: resolvePolicy } })
    const tool = createCreativeProduceRunTool()
    await tool.execute(
      { entry: 'video-voiceover', argv: ['--help'], workdir: '/abs/studio', timeoutMs: 60_000 },
      execWith(agent),
    )
    const first = shell.resolve.mock.calls[0]?.[0] as Record<string, unknown>
    expect(first.workdir).toBe('/abs/studio')
    expect(first.timeoutMs).toBe(60_000)
    expect(first.sandboxPolicy).toEqual({ mode: 'workspace-write' })
    expect(first.command).toContain('voiceover.py')
    await tool.execute({ entry: 'video-recap', argv: [] }, execWith(agent))
    const second = shell.resolve.mock.calls[1]?.[0] as Record<string, unknown>
    expect(second.command).toContain('recap_cli.py')
  })

  it('starts background jobs through the jobs registry', async () => {
    allowScript()
    const { shell } = shellMock()
    const start = vi.fn((_spec: {
      kind: string
      label: string
      run: () => { cancel: () => void; done: Promise<unknown>; readOutput: () => string }
    }): string => 'produce-1')
    const agent = agentWith({ shell, jobs: { start } })
    const tool = createCreativeProduceRunTool()
    const result = await tool.execute({ entry: 'drama', adapter: 'gpt-image-2', run_in_background: true }, execWith(agent))
    expect(result).toEqual({ kind: 'background', jobId: 'produce-1' })
    const spec = start.mock.calls[0]?.[0]
    expect(spec?.kind).toBe('produce')
    expect(spec?.label).toBe('produce drama:gpt-image-2')
    const hooks = spec?.run()
    expect(hooks?.readOutput()).toBe('partial')
    if (hooks !== undefined) hooks.cancel()
    await expect(hooks?.done).resolves.toEqual({ status: 'completed', detail: 'exit code: 0' })
    const videoStart = vi.fn((_spec: { label: string }): string => 'produce-2')
    const videoAgent = agentWith({ shell, jobs: { start: videoStart } })
    const video = await tool.execute({ entry: 'video-doctor', run_in_background: true }, execWith(videoAgent))
    expect(video).toEqual({ kind: 'background', jobId: 'produce-2' })
    expect(videoStart.mock.calls[0]?.[0]?.label).toBe('produce video-doctor')
  })

  it('rejects calls without an agent, shell, workspace, or jobs', async () => {
    const tool = createCreativeProduceRunTool()
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance' }, execWith(undefined)))
      .rejects.toThrow('requires a calling DSH Agent')
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance' }, execWith(agentWith({}))))
      .rejects.toThrow('requires the DSH shell executor')
    const noCwd = {
      session: { header: {} },
      ctx: { get: (name: string) => name === 'shell' ? shellMock().shell : undefined },
    } as unknown as Agent
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance' }, execWith(noCwd)))
      .rejects.toThrow('working directory')
    await expect(tool.execute(
      { entry: 'video-recap', run_in_background: true },
      execWith(agentWith(shellMock())),
    )).rejects.toThrow('background produce jobs unavailable')
  })

  it('enforces the entry/adapter pairing and argument bounds', async () => {
    allowScript()
    const tool = createCreativeProduceRunTool()
    const exec = execWith(agentWith(shellMock()))
    await expect(tool.execute({ entry: 'drama' }, exec)).rejects.toThrow('requires adapter')
    await expect(tool.execute({ entry: 'video-doctor', adapter: 'seedance' }, exec))
      .rejects.toThrow('applies only to entry drama')
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance', argv: Array.from({ length: 65 }, () => 'x') }, exec))
      .rejects.toThrow('at most 64 entries')
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance', argv: [''] }, exec))
      .rejects.toThrow('non-empty and short')
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance', argv: ['x'.repeat(8_193)] }, exec))
      .rejects.toThrow('non-empty and short')
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance', stdin: 'x'.repeat(1_048_577) }, exec))
      .rejects.toThrow('exceeds 1 MiB')
  })

  it('fails loud when the bundled script is missing', async () => {
    mockedStat.mockResolvedValue({ isFile: () => false } as unknown as Awaited<ReturnType<typeof stat>>)
    const tool = createCreativeProduceRunTool()
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance' }, execWith(agentWith(shellMock()))))
      .rejects.toThrow('bundled script is missing')
    mockedStat.mockRejectedValueOnce(new Error('enoent'))
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance' }, execWith(agentWith(shellMock()))))
      .rejects.toThrow('bundled script is missing')
  })

  it('spaces rate-limit retries with capped exponential backoff', () => {
    expect(keyFailoverDelayMs(0, () => 0)).toBe(750)
    expect(keyFailoverDelayMs(0, () => 1)).toBe(1250)
    expect(keyFailoverDelayMs(3, () => 1)).toBe(10000)
    expect(keyFailoverDelayMs(-2, () => 0)).toBe(750)
    expect(keyFailoverDelayMs(0)).toBeGreaterThanOrEqual(750)
    expect(keyFailoverDelayMs(0)).toBeLessThanOrEqual(1250)
  })

  it('cancels a wait without firing its timer', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(cancellableDelay(1000, controller.signal)).resolves.toBe(false)
  })

  it('caps foreground attempts on a dead bulk pool', async () => {
    const { shell } = shellMock()
    const pool = Array.from({ length: 20 }, (_, index) => `bulk-${String(index)}`).join('\n')
    const resolve = vi.fn(async () => ({ value: pool, source: 'store' }))
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_POOL' } })
    shell.run.mockResolvedValue(rateLimited())
    const result = await withFakeTimers(() => tool.execute(
      { entry: 'drama', adapter: 'agnes-video', argv: [] },
      execWith(agent),
    ))
    expect(shell.run).toHaveBeenCalledTimes(16)
    expect(result).toMatchObject({ kind: 'foreground', exitCode: 1 })
  })

  it('walks fresh keys without waiting on authentication verdicts', async () => {
    const { shell } = shellMock()
    const pool = Array.from({ length: 20 }, (_, index) => `bulk-${String(index)}`).join('\n')
    const resolve = vi.fn(async () => ({ value: pool, source: 'store' }))
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_POOL' } })
    shell.run.mockResolvedValue(authFailed())
    const result = await tool.execute({ entry: 'drama', adapter: 'agnes-video', argv: [] }, execWith(agent))
    expect(shell.run).toHaveBeenCalledTimes(16)
    expect(result).toMatchObject({ kind: 'foreground', exitCode: 1 })
  })

  it('returns one authentication verdict without spending another attempt', async () => {
    const { shell } = shellMock()
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'AGNES_ONLY' ? { value: 'only-key', source: 'store' } : undefined
    })
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_ONLY' } })
    shell.run.mockResolvedValue(authFailed())
    await tool.execute({ entry: 'drama', adapter: 'agnes-video', argv: [] }, execWith(agent))
    expect(shell.run).toHaveBeenCalledTimes(1)
  })

  it('retries one throttled key twice with backoff, then returns', async () => {
    const { shell } = shellMock()
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'AGNES_ONLY' ? { value: 'only-key', source: 'store' } : undefined
    })
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_ONLY' } })
    shell.run.mockResolvedValue(rateLimited())
    const result = await withFakeTimers(() => tool.execute(
      { entry: 'drama', adapter: 'agnes-video', argv: [] },
      execWith(agent),
    ))
    expect(shell.run).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ kind: 'foreground', exitCode: 1 })
  })

  it('aborts a backoff wait', async () => {
    const { shell } = shellMock()
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'AGNES_ONLY' ? { value: 'only-key', source: 'store' } : undefined
    })
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_ONLY' } })
    shell.run.mockResolvedValue(rateLimited())
    const controller = new AbortController()
    vi.useFakeTimers()
    try {
      const pending = tool.execute(
        { entry: 'drama', adapter: 'agnes-video', argv: [] },
        execWith(agent, controller.signal),
      )
      const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(500)
      controller.abort()
      await vi.advanceTimersByTimeAsync(100_000)
      await assertion
      expect(shell.run).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses to wait on an already-aborted call', async () => {
    const { shell } = shellMock()
    const resolve = vi.fn(async (ref: unknown) => {
      return String(ref) === 'AGNES_ONLY' ? { value: 'only-key', source: 'store' } : undefined
    })
    const agent = agentWith({ shell, credentials: { resolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_ONLY' } })
    shell.run.mockResolvedValue(rateLimited())
    const controller = new AbortController()
    controller.abort()
    await expect(tool.execute(
      { entry: 'drama', adapter: 'agnes-video', argv: [] },
      execWith(agent, controller.signal),
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(shell.run).toHaveBeenCalledTimes(1)
  })

  it('classifies aborts as AbortError on both paths', async () => {    const { shell } = shellMock()
    shell.run.mockResolvedValueOnce({
      aborted: true,
      exitCode: null,
      stdout: { text: '', truncated: false },
      stderr: { text: '', truncated: false },
    })
    const tool = createCreativeProduceRunTool()
    const foreground = tool.execute(
      { entry: 'drama', adapter: 'seedance' }, execWith(agentWith({ shell })),
    )
    await expect(foreground).rejects.toMatchObject({ name: 'AbortError' })
    const aborted = new AbortController()
    aborted.abort()
    const background = tool.execute(
      { entry: 'drama', adapter: 'seedance', run_in_background: true },
      execWith(agentWith({ shell }), aborted.signal),
    )
    await expect(background).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('registers through the tools runtime and renders both outcomes', () => {
    const register = vi.fn(() => () => {})
    registerCreativeProduceRunTool({ tools: { register } } as unknown as Context)
    expect(register).toHaveBeenCalledTimes(1)
    const tool = createCreativeProduceRunTool()
    const render = (value: unknown): string | undefined => {
      const blocks = tool.output.render({}, value as never)
      return blocks[0]?.type === 'text' ? blocks[0].text : undefined
    }
    expect(render({ kind: 'background', jobId: 'produce-7' })).toBe('started produce job produce-7')
    expect(render({ kind: 'foreground', exitCode: 0, stdout: 'done', stderr: '' }))
      .toBe('produce exited 0\ndone')
    expect(render({ kind: 'foreground', exitCode: 3, stdout: 'out', stderr: 'boom' }))
      .toBe('produce exited 3\nout\nstderr:\nboom')
    expect(render({ kind: 'background' })).toBe('started produce job unknown')
    expect(render({ kind: 'foreground', exitCode: null })).toBe('produce exited null\n')
    expect(render({ kind: 'foreground' })).toBe('produce exited unknown\n')
  })
})
