import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it, type TestContext } from 'vitest'

const knowledge = resolve(import.meta.dirname, '../knowledge/creative')
const python = process.platform === 'win32' ? 'python' : 'python3'
const qualitySkills = ['story-deslop', 'story-long-write', 'story-review', 'story-short-write']
const trackingSkills = ['story-import', 'story-long-write', 'story-review']
const cleanProse = '她推开木门，把篮子放在桌边。\n'

function script(skill: string, filename: string): string {
  return join(knowledge, 'skills', skill, 'scripts', filename)
}

async function workspace(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-knowledge-novel-'))
  context.onTestFinished(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function run(context: TestContext, cwd: string, command: string, args: string[]) {
  const child = execa(command, args, {
    cwd,
    cancelSignal: context.signal,
    reject: false,
    stripFinalNewline: false,
    env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
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
}

describe('bundled novel executable scripts', () => {
  it('runs compatible entrypoints from a relocated novel knowledge bundle', async (context) => {
    const cwd = await workspace(context)
    const bundled = join(cwd, 'knowledge/creative')
    await cp(knowledge, bundled, { recursive: true })
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n')
    await writeFile(join(cwd, '正文.md'), cleanProse)
    const checked = await run(context, cwd, process.execPath, [
      join(bundled, 'skills/story-short-write/scripts/check-ai-patterns.js'), '--check', '--json', '正文.md',
    ])
    expect(checked.exitCode, checked.stderr).toBe(0)
    expect(JSON.parse(checked.stdout)).toEqual({ findings: [] })
    const initialized = await run(context, cwd, python, [
      '-B', join(bundled, 'skills/story-review/scripts/author_memory_commit.py'), 'init', '--workspace', cwd,
    ])
    expect(initialized.exitCode, initialized.stderr).toBe(0)
    expect(JSON.parse(initialized.stdout)).toMatchObject({ ok: true })
  })

  for (const skill of qualitySkills) {
    for (const [filename, blockedProse] of [
      ['check-ai-patterns.js', '这不是归途，而是牢笼。\n'],
      ['check-degeneration.js', 'TODO：补完这一段。\n'],
    ] as const) {
      it(`${skill}/${filename} distinguishes clean prose, findings, and unreadable input`, async (context) => {
        const cwd = await workspace(context)
        const body = join(cwd, '正文.md')
        const args = [script(skill, filename), '--check', '--json', '--fail-on=blocking', body]
        await writeFile(body, cleanProse)
        const clean = await run(context, cwd, process.execPath, args)
        expect(clean.exitCode, clean.stderr).toBe(0)
        expect(JSON.parse(clean.stdout)).toEqual({ findings: [] })
        await writeFile(body, blockedProse)
        const blocked = await run(context, cwd, process.execPath, args)
        expect(blocked.exitCode, blocked.stderr).toBe(1)
        expect(JSON.parse(blocked.stdout).findings).toEqual(expect.arrayContaining([
          expect.objectContaining({ severity: 'blocking' }),
        ]))
        expect(await readFile(body, 'utf8')).toBe(blockedProse)
        await rm(body)
        const missing = await run(context, cwd, process.execPath, args)
        expect(missing.exitCode).toBe(2)
      })
    }

    it(`${skill} checks punctuation without writing, then normalizes it through the same entrypoint`, async (context) => {
      const cwd = await workspace(context)
      const body = join(cwd, '正文.md')
      const original = '她停下——推开门。\n'
      const entry = script(skill, 'normalize-punctuation.js')
      await writeFile(body, original)
      const checked = await run(context, cwd, process.execPath, [entry, '--check', body])
      expect(checked.exitCode, checked.stderr).toBe(1)
      expect(await readFile(body, 'utf8')).toBe(original)
      const normalized = await run(context, cwd, process.execPath, [entry, body])
      expect(normalized.exitCode, normalized.stderr).toBe(0)
      expect(await readFile(body, 'utf8')).not.toContain('——')
      const clean = await run(context, cwd, process.execPath, [entry, '--check', body])
      expect(clean.exitCode, clean.stderr).toBe(0)
    })
  }

  for (const skill of ['story-long-write', 'story-short-write']) {
    it(`${skill} keeps outline-copy findings separate from read failures`, async (context) => {
      const cwd = await workspace(context)
      const body = join(cwd, '正文.md')
      const outline = join(cwd, '小节大纲.md')
      const prose = '远处的老人背着竹篓沿着河岸慢慢走了过来。\n'
      await writeFile(body, prose)
      await writeFile(outline, prose)
      const args = [script(skill, 'check-outline-copy.js'), '--outline', outline, body]
      const overlap = await run(context, cwd, process.execPath, args)
      expect(overlap.exitCode, overlap.stderr).toBe(1)
      expect(overlap.stdout).toContain('细纲照搬检测')
      await rm(outline)
      const missing = await run(context, cwd, process.execPath, args)
      expect(missing.exitCode).toBe(2)
      expect(missing.stderr).toContain('ENOENT')
      const optional = await run(context, cwd, process.execPath, [script(skill, 'check-outline-copy.js'), body])
      expect(optional.exitCode, optional.stderr).toBe(0)
    })
  }

  for (const [skill, filename, args] of [
    ['story-import', 'check-outline-contract.js', ['--json', 'missing.md']],
    ['story-long-write', 'check-outline-contract.js', ['--json', 'missing.md']],
    ['story-short-write', 'check-phase2-contract.js', ['--json']],
    ['story-short-write', 'check-delivery-contract.js', ['--json', '--min-chars', '1', '--max-chars', '20', '--sections', '1']],
  ] as const) {
    it(`${skill}/${filename} runs as an ESM CLI and remains importable`, async (context) => {
      const cwd = await workspace(context)
      const entry = script(skill, filename)
      const result = await run(context, cwd, process.execPath, [entry, ...args])
      expect(result.exitCode, result.stderr).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false })
      const imported = await run(context, cwd, process.execPath, [
        '--input-type=module', '-e',
        `const loaded = await import(${JSON.stringify(pathToFileURL(entry).href)}); console.log(typeof loaded.verify)`,
      ])
      expect(imported.exitCode, imported.stderr).toBe(0)
      expect(imported.stdout.trim()).toBe('function')
    })
  }

  it('shares author memory across every skill-local CLI', async (context) => {
    const cwd = await workspace(context)
    const initialized = await run(context, cwd, python, [
      '-B', script('story', 'author_memory_commit.py'), 'init', '--workspace', cwd,
    ])
    expect(initialized.exitCode, initialized.stderr).toBe(0)
    for (const skill of ['story', ...qualitySkills]) {
      const checked = await run(context, cwd, python, [
        '-B', script(skill, 'author_memory_commit.py'), 'check', '--workspace', cwd,
      ])
      expect(checked.exitCode, checked.stderr).toBe(0)
      expect(JSON.parse(checked.stdout)).toMatchObject({ ok: true, command: 'check' })
    }
  })

  it('loads wordcount through each compatible Python module path', async (context) => {
    const cwd = await workspace(context)
    for (const skill of trackingSkills) {
      const result = await run(context, cwd, python, ['-B', '-c', [
        'import json, runpy, sys',
        'module = runpy.run_path(sys.argv[1])',
        'print(json.dumps(module["measure_wordcount"]("甲乙。"), ensure_ascii=False))',
      ].join('\n'), script(skill, 'wordcount_core.py')])
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ metric: 'visible_chars_v1', actual: 3, status: 'measured' })
    }
  })

  it('runs storyctl chapter checks through shared tracking and real Node checkers', async (context) => {
    const cwd = await workspace(context)
    const input = join(cwd, 'initial.json')
    await writeFile(input, JSON.stringify({
      schema_version: 1,
      book_title: '离线回归',
      last_chapter: 0,
      context: { position: { volume: '第一卷', volume_start_chapter: 1, story_time: '清晨', scene: '村口' } },
    }))
    const initialized = await run(context, cwd, python, [
      '-B', script('story-import', 'tracking_commit.py'), 'init', '--project', cwd, '--input', input,
    ])
    expect(initialized.exitCode, initialized.stderr).toBe(0)
    for (const skill of trackingSkills) {
      const checked = await run(context, cwd, python, [
        '-B', script(skill, 'tracking_commit.py'), 'check', '--project', cwd,
      ])
      expect(checked.exitCode, checked.stderr).toBe(0)
      expect(JSON.parse(checked.stdout)).toEqual({ last_committed_chapter: 0, state_revision: 0 })
    }
    await mkdir(join(cwd, '大纲'))
    await mkdir(join(cwd, '正文'))
    await writeFile(join(cwd, '大纲/细纲_第1章.md'), '字数目标：20\n字数口径：visible_chars_v1\n')
    const body = join(cwd, '正文/第1章.md')
    await writeFile(body, cleanProse)
    const args = ['-B', script('story-long-write', 'storyctl.py'), 'chapter', 'check', '--project', cwd, '--chapter', '1']
    const clean = await run(context, cwd, python, args)
    expect(clean.exitCode, clean.stderr).toBe(0)
    expect(JSON.parse(clean.stdout)).toMatchObject({
      schema: 'story-chapter-check/v1', quality: { status: 'pass', blocking_findings: [] },
    })
    await writeFile(body, '这不是归途，而是牢笼。\n')
    const blocked = await run(context, cwd, python, args)
    expect(blocked.exitCode, blocked.stderr).toBe(2)
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      quality: { status: 'fail', blocking_findings: [expect.objectContaining({ source: 'ai-pattern', severity: 'blocking' })] },
      available_actions: [],
    })
  })

  it('rejects launch, runtime, and malformed-output errors instead of treating them as prose findings', async (context) => {
    const cwd = await workspace(context)
    const result = await run(context, cwd, python, [
      '-B', resolve(import.meta.dirname, 'fixtures/knowledge-novel-quality.py'), script('story-long-write', 'storyctl.py'),
    ])
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stderr).toContain('Ran 10 tests')
  })
})
