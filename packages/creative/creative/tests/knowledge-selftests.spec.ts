import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import { describe, expect, it, type TestContext } from 'vitest'

const python = process.platform === 'win32' ? 'python' : 'python3'
const skills = [
  'short-drama',
  'short-drama-assets',
  'short-drama-develop',
  'short-drama-image-prompts',
  'short-drama-novel-analyze',
  'short-drama-produce',
  'short-drama-review',
  'short-drama-storyboard',
  'short-drama-video-prompts',
  'short-drama-write',
]

const networkGuard = `import sys

def reject_network(event, args):
    if event in {"socket.connect", "socket.connect_ex", "socket.bind", "socket.sendto", "socket.getaddrinfo", "urllib.Request", "http.client.connect"}:
        raise RuntimeError("Offline knowledge self-test attempted network access: " + event)

sys.addaudithook(reject_network)
`

async function runSelftest(context: TestContext, args: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-knowledge-selftest-'))
  try {
    await writeFile(join(directory, 'sitecustomize.py'), networkGuard)
    const child = execa(python, ['-B', ...args], {
      cwd: directory,
      cancelSignal: context.signal,
      reject: false,
      stripFinalNewline: false,
      env: {
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: directory,
        PYTHONNOUSERSITE: '1',
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
      },
    })
    context.onTestFinished(async () => {
      child.kill('SIGKILL')
      await child
    })
    const result = await child
    expect(result.timedOut).toBe(false)
    expect(result.isCanceled).toBe(false)
    expect(result.signal).toBeUndefined()
    return result
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('bundled drama offline selftests', () => {
  for (const skill of skills) {
    it(`runs ${skill} with isolated temporary files and no network`, async (context) => {
      const entry = resolve(import.meta.dirname, '../knowledge/drama/skills', skill, 'scripts/selftest.py')
      const result = await runSelftest(context, [entry])
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+ self-tests passed$/u)
    })
  }

  it('rejects network access before opening a connection', async (context) => {
    const result = await runSelftest(context, [
      '-c', 'import socket; socket.socket().connect(("127.0.0.1", 1))',
    ])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Offline knowledge self-test attempted network access: socket.connect')
  })
})
