import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobStart } from '@deepseek-ai/dsh-jobs'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type { ShellExecRequest, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createCreativeProduceRunTool } from '../src/produce-tool.ts'
import { resolveProduceEnvs, type ProduceConfig } from '../src/produce-settings.ts'

const scripts = fileURLToPath(new URL('../knowledge/drama/skills/short-drama-produce/scripts/', import.meta.url))
const script = join(scripts, 'production_tool.py')
const imageBytes = Buffer.from('\x89PNG\r\n\x1a\nfixture-image', 'latin1')
const videoBytes = Buffer.from('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42', 'latin1')

function python(args: string[], env: NodeJS.ProcessEnv, workdir: string, stdin?: string): Promise<ShellRunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-B', ...args], { env, cwd: workdir, timeout: 15_000, maxBuffer: 1_048_576 }, (error, stdout, stderr) => {
      if (error !== null && (error.killed || error.signal !== null || typeof error.code !== 'number')) {
        reject(new Error('Production contract subprocess did not exit normally', { cause: error }))
        return
      }
      resolve({
        exitCode: error?.code as number | undefined ?? 0,
        signal: null, timedOut: false, aborted: false, timeoutMs: 15_000,
        stdout: { text: stdout, truncated: false },
        stderr: { text: stderr, truncated: false },
      })
    })
    child.stdin?.end(stdin ?? '')
  })
}

async function fixture(run: (project: string, env: NodeJS.ProcessEnv) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'creative-produce-contract-')))
  try {
    const project = join(root, 'project')
    const hooks = join(root, 'hooks')
    await mkdir(project)
    await mkdir(hooks)
    await copyFile(fileURLToPath(new URL('./fixtures/produce-sitecustomize.py', import.meta.url)), join(hooks, 'sitecustomize.py'))
    await writeFile(join(project, 'short-drama.json'), '{}\n')
    await writeFile(join(project, 'input.txt'), 'confirmed source')
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      PYTHONPATH: [hooks, scripts].join(delimiter),
      PYTHONDONTWRITEBYTECODE: '1',
      CREATIVE_TEST_PROJECT: project,
      CREATIVE_TEST_EVENTS: join(root, 'events.jsonl'),
      CREATIVE_TEST_MODE: 'success',
    }
    await writeFile(env.CREATIVE_TEST_EVENTS!, '')
    await run(project, env)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  }
}

async function prepare(project: string, env: NodeJS.ProcessEnv, adapter = 'agnes-image', overrides: Record<string, unknown> = {}): Promise<string> {
  const video = adapter === 'agnes-video'
  const job = {
    job_id: 'JOB-001', adapter, modality: video ? 'video' : 'image',
    prompt: 'confirmed prompt', source: 'input.txt', references: [],
    outputs: [`剧集/EP001/制作成果/output.${video ? 'mp4' : 'png'}`],
    parameters: video ? { duration: 5, ratio: '9:16', resolution: '720P' } : { size: '1K' },
    overwrite: false,
    ...overrides,
  }
  const jobFile = join(project, 'job.json')
  await writeFile(jobFile, JSON.stringify(job))
  const prepared = await python([script, 'prepare', project, '--job', jobFile], env, project)
  expect(prepared.exitCode, prepared.stderr.text).toBe(0)
  const preview = JSON.parse(prepared.stdout.text) as { confirmation: string }
  return preview.confirmation
}

async function confirm(project: string, env: NodeJS.ProcessEnv, confirmation: string): Promise<void> {
  const result = await python([script, 'confirm', project, '--job-id', 'JOB-001', '--confirmation', confirmation], env, project)
  expect(result.exitCode, result.stderr.text).toBe(0)
}

async function events(env: NodeJS.ProcessEnv): Promise<Array<Record<string, unknown>>> {
  return (await readFile(env.CREATIVE_TEST_EVENTS!, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

function toolRuntime(project: string, env: NodeJS.ProcessEnv, profile: ProduceConfig = {}) {
  const run = vi.fn((request: ShellExecRequest) => python([
    '-c', 'import os,shlex,sys; command=shlex.split(sys.argv[1]); os.execv(sys.executable, [sys.executable, *command[1:]])', request.command,
  ], { ...env, ...request.env }, request.workdir ?? project, request.stdin))
  let background: ReturnType<JobStart['run']> | undefined
  const shell = {
    resolve: (request: ShellExecRequest) => request,
    run,
    start: (request: ShellExecRequest) => {
      let exitCode: number | null = null
      let output = ''
      const done = run(request).then((result) => { exitCode = result.exitCode; output = result.stdout.text + result.stderr.text })
      return { done, get exitCode() { return exitCode }, kill: () => false, readOutput: () => ({ delta: output }) }
    },
  }
  const services: Record<string, unknown> = {
    shell,
    launchEnvironment: createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    }]),
    credentials: { resolve: async (ref: unknown) => String(ref) === 'AGNES_POOL' ? { value: 'dummy-first\ndummy-second', source: 'fixture' } : undefined },
    jobs: { start: (spec: JobStart) => { background = spec.run(); return 'produce-fixture' } },
  }
  const agent = { session: { id: 'produce-session', header: { cwd: project } }, ctx: { get: (name: string) => services[name] } } as unknown as Agent
  const exec = { agent, signal: new AbortController().signal } as ToolRunContext
  const tool = createCreativeProduceRunTool({ entry: { agnesApiKeyEnv: 'AGNES_POOL', agnesBaseUrl: 'https://provider.invalid/v1', ...profile } })
  return { tool, exec, run, background: () => background }
}

describe('Creative production TS/Python contract', () => {
  it.each([
    {
      name: 'top-level URL with stale internal status',
      responses: [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', internal_status: 'pending', url: 'https://provider.invalid/video.mp4' }],
    },
    {
      name: 'unrecognized pending status',
      responses: [{ status: 'provider_processing', url: 'https://provider.invalid/not-ready.mp4' }, { status: 'completed', metadata: { url: 'https://provider.invalid/video.mp4' } }],
    },
    {
      name: 'inconclusive response without a status',
      responses: [{}, { status: 'completed', metadata: { url: 'https://provider.invalid/video.mp4' } }],
    },
    {
      name: 'transient polling failures',
      responses: [{ http_error: 429 }, { http_error: 503 }, { network_timeout: true }, { status: 'completed', url: 'https://provider.invalid/video.mp4' }],
    },
  ])('collects the accepted Agnes task after $name without resubmitting', async ({ responses }) => {
    await fixture(async (project, env) => {
      env.CREATIVE_TEST_VIDEO_RESPONSES = JSON.stringify(responses)
      env.AGNES_VIDEO_POLL_INTERVAL = '1'
      await confirm(project, env, await prepare(project, env, 'agnes-video'))
      const { tool, exec, run } = toolRuntime(project, env)
      const result = await tool.execute({ entry: 'drama', adapter: 'agnes-video', job_id: 'JOB-001' }, exec)
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, signal: null })
      expect(run).toHaveBeenCalledTimes(1)
      const history = await events(env)
      expect(history.filter(event => event.method === 'POST')).toHaveLength(1)
      expect(history.filter(event => String(event.url).includes('/agnesapi?'))).toHaveLength(responses.length)
      expect(history.filter(event => String(event.url).includes('/agnesapi?')).every(event => event.url === 'https://provider.invalid/agnesapi?video_id=fixture-video&model_name=agnes-video-2.5-flash')).toBe(true)
      expect(history.filter(event => String(event.url).endsWith('/video.mp4'))).toHaveLength(1)
      expect(await readFile(join(project, '剧集/EP001/制作成果/output.mp4'))).toEqual(videoBytes)
      const status = await python([script, 'status', project, '--job-id', 'JOB-001'], env, project)
      expect(JSON.parse(status.stdout.text)).toMatchObject({ state: 'succeeded', latest_run: { provider_job_id: 'fixture-video', outputs: [{ bytes: videoBytes.length, media_type: 'video/mp4' }] } })
    })
  })

  it.each([
    { response: { status: 'provider_processing', url: 'https://provider.invalid/not-ready.mp4' }, code: 'task_poll_timeout' },
    { response: { http_error: 429 }, code: 'task_poll_timeout' },
    { response: { http_error: 403 }, code: 'http_403' },
    { response: { status: 'failed', url: 'https://provider.invalid/not-ready.mp4' }, code: 'task_failed' },
    { response: { status: 'completed' }, code: 'missing_video_url' },
  ])('retains the accepted Agnes task id after $code and consumes no second confirmation', async ({ response, code }) => {
    await fixture(async (project, env) => {
      env.CREATIVE_TEST_VIDEO_RESPONSES = JSON.stringify([response])
      env.AGNES_VIDEO_POLL_INTERVAL = '1'
      env.AGNES_VIDEO_TIMEOUT_SECONDS = '3'
      await confirm(project, env, await prepare(project, env, 'agnes-video'))
      const { tool, exec } = toolRuntime(project, env)
      const args = { entry: 'drama', adapter: 'agnes-video', job_id: 'JOB-001' }
      const result = await tool.execute(args, exec)
      expect(result).toMatchObject({ exitCode: 2, timedOut: false, signal: null })
      const history = await events(env)
      expect(history.filter(event => event.method === 'POST')).toHaveLength(1)
      expect(history.filter(event => String(event.url).endsWith('.mp4'))).toEqual([])
      await expect(readdir(join(project, '剧集/EP001/制作成果'))).rejects.toMatchObject({ code: 'ENOENT' })
      const status = await python([script, 'status', project, '--job-id', 'JOB-001'], env, project)
      expect(JSON.parse(status.stdout.text)).toMatchObject({ state: 'failed', latest_run: { error: { code, request_id: 'fixture-video' }, outputs: [] } })
      expect(await tool.execute(args, exec)).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('needs a new explicit confirmation') })
      expect(await events(env)).toEqual(history)
    })
  })

  it.each([
    { model: undefined, expected: 'agnes-video-2.5-flash' },
    { model: '   ', expected: 'agnes-video-2.5-flash' },
    { model: 'agnes-video-2.5', expected: 'agnes-video-2.5' },
  ])('resolves the Agnes video model ($model) with three image references', async ({ model, expected }) => {
    await fixture(async (project, env) => {
      if (model !== undefined) env.AGNES_VIDEO_MODEL = model
      const references = ['room.png', 'first-character.png', 'second-character.png']
      for (const reference of references) await writeFile(join(project, reference), imageBytes)
      await confirm(project, env, await prepare(project, env, 'agnes-video', {
        references,
        reference_bindings: references.map((path, index) => ({
          slot_id: `REF-${String(index + 1)}`, order: index + 1, path, label: `参考图${String(index + 1)}`,
          role: 'reference_image', may_control: ['造型'], must_not_control: ['运镜'],
        })),
        parameters: { duration: 8, ratio: '9:16', resolution: '720P' },
      }))
      const { tool, exec } = toolRuntime(project, env)
      const result = await tool.execute({ entry: 'drama', adapter: 'agnes-video', job_id: 'JOB-001' }, exec)
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, signal: null })
      const history = await events(env)
      expect(history.filter(event => event.method === 'POST')).toHaveLength(1)
      expect(history).toContainEqual({
        video: { model: expected, mode: 'reference', seconds: '8', size: '720P', aspect_ratio: '9:16' },
        reference_images: 3,
      })
      expect(await readFile(join(project, '剧集/EP001/制作成果/output.mp4'))).toEqual(videoBytes)
    })
  })

  it.each([
    { name: 'unknown model', profile: { agnesVideoModel: 'agnes-video-unknown' }, parameters: { duration: 8 }, message: 'Agnes video model must be' },
    { name: 'invalid duration', profile: {}, parameters: { duration: 13 }, message: 'Agnes video duration must be an integer from 4 to 12 seconds' },
    { name: 'unsupported parameter', profile: {}, parameters: { fps: 24 }, message: 'unsupported provider parameters: fps' },
    { name: 'flash resolution', profile: {}, parameters: { resolution: '2K' }, message: 'Agnes flash video supports only 720P' },
  ])('rejects $name before consuming confirmation or recording an attempt', async ({ profile, parameters, message }) => {
    await fixture(async (project, env) => {
      await confirm(project, env, await prepare(project, env, 'agnes-video', { parameters }))
      const receipts = join(project, '.short-drama/production/confirmations')
      const receiptPath = join(receipts, (await readdir(receipts))[0]!)
      const receiptBefore = await readFile(receiptPath)
      const { tool, exec } = toolRuntime(project, env, profile)
      const result = await tool.execute({ entry: 'drama', adapter: 'agnes-video', job_id: 'JOB-001' }, exec)
      expect(result).toMatchObject({ exitCode: 2, stderr: expect.stringContaining(message) })
      expect(await events(env)).toEqual([])
      expect(await readFile(receiptPath)).toEqual(receiptBefore)
      const status = await python([script, 'status', project, '--job-id', 'JOB-001'], env, project)
      expect(JSON.parse(status.stdout.text)).toMatchObject({ state: 'confirmed', latest_run: null })
      await expect(readdir(join(project, '剧集/EP001/制作成果'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('runs the offline Python confirmation, locking and retry regressions', async () => {
    await fixture(async (project, env) => {
      const result = await python([join(scripts, 'selftest_bridge.py')], env, project)
      expect(result.exitCode, result.stdout.text + result.stderr.text).toBe(0)
      expect(result.stderr.text).toContain('OK')
    })
  })

  it('exports every renamed credential pool under the name Python consumes', async () => {
    await fixture(async (project, env) => {
      const section: ProduceConfig = {
        openaiApiKeyEnv: 'OPENAI_POOL', arkApiKeyEnv: 'ARK_POOL', minimaxApiKeyEnv: 'MINIMAX_POOL',
        mimoApiKeyEnv: 'MIMO_POOL', fishApiKeyEnv: 'FISH_POOL', agnesApiKeyEnv: 'AGNES_POOL',
      }
      const context = { get: (name: string) => name === 'credentials' ? { resolve: async () => ({ value: 'dummy-first\ndummy-second' }) } : undefined } as unknown as Context
      const variants = await resolveProduceEnvs(context, section)
      for (const variant of variants) {
        const result = await python(['-c', 'import json; from provider_adapters import _credential; names=("OPENAI_API_KEY","ARK_API_KEY","MINIMAX_API_KEY","MIMO_API_KEY","FISH_API_KEY","AGNES_API_KEY"); print(json.dumps([bool(_credential(name)) for name in names]))'], { ...env, ...variant }, project)
        expect(result.exitCode, result.stderr.text).toBe(0)
        expect(JSON.parse(result.stdout.text)).toEqual([true, true, true, true, true, true])
        expect(Object.keys(variant).every(name => name.endsWith('_API_KEY'))).toBe(true)
        expect(result.stdout.text + result.stderr.text).not.toContain('dummy-')
      }
    })
  })

  // Six Python invocations need an outer budget longer than the 15 s child deadline.
  it.each([false, true])('uses one confirmed run with key failover and verified artifacts (background=%s)', async (background) => {
    await fixture(async (project, env) => {
      env.CREATIVE_TEST_MODE = 'auth'
      const confirmation = await prepare(project, env)
      const runtime = toolRuntime(project, env)
      const args = { entry: 'drama', adapter: 'agnes-image', job_id: 'JOB-001', run_in_background: background }
      const denied = await runtime.tool.execute({ ...args, run_in_background: false }, runtime.exec)
      expect(denied).toMatchObject({ kind: 'foreground', exitCode: 2 })
      expect(await events(env)).toEqual([])
      await confirm(project, env, confirmation)
      const result = await runtime.tool.execute(args, runtime.exec)
      if (background) {
        expect(result).toEqual({ kind: 'background', jobId: 'produce-fixture' })
        await expect(runtime.background()?.done).resolves.toMatchObject({ status: 'completed' })
      } else {
        expect(result).toMatchObject({ kind: 'foreground', exitCode: 0, timedOut: false, signal: null })
      }
      const history = await events(env)
      expect(history.filter(event => event.method === 'POST')).toHaveLength(2)
      const runs = new Set(history.filter(event => event.run_id).map(event => event.run_id))
      expect(runs.size).toBe(1)
      const status = await python([script, 'status', project, '--job-id', 'JOB-001'], env, project)
      const recorded = JSON.parse(status.stdout.text) as { latest_run: { outputs: unknown[] } }
      expect(recorded.latest_run.outputs).toEqual([{ path: '剧集/EP001/制作成果/output.png', bytes: imageBytes.length, media_type: 'image/png', sha256: createHash('sha256').update(imageBytes).digest('hex') }])
      expect(await readFile(join(project, '剧集/EP001/制作成果/output.png'))).toEqual(imageBytes)
      const receiptFiles = await readdir(join(project, '.short-drama/production/confirmations'))
      const receipt = JSON.parse(await readFile(join(project, '.short-drama/production/confirmations', receiptFiles[0]!), 'utf8')) as { consumed_at: string; run_id: string }
      expect(receipt.consumed_at).toBeTruthy()
      expect(runs.has(receipt.run_id)).toBe(true)
      const again = await runtime.tool.execute({ ...args, run_in_background: false }, runtime.exec)
      expect(again).toMatchObject({ exitCode: 2 })
      expect(await events(env)).toEqual(history)
      expect(JSON.stringify([result, status])).not.toMatch(/dummy-|AGNES_POOL/)
    })
  }, 30_000)

  it('rejects changed inputs and a mismatched adapter before consuming confirmation', async () => {
    await fixture(async (project, env) => {
      await confirm(project, env, await prepare(project, env))
      const { tool, exec } = toolRuntime(project, env)
      const mismatch = await tool.execute({ entry: 'drama', adapter: 'agnes-video', job_id: 'JOB-001' }, exec)
      expect(mismatch).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('must match the prepared job') })
      await writeFile(join(project, 'input.txt'), 'not confirmed')
      const changed = await tool.execute({ entry: 'drama', adapter: 'agnes-image', job_id: 'JOB-001' }, exec)
      expect(changed).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('inputs changed') })
      expect(await events(env)).toEqual([])
      const receiptFiles = await readdir(join(project, '.short-drama/production/confirmations'))
      expect(JSON.parse(await readFile(join(project, '.short-drama/production/confirmations', receiptFiles[0]!), 'utf8'))).toMatchObject({ consumed_at: null })
    })
  })

  it.each(['timeout', 'poll-auth', 'download-auth', 'invalid-media'])('does not resubmit or publish after %s', async (mode) => {
    await fixture(async (project, env) => {
      env.CREATIVE_TEST_MODE = mode
      const adapter = mode === 'poll-auth' ? 'agnes-video' : 'agnes-image'
      await confirm(project, env, await prepare(project, env, adapter))
      const { tool, exec, run } = toolRuntime(project, env)
      const result = await tool.execute({ entry: 'drama', adapter, job_id: 'JOB-001' }, exec)
      expect(result).toMatchObject({ exitCode: 2 })
      expect(run).toHaveBeenCalledTimes(1)
      expect((await events(env)).filter(event => event.method === 'POST')).toHaveLength(1)
      await expect(readdir(join(project, '剧集/EP001/制作成果'))).rejects.toMatchObject({ code: 'ENOENT' })
      const status = await python([script, 'status', project, '--job-id', 'JOB-001'], env, project)
      expect(JSON.parse(status.stdout.text)).toMatchObject({ state: 'failed', latest_run: { status: 'failed', outputs: [] } })
      expect(JSON.stringify([result, status])).not.toMatch(/dummy-|dummy secret/)
    })
  })

  it('gives the adapter the confirmed snapshot instead of mutable project input', async () => {
    await fixture(async (project, env) => {
      env.CREATIVE_TEST_MODE = 'snapshot'
      await confirm(project, env, await prepare(project, env))
      const { tool, exec } = toolRuntime(project, env)
      const result = await tool.execute({ entry: 'drama', adapter: 'agnes-image', job_id: 'JOB-001' }, exec)
      expect(result).toMatchObject({ exitCode: 0 })
      expect(await events(env)).toContainEqual(expect.objectContaining({ snapshot: true, source: 'confirmed source' }))
      expect(await readFile(join(project, 'input.txt'), 'utf8')).toBe('changed during production')
    })
  })
})
