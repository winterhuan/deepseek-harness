/** Owned Web-profile subprocesses and persisted Session comparisons. */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { parseSessionLog, prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, latestPersistedSessionPaths, materializeProfilePatch,
  normalizeSessionLog, normalizeSessionSnapshots, normalizedSystemPrompts, normalizedToolSchemas, parseSnapshotManifest,
  redactSessionSnapshotIds, scrubSessionSnapshot, stabilizeFixtureMessageIds, stabilizeRefreshLog,
} from '@deepseek-ai/dsh-session-snapshot'
import { expect } from 'vitest'
import { fixtureUserPrompts, normalizeWebSessionVolatiles, recordedSessionFixturePath, type WebSnapshotMode } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

/** The caller owns its world directory; close waits for the Host and provider to exit. */
export interface WebProfileProcess {
  readonly url: string
  /** Return bounded Host diagnostics with authentication tokens removed. */
  output(): string
  /** Stop the process and await resource disposal; repeated calls share completion. */
  close(): Promise<void>
}

/**
 * Start the built dsh Web profile with an isolated Harness home and replay inputs.
 * @param options - owned world directory, profile patch, selected Session and environment.
 * @returns the authenticated browser URL and quiescent cleanup operation.
 */
export async function launchWebProfile(options: {
  readonly world: string
  readonly overlay: string
  readonly fixture: string
  readonly mode: WebSnapshotMode
  readonly env?: NodeJS.ProcessEnv
}): Promise<WebProfileProcess> {
  const subprocess = new Context()
  let fiber: Fiber | undefined
  let host: SubprocessHandle | undefined
  let hostOutput = ''
  let closing: Promise<void> | undefined
  const output = (): string => hostOutput.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
  const close = (): Promise<void> => closing ??= (async () => {
    try {
      if (host !== undefined) {
        host.terminate()
        if (!await host.waitForExit(AbortSignal.timeout(15_000))) throw new Error('Web profile did not stop')
        await host.done
      }
    } finally {
      await fiber?.dispose()
    }
  })()
  try {
    const materializedRoot = join(options.world, '.dsh-profile-patches')
    mkdirSync(materializedRoot, { recursive: true })
    const patch = materializeProfilePatch(
      options.overlay, options.world, 'web', mkdtempSync(join(materializedRoot, 'launch-')), 0,
    )
    fiber = await subprocess.plugin(LocalSubprocessRuntime)
    host = subprocess.subprocess.spawn({
      argv: [process.execPath, join(REPO_ROOT, 'apps/cli/lib/bin.js'), '--profile', 'web', '--patch', patch, '--no-open', '--port', '0'],
      cwd: options.world,
      env: {
        DSH_HOME: join(options.world, '.dsh'),
        DSH_AGENTS_HOME: join(options.world, 'agents'),
        DSH_BUNDLED_SKILL_DIR: join(options.world, 'skills'),
        DSH_TELEMETRY_DISABLED: '1',
        DSH_SNAPSHOT: options.mode,
        DSH_SNAPSHOT_FILE: options.fixture,
        DSH_CREATIVE_SNAPSHOT_ROOT: join(options.world, 'sessions'),
        ...options.env,
      },
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 5_000,
    })
    const ready = Promise.withResolvers<string>()
    const collect = (chunk: Buffer): void => {
      hostOutput = (hostOutput + chunk.toString()).slice(-100_000)
      const url = /dsh web: (http:\/\/[^\s]+)/u.exec(hostOutput)?.[1]
      if (url !== undefined) ready.resolve(url)
    }
    host.stdout?.on('data', collect)
    host.stderr?.on('data', collect)
    const failure = (): Error => new Error(`Web profile did not become ready:\n${output()}`)
    const timer = setTimeout(() => { ready.reject(failure()) }, 60_000)
    const url = await Promise.race([ready.promise, host.done.then(() => { throw failure() })])
      .finally(() => { clearTimeout(timer) })
    return { url, output, close }
  } catch (error) {
    await close()
    throw error
  }
}

/**
 * Compare the completed Session selected by its recorded user prompts.
 * @param options - stopped Host world, selected fixture, serving origin, and snapshot mode.
 * @returns the harvested raw Session for additional event assertions.
 */
export async function compareWebProfileSession(options: {
  readonly world: string
  readonly fixture: string
  readonly mode: WebSnapshotMode
  readonly origin: string
}): Promise<string> {
  let expected = await readFile(options.fixture, 'utf8')
  const prompts = fixtureUserPrompts(expected)
  const root = join(options.world, 'sessions')
  const paths = latestPersistedSessionPaths(await readdir(root, { recursive: true }))
  const sessions = await Promise.all(paths.map(path => readFile(join(root, path), 'utf8')))
  const matching = sessions.filter(log => JSON.stringify(fixtureUserPrompts(log)) === JSON.stringify(prompts))
  expect(matching).toHaveLength(1)
  const raw = matching[0]!
  const actual = normalizeWebSessionVolatiles(raw)
  expect(parseSessionLog(actual).some(event => event.type === 'turn/end')).toBe(true)
  const header = JSON.parse(actual.split('\n')[0]!) as { id: string; version: number }
  const cwd = join(options.world, 'workspace')
  const harnessHome = join(options.world, '.dsh')
  if (options.mode !== 'replay') {
    const prepared = prepareSessionSnapshotFixtureForComparison(actual)
    const stabilized = stabilizeRefreshLog(prepared, expected, [], { sessionIds: [header.id], cwd })
    const scrubbed = scrubSessionSnapshot(stabilized).split(harnessHome).join('{{harnessHome}}')
    const normalized = normalizeSessionLog(scrubbed, { sessionIds: [], cwd: '{{cwd}}' }, { identityMode: 'preserve' })
    expected = redactSessionSnapshotIds(stabilizeFixtureMessageIds([normalized], [expected]))[0]!
    await writeFile(recordedSessionFixturePath(options.fixture, header.version), expected)
  }
  const normalize = (log: string): string | undefined => normalizeSessionSnapshots([log], { sessionIds: [], cwd: '{{cwd}}' })[0]
    ?.split(harnessHome).join('{{harnessHome}}')
  expect(normalize(actual)).toBe(normalize(expected))
  const directory = dirname(options.fixture)
  const manifestPath = join(directory, 'snapshot.yml')
  const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
  if (manifest.header?.pin === true) {
    const context = { sessionIds: [header.id], cwd }
    const prompts = normalizedSystemPrompts(raw, context).map(prompt => prompt
      .split(REPO_ROOT).join('{{sourceRoot}}').split(options.origin).join('{{webUrl}}'))
    const schemas = normalizedToolSchemas(raw, context)
    const sidecars = [
      ['system-prompt.expected.md', formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1))],
      ['tool-schemas.expected.json', formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1))],
    ] as const
    for (const [name, content] of sidecars) {
      const path = join(directory, name)
      if (options.mode !== 'replay') await writeFile(path, content)
      expect(content, name).toBe(await readFile(path, 'utf8'))
    }
  }
  return raw
}
