import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobStart } from '@deepseek-ai/dsh-jobs'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createCreativeProduceRunTool,
  createCreativeProduceStatusTool,
  DRAMA_ADAPTERS,
  CREATIVE_PRODUCE_RUN_TOOL_NAME,
  PRODUCE_ENTRIES,
  dramaScriptFor,
  registerCreativeProduceRunTool,
  shellQuote,
} from '../src/produce-tool.ts'

vi.mock('node:fs/promises', () => ({ stat: vi.fn() }))

const mockedStat = vi.mocked(stat)
const dramaArgs = { entry: 'drama', adapter: 'seedance', job_id: 'SHOT-001' }

function agentWith(services: Record<string, unknown>): Agent {
  return {
    session: { id: 'session-own', header: { cwd: resolve('/work/story') } },
    ctx: { get: (name: string) => services[name] },
  } as unknown as Agent
}

function execWith(agent: Agent | undefined, signal = new AbortController().signal): ToolRunContext {
  const callId = 'call-1' as ToolRunContext['callId']
  return {
    agent, signal, callId, rootCallId: callId,
    name: CREATIVE_PRODUCE_RUN_TOOL_NAME,
    arguments: {},
    token: Symbol('tool') as ToolRunContext['token'],
    deferContext: vi.fn(),
  } as unknown as ToolRunContext
}

function shellMock() {
  return {
    shell: {
      resolve: vi.fn((request: unknown) => request),
      run: vi.fn(async () => ({
        aborted: false, timedOut: false,
        signal: null as NodeJS.Signals | null,
        exitCode: 0 as number | null,
        stdout: { text: '{"state":"succeeded"}', truncated: false },
        stderr: { text: '', truncated: false },
      })),
      start: vi.fn(() => ({
        kill: vi.fn(() => true),
        done: Promise.resolve(),
        exitCode: 0 as number | null,
        readOutput: () => ({ delta: 'partial', lossy: false, nextOffset: 7 }),
      })),
    },
  }
}

describe('creative_produce_run', () => {
  beforeEach(() => {
    mockedStat.mockReset()
    mockedStat.mockResolvedValue({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>)
  })

  it('advertises the closed entry set and drama adapters', () => {
    const tool = createCreativeProduceRunTool()
    expect(tool.name).toBe(CREATIVE_PRODUCE_RUN_TOOL_NAME)
    expect(PRODUCE_ENTRIES).toEqual(['drama', 'video-voiceover', 'video-recap', 'video-doctor'])
    expect(DRAMA_ADAPTERS).toEqual(['gpt-image-2', 'minimax-h3', 'minimax-music', 'seedance', 'agnes-image', 'agnes-video'])
    expect(tool.isConcurrencySafe?.(dramaArgs)).toBe(false)
  })

  it('reports stored Agnes credentials without exposing keys or launching production', async () => {
    const { shell } = shellMock()
    let configured = true
    const secret = 'dummy-agnes-secret'
    const resolveKey = vi.fn(async (ref: unknown) => configured && String(ref) === 'AGNES_POOL'
      ? { value: `${secret}\ndummy-second`, source: 'file' } : undefined)
    const agent = agentWith({
      shell,
      credentials: { resolve: resolveKey },
      settings: { get: () => ({ agnesApiKeyEnv: 'AGNES_POOL' }) },
    })
    const tool = createCreativeProduceStatusTool()
    const result = await tool.execute({}, execWith(agent))
    expect(result).toMatchObject({
      dramaAdapters: expect.arrayContaining([
        { adapter: 'agnes-image', credentialConfigured: true },
        { adapter: 'agnes-video', credentialConfigured: true },
        { adapter: 'gpt-image-2', credentialConfigured: false },
      ]),
    })
    expect(JSON.stringify(result)).not.toMatch(/dummy-|AGNES_POOL/u)
    expect(tool.output.render({}, result as Parameters<typeof tool.output.render>[1]))
      .toEqual([{ type: 'text', text: JSON.stringify(result) }])
    expect(tool.presentCall?.({})).toEqual({ card: 'generic', title: 'creative_produce_status', kind: 'read' })
    expect(tool.isConcurrencySafe?.({})).toBe(true)
    expect(shell.run).not.toHaveBeenCalled()
    expect(shell.start).not.toHaveBeenCalled()
    expect(mockedStat).not.toHaveBeenCalled()
    configured = false
    expect(await tool.execute({}, execWith(agent))).toMatchObject({
      dramaAdapters: expect.arrayContaining([{ adapter: 'agnes-image', credentialConfigured: false }]),
    })
  })

  it('refuses an unaddressed or cancelled status request', async () => {
    const tool = createCreativeProduceStatusTool()
    await expect(tool.execute({}, execWith(undefined))).rejects.toThrow('calling DSH Agent')
    const abort = new AbortController()
    abort.abort()
    await expect(tool.execute({}, execWith(agentWith({}), abort.signal))).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(DRAMA_ADAPTERS)('routes %s production through the confirmed-job executor', async (adapter) => {
    const { shell } = shellMock()
    await createCreativeProduceRunTool().execute({ ...dramaArgs, adapter }, execWith(agentWith({ shell })))
    const request = shell.resolve.mock.calls[0]?.[0] as { command: string; stdin: string }
    expect(request.command).toContain('production_tool.py')
    expect(request.command).toContain(`'run' '.' '--job-id' 'SHOT-001' '--bundled-adapter' '${adapter}' '--credential-pool-stdin'`)
    expect(request.command).not.toContain("'confirm'")
    expect(request.stdin).toBe('[]')
  })

  it('keeps adapter self-tests separate from paid production', async () => {
    const { shell } = shellMock()
    const tool = createCreativeProduceRunTool()
    expect(dramaScriptFor('agnes-video', '/skills')).toContain('agnes_adapters.py')
    expect(dramaScriptFor('seedance', '/skills')).toContain('provider_adapters.py')
    expect(dramaScriptFor(undefined, '/skills')).toContain('provider_adapters.py')
    await tool.execute({ entry: 'drama', adapter: 'agnes-image', argv: ['--selftest'] }, execWith(agentWith({ shell })))
    const request = shell.resolve.mock.calls[0]?.[0] as { command: string; stdin?: string }
    expect(request.command).toContain("agnes_adapters.py' 'agnes-image' '--selftest'")
    expect(request.stdin).toBeUndefined()
    for (const extra of [{ job_id: 'IMAGE-1' }, { stdin: '{}' }, { argv: ['--selftest', 'anything'] }]) {
      await expect(tool.execute({ entry: 'drama', adapter: 'agnes-image', argv: ['--selftest'], ...extra }, execWith(agentWith({ shell })))).rejects.toThrow()
    }
    expect(shell.run).toHaveBeenCalledTimes(1)
  })

  it('rotates canonical keys and sends failover credentials only through stdin', async () => {
    const { shell } = shellMock()
    const credentialResolve = vi.fn(async (ref: unknown) => String(ref) === 'AGNES_POOL'
      ? { value: 'dummy-first\ndummy-second', source: 'store' } : undefined)
    const agent = agentWith({ shell, credentials: { resolve: credentialResolve } })
    const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_POOL' } })
    const results = []
    for (let call = 0; call < 2; call += 1) {
      results.push(await tool.execute({ ...dramaArgs, adapter: 'agnes-image' }, execWith(agent)))
    }
    const requests = shell.resolve.mock.calls.map(([request]) => request as { command: string; stdin: string; env: Record<string, string> })
    expect(new Set(requests.map(request => request.env.AGNES_API_KEY))).toEqual(new Set(['dummy-first', 'dummy-second']))
    for (const request of requests) {
      expect(Object.keys(request.env)).toEqual(['AGNES_API_KEY'])
      expect(JSON.parse(request.stdin)).toEqual([request.env.AGNES_API_KEY, request.env.AGNES_API_KEY === 'dummy-first' ? 'dummy-second' : 'dummy-first'])
      expect(request.command).not.toMatch(/dummy-|AGNES_POOL/)
    }
    expect(JSON.stringify(results)).not.toMatch(/dummy-|AGNES_POOL/)
  })

  it('bounds a large key pool without exposing its contents in argv', async () => {
    const { shell } = shellMock()
    const values = Array.from({ length: 100 }, (_, index) => `dummy-${String(index)}`).join('\n')
    const agent = agentWith({ shell, credentials: { resolve: async () => ({ value: values }) } })
    await createCreativeProduceRunTool().execute(dramaArgs, execWith(agent))
    const request = shell.resolve.mock.calls[0]?.[0] as { command: string; stdin: string }
    expect(JSON.parse(request.stdin)).toHaveLength(16)
    expect(request.command).not.toContain('dummy-')
  })

  it('rejects an oversized credential pool without starting a process', async () => {
    const { shell } = shellMock()
    const agent = agentWith({ shell, credentials: { resolve: async () => ({ value: 'x'.repeat(1_048_577) }) } })
    await expect(createCreativeProduceRunTool().execute(dramaArgs, execWith(agent))).rejects.toThrow('credential pool exceeds 1 MiB')
    expect(shell.run).not.toHaveBeenCalled()
  })

  it.each(['drama', 'video-recap'])('never retries the whole %s command after an adapter failure', async (entry) => {
    const { shell } = shellMock()
    shell.run.mockResolvedValue({
      aborted: false, timedOut: false, signal: null, exitCode: 2,
      stdout: { text: '{"error":{"category":"authentication","submission_rejected":true}}', truncated: false },
      stderr: { text: 'confirmation was consumed', truncated: false },
    })
    const agent = agentWith({ shell, credentials: { resolve: async () => ({ value: 'dummy-a\ndummy-b' }) } })
    const args = entry === 'drama' ? dramaArgs : { entry }
    const result = await createCreativeProduceRunTool().execute(args, execWith(agent))
    expect(result).toMatchObject({ kind: 'foreground', exitCode: 2 })
    expect(shell.run).toHaveBeenCalledTimes(1)
  })

  it.each([
    { exitCode: 0, timedOut: true, signal: null },
    { exitCode: null, timedOut: true, signal: 'SIGTERM' as const },
    { exitCode: null, timedOut: false, signal: 'SIGKILL' as const },
    { exitCode: 0, timedOut: false, signal: null },
  ])('retains each foreground completion fact: %j', async (completion) => {
    const { shell } = shellMock()
    shell.run.mockResolvedValue({
      ...completion, aborted: false,
      stdout: { text: 'out', truncated: false },
      stderr: { text: 'err', truncated: false },
    })
    const result = await createCreativeProduceRunTool().execute(dramaArgs, execWith(agentWith({ shell })))
    expect(result).toEqual({ kind: 'foreground', ...completion, stdout: 'out', stderr: 'err' })
  })

  it('forwards profile settings and preserves video stdin, paths and policy', async () => {
    const { shell } = shellMock()
    const resolvePolicy = vi.fn(() => ({ mode: 'workspace-write' }))
    const agent = agentWith({ shell, sandboxPolicy: { resolve: resolvePolicy } })
    const tool = createCreativeProduceRunTool({ entry: { seedanceModel: 'seedance-2-5', ttsProvider: 'auto' } })
    await tool.execute({ entry: 'video-voiceover', argv: ['--help'], stdin: 'input', workdir: resolve('/abs/studio'), timeoutMs: 60_000 }, execWith(agent))
    const first = shell.resolve.mock.calls[0]?.[0] as Record<string, unknown>
    expect(first).toMatchObject({ workdir: resolve('/abs/studio'), timeoutMs: 60_000, stdin: 'input', sandboxPolicy: { mode: 'workspace-write' } })
    expect(first.env).toEqual({ SEEDANCE_MODEL: 'seedance-2-5', TTS_PROVIDER: 'auto' })
    expect(first.command).toContain('voiceover.py')
    await tool.execute({ entry: 'video-recap' }, execWith(agent))
    expect((shell.resolve.mock.calls[1]?.[0] as Record<string, unknown>).command).toContain('recap.py')
    await tool.execute({ entry: 'video-doctor', workdir: 'video-recaps/demo' }, execWith(agent))
    expect(shell.resolve.mock.calls[2]?.[0]).toMatchObject({ workdir: resolve('/work/story/video-recaps/demo'), command: expect.stringContaining('doctor.py') })
  })

  it('starts background jobs with the same confirmed-job command and pool', async () => {
    const { shell } = shellMock()
    const start = vi.fn((_spec: JobStart) => 'produce-1')
    const agent = agentWith({ shell, jobs: { start } })
    const tool = createCreativeProduceRunTool()
    const result = await tool.execute({ ...dramaArgs, run_in_background: true }, execWith(agent))
    expect(result).toEqual({ kind: 'background', jobId: 'produce-1' })
    const spec = start.mock.calls[0]![0]
    expect(spec).toMatchObject({ kind: 'produce', label: 'produce drama:seedance' })
    const hooks = spec.run()
    // Preparation is asynchronous, so the adapter publishes no process — and
    // therefore no output — until `shell.start` resolves.
    expect(hooks.readOutput?.()).toBe('')
    await Promise.resolve()
    expect(hooks.readOutput?.()).toBe('partial')
    await expect(hooks.done).resolves.toEqual({ status: 'completed', detail: 'exit code: 0' })
    hooks.cancel()
    expect(shell.resolve.mock.calls[0]?.[0]).toMatchObject({ command: expect.stringContaining('production_tool.py'), stdin: '[]' })
    expect(shell.run).not.toHaveBeenCalled()
    await tool.execute({ entry: 'video-doctor', run_in_background: true }, execWith(agent))
    expect(start.mock.calls[1]?.[0]?.label).toBe('produce video-doctor')
  })

  it.each([0, 3, null])('records background exit %s without consuming output', async (exitCode) => {
    const { shell } = shellMock()
    const readOutput = vi.fn(() => ({ delta: 'provider output', lossy: false, nextOffset: 15 }))
    shell.start.mockReturnValue({ kill: vi.fn(() => true), done: Promise.resolve(), exitCode, readOutput })
    const start = vi.fn((_spec: JobStart) => 'produce-1')
    await createCreativeProduceRunTool().execute({ ...dramaArgs, run_in_background: true }, execWith(agentWith({ shell, jobs: { start } })))
    const hooks = start.mock.calls[0]![0].run()
    await expect(hooks.done).resolves.toEqual({ status: exitCode === 0 ? 'completed' : 'failed', detail: `exit code: ${String(exitCode)}` })
    expect(readOutput).not.toHaveBeenCalled()
  })

  it('returns the actual background binding in Native metadata and PTC content', async () => {
    const { shell } = shellMock()
    const start = vi.fn(() => 'produce-8')
    const get = vi.fn(() => ({ id: 'produce-8', startedAt: 81, ownerSession: 'session-own' }))
    const read = vi.fn()
    const agent = agentWith({
      shell, jobs: { start, get, read },
      fs: { resolve: async (path: string) => ({ displayPath: path }), contains: () => true },
    })
    const production = { requestId: 'card-1', episode: '书甲/剧集/EP001', targetId: 'SHOT-001', kind: 'image' }
    const args = { ...dramaArgs, adapter: 'gpt-image-2', run_in_background: true, production }
    const tool = createCreativeProduceRunTool()
    const result = await tool.execute(args, execWith(agent)) as Parameters<typeof tool.output.render>[1]
    const binding = { ...production, job: { jobId: 'produce-8', startedAt: 81 } }
    expect(result).toEqual({ kind: 'background', jobId: 'produce-8', production: binding })
    expect(tool.output.presentationMeta?.(args, result)).toEqual({ production: binding })
    expect(tool.output.render(args, result)).toEqual([{ type: 'text', text: JSON.stringify({ production: binding }) }])
    expect(read).not.toHaveBeenCalled()
    await expect(tool.execute({ ...args, run_in_background: false }, execWith(agent))).rejects.toThrow('run_in_background')
    await expect(tool.execute({ entry: 'drama', adapter: 'gpt-image-2', run_in_background: true, production, argv: ['--selftest'] }, execWith(agent))).rejects.toThrow('diagnostics')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('requires a prepared job and rejects replacement arguments before starting', async () => {
    const { shell } = shellMock()
    const tool = createCreativeProduceRunTool()
    const exec = execWith(agentWith({ shell }))
    await expect(tool.execute({ entry: 'drama', adapter: 'seedance' }, exec)).rejects.toThrow('confirmed job_id')
    for (const job_id of ['', '../other', 'x'.repeat(81)]) {
      await expect(tool.execute({ ...dramaArgs, job_id }, exec)).rejects.toThrow('confirmed job_id')
    }
    await expect(tool.execute({ ...dramaArgs, stdin: '{}' }, exec)).rejects.toThrow('cannot replace')
    await expect(tool.execute({ ...dramaArgs, argv: ['--adapter-config', 'override.json'] }, exec)).rejects.toThrow('cannot replace')
    await expect(tool.execute({ entry: 'video-doctor', job_id: 'SHOT-001' }, exec)).rejects.toThrow('only to drama production')
    expect(shell.run).not.toHaveBeenCalled()
  })

  it('rejects missing services and unsafe argument sizes', async () => {
    const tool = createCreativeProduceRunTool()
    await expect(tool.execute(dramaArgs, execWith(undefined))).rejects.toThrow('requires a calling DSH Agent')
    await expect(tool.execute(dramaArgs, execWith(agentWith({})))).rejects.toThrow('requires the DSH shell executor')
    const noCwd = { session: { header: {} }, ctx: { get: (name: string) => name === 'shell' ? shellMock().shell : undefined } } as unknown as Agent
    await expect(tool.execute(dramaArgs, execWith(noCwd))).rejects.toThrow('working directory')
    const exec = execWith(agentWith(shellMock()))
    await expect(tool.execute({ entry: 'video-recap', run_in_background: true }, exec)).rejects.toThrow('background produce jobs unavailable')
    await expect(tool.execute({ entry: 'drama' }, exec)).rejects.toThrow('requires adapter')
    await expect(tool.execute({ entry: 'video-doctor', adapter: 'seedance' }, exec)).rejects.toThrow('only to entry drama')
    await expect(tool.execute({ ...dramaArgs, argv: Array.from({ length: 65 }, () => 'x') }, exec)).rejects.toThrow('at most 64 entries')
    for (const argument of ['', 'x'.repeat(8_193)]) {
      await expect(tool.execute({ ...dramaArgs, argv: [argument] }, exec)).rejects.toThrow('non-empty and short')
    }
    await expect(tool.execute({ ...dramaArgs, stdin: 'x'.repeat(1_048_577) }, exec)).rejects.toThrow('exceeds 1 MiB')
    expect(shellQuote("a'b")).toBe("'a'\"'\"'b'")
  })

  it('fails loud when the bundled script is missing', async () => {
    const tool = createCreativeProduceRunTool()
    const exec = execWith(agentWith(shellMock()))
    mockedStat.mockResolvedValue({ isFile: () => false } as unknown as Awaited<ReturnType<typeof stat>>)
    await expect(tool.execute(dramaArgs, exec)).rejects.toThrow('bundled script is missing')
    mockedStat.mockRejectedValueOnce(new Error('enoent'))
    await expect(tool.execute(dramaArgs, exec)).rejects.toThrow('bundled script is missing')
  })

  it('classifies aborts without retrying or starting an already-aborted call', async () => {
    const { shell } = shellMock()
    const tool = createCreativeProduceRunTool()
    shell.run.mockResolvedValue({ aborted: true, timedOut: false, signal: 'SIGTERM', exitCode: null, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } })
    await expect(tool.execute(dramaArgs, execWith(agentWith({ shell })))).rejects.toMatchObject({ name: 'AbortError' })
    const aborted = new AbortController()
    aborted.abort()
    for (const run_in_background of [false, true]) {
      await expect(tool.execute({ ...dramaArgs, run_in_background }, execWith(agentWith({ shell }), aborted.signal))).rejects.toMatchObject({ name: 'AbortError' })
    }
    expect(shell.run).toHaveBeenCalledTimes(1)
    expect(shell.start).not.toHaveBeenCalled()
  })

  it('registers through the tools runtime and renders terminal facts independently', () => {
    const register = vi.fn(() => () => {})
    registerCreativeProduceRunTool({ tools: { register } } as unknown as Context)
    expect(register).toHaveBeenCalledTimes(2)
    const tool = createCreativeProduceRunTool()
    const render = (value: unknown): string | undefined => {
      const blocks = tool.output.render({}, value as never)
      return blocks[0]?.type === 'text' ? blocks[0].text : undefined
    }
    expect(render({ kind: 'background', jobId: 'produce-7' })).toBe('started produce job produce-7')
    expect(render({ kind: 'foreground', exitCode: 0, timedOut: false, signal: null, stdout: 'done', stderr: '' })).toBe('produce exited 0\ndone')
    expect(render({ kind: 'foreground', exitCode: 0, timedOut: true, signal: 'SIGTERM', stdout: 'partial' })).toBe('produce exited 0\nproduce timed out\nsignal: SIGTERM\npartial')
    expect(render({ kind: 'foreground', exitCode: 3, stdout: 'out', stderr: 'boom' })).toBe('produce exited 3\nout\nstderr:\nboom')
    expect(render({ kind: 'background' })).toBe('started produce job unknown')
    expect(render({ kind: 'foreground', exitCode: null })).toBe('produce exited null\n')
    expect(render({ kind: 'foreground' })).toBe('produce exited unknown\n')
    expect(tool.output.presentationMeta?.({}, { kind: 'foreground' } as never)).toEqual({})
  })
})
