import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { type FileSystem, type FsDirEntry, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideStoryMutation, detectStoryMutation, postStoryMutation, validateStoryMutation } from '../src/native-hooks.js'

const roots: string[] = []
type StoryFileSystem = Pick<FileSystem, 'resolve' | 'contains' | 'stat' | 'listDir'>

function localDshFs(): StoryFileSystem {
  const resolveTarget = async (path: string, options?: { readonly cwd?: string }): Promise<FsTarget> => {
    const displayPath = isAbsolute(path) ? resolve(path) : resolve(options?.cwd ?? '.', path)
    return { targetKey: await realpath(displayPath).catch(() => displayPath) as FsTarget['targetKey'], displayPath }
  }
  return {
    resolve: vi.fn(resolveTarget),
    contains: (parent: FsTarget, child: FsTarget) => {
      const distance = relative(parent.targetKey, child.targetKey)
      return distance === '' || (!distance.startsWith('..') && !isAbsolute(distance))
    },
    stat: vi.fn(async (target: FsTarget): Promise<FsInfo | undefined> => stat(target.displayPath).then(info => ({
      version: String(info.mtimeMs) as FsInfo['version'],
      type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
      size: info.size,
    }), () => undefined)),
    listDir: vi.fn(async (target: FsTarget): Promise<FsDirEntry[]> =>
      Promise.all((await readdir(target.displayPath, { withFileTypes: true })).map(async entry => ({
        name: entry.name,
        type: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other',
        target: await resolveTarget(entry.name, { cwd: target.displayPath }),
      })))),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function project(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'creative-hook-')))
  roots.push(root)
  await mkdir(join(root, '大纲'))
  await mkdir(join(root, '追踪'))
  return root
}

describe('native DSH prose guards', () => {
  it('requires an outline from the same book and preserves short-story writes', async () => {
    const workspace = await project()
    const first = join(workspace, '书甲')
    const second = join(workspace, '长篇', '书乙')
    for (const root of [first, second]) {
      await mkdir(join(root, '追踪'), { recursive: true })
      await mkdir(join(root, '大纲'), { recursive: true })
      await writeFile(join(root, '追踪/_tracking-state.json'), '{}\n')
    }
    await writeFile(join(first, '大纲/细纲_第001章.md'), '# outline\n')
    const mutation = detectStoryMutation('write', { file_path: '长篇/书乙/正文/第001章.md' }, workspace)!
    await expect(validateStoryMutation(localDshFs(), mutation)).resolves.toContain('细纲')
    await writeFile(join(second, '大纲/细纲_第001章.md'), '# outline\n')
    await expect(validateStoryMutation(localDshFs(), mutation)).resolves.toBeUndefined()
    await expect(validateStoryMutation(localDshFs(), detectStoryMutation('write', { file_path: '长篇/书乙/正文.md' }, workspace)!)).resolves.toBeUndefined()
  })

  it('rejects metadata reached through another project or an outside directory link', async () => {
    const workspace = await project()
    const book = join(workspace, '书甲')
    const outside = await project()
    await mkdir(book)
    await writeFile(join(outside, '追踪/_tracking-state.json'), '{}\n')
    await symlink(join(outside, '追踪'), join(book, '追踪'), 'junction')
    const mutation = detectStoryMutation('write', { file_path: '书甲/正文/第001章.md' }, workspace)!
    await expect(validateStoryMutation(localDshFs(), mutation)).rejects.toThrow('同一项目')
  })

  it('recognizes both DSH filesystem tool families and ignores editor views', () => {
    expect(detectStoryMutation('write', { file_path: '正文/第002章.md' }, '/books/demo'))
      .toMatchObject({ path: '正文/第002章.md', chapter: 2 })
    expect(detectStoryMutation('str_replace_editor', {
      command: 'str_replace',
      path: '/books/demo/正文/第003章.md',
    }, '/books/demo')).toMatchObject({ path: '正文/第003章.md', chapter: 3 })
    expect(detectStoryMutation('str_replace_editor', {
      command: 'view',
      path: '/books/demo/正文/第003章.md',
    }, '/books/demo')).toBeUndefined()
    expect(detectStoryMutation('write', { file_path: '正文/第004章.md' }, 'dsh://workspace/story'))
      .toMatchObject({ root: 'dsh://workspace/story', path: '正文/第004章.md', chapter: 4 })
    expect(detectStoryMutation('write', { file_path: 'c:/books/demo/正文/分卷/../第005章.md' }, 'C:\\books\\demo'))
      .toMatchObject({ root: 'C:/books/demo', path: '正文/第005章.md', chapter: 5 })
  })

  it('allows setup and import to bootstrap prose before canonical Tracking exists', async () => {
    const root = await project()
    await expect(validateStoryMutation(localDshFs(), { root, path: '正文/第002章.md', chapter: 2 }))
      .resolves.toBeUndefined()
  })

  it('requires the matching chapter outline', async () => {
    const root = await project()
    await writeFile(join(root, '追踪', '_tracking-state.json'), '{}\n')
    await expect(validateStoryMutation(localDshFs(), { root, path: '正文/第002章.md', chapter: 2 }))
      .resolves.toContain('细纲')
  })

  it('allows a mutation when Tracking and the matching outline exist', async () => {
    const root = await project()
    await writeFile(join(root, '追踪', '_tracking-state.json'), '{}\n')
    await writeFile(join(root, '大纲', '细纲_第002章_回声.md'), '# 第二章\n')
    await expect(validateStoryMutation(localDshFs(), { root, path: '正文/第002章.md', chapter: 2 }))
      .resolves.toBeUndefined()
  })

  it("preserves DSH's downstream permission decision instead of forcing ask", async () => {
    const root = await project()
    const fs = localDshFs()
    const get = vi.fn((name: string) => name === 'fs' ? fs : undefined)
    const exec = {
      name: 'write',
      arguments: { file_path: '正文/第002章.md' },
      agent: { session: { header: { cwd: root } }, ctx: { get } },
      signal: new AbortController().signal,
    } as unknown as ToolExecution
    await expect(decideStoryMutation(exec, async () => ({ kind: 'allow' })))
      .resolves.toEqual({ kind: 'allow' })
    expect(get).toHaveBeenCalledWith('fs')
  })

  it('does not impose long-form guards on a plain short-story workspace', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'creative-hook-short-')))
    roots.push(root)
    await expect(validateStoryMutation(localDshFs(), { root, path: '正文/短篇.md' })).resolves.toBeUndefined()
  })

  it('reads the calling Agent filesystem instead of the host filesystem', async () => {
    const calls: string[] = []
    const entries = new Map<string, 'file' | 'directory'>([
      ['/virtual-story/大纲', 'directory'],
      ['/virtual-story/追踪', 'directory'],
      ['/virtual-story/追踪/_tracking-state.json', 'file'],
    ])
    const fs = {
      resolve: vi.fn(async (path: string, options?: { readonly cwd?: string }): Promise<FsTarget> => {
        const displayPath = path.startsWith('/') ? path : `${options?.cwd ?? ''}/${path}`
        calls.push(displayPath)
        return { targetKey: displayPath as FsTarget['targetKey'], displayPath }
      }),
      contains: vi.fn(() => true),
      stat: vi.fn(async (target: FsTarget): Promise<FsInfo | undefined> => {
        const type = entries.get(target.displayPath)
        return type === undefined ? undefined : { type, version: 'v1' as FsInfo['version'] }
      }),
      listDir: vi.fn(async (): Promise<FsDirEntry[]> => [{
        name: '细纲_第002章_虚拟.md',
        type: 'file',
        target: {
          targetKey: '/virtual-story/大纲/细纲_第002章_虚拟.md' as FsTarget['targetKey'],
          displayPath: '/virtual-story/大纲/细纲_第002章_虚拟.md',
        },
      }]),
    }
    const get = vi.fn((name: string) => name === 'fs' ? fs : undefined)
    const exec = {
      name: 'write',
      arguments: { file_path: '正文/第002章.md' },
      agent: { session: { header: { cwd: '/virtual-story' } }, ctx: { get } },
      signal: new AbortController().signal,
    } as unknown as ToolExecution

    await expect(decideStoryMutation(exec, async () => ({ kind: 'allow' }))).resolves.toEqual({ kind: 'allow' })
    expect(get).toHaveBeenCalledWith('fs')
    expect(calls).toContain('/virtual-story/追踪/_tracking-state.json')
  })
})

describe('creative post-write reminder', () => {
  function mutationExec(cwd = '/virtual-story'): ToolExecution {
    const fs = {
      resolve: async (path: string, options?: { readonly cwd?: string }): Promise<FsTarget> => {
        const displayPath = path.startsWith('/') ? path : `${options?.cwd ?? ''}/${path}`
        return { targetKey: displayPath as FsTarget['targetKey'], displayPath }
      },
      contains: (parent: FsTarget, child: FsTarget) => child.displayPath.startsWith(parent.displayPath),
      stat: async (): Promise<FsInfo | undefined> => undefined,
      listDir: async (): Promise<FsDirEntry[]> => [],
    }
    const get = vi.fn((name: string) => name === 'fs' ? fs : undefined)
    return {
      name: 'write',
      arguments: { file_path: '正文/第002章.md' },
      agent: { session: { header: { cwd } }, ctx: { get } },
      signal: new AbortController().signal,
    } as unknown as ToolExecution
  }

  const success = { value: 'ok', content: [] } as unknown as ToolExecutionResult
  const failure = { isError: true, error: {}, content: [] } as unknown as ToolExecutionResult

  function reminderTexts(decision: PostToolDecision): string[] {
    return decision.additionalContexts?.flatMap(message =>
      message.content.flatMap(block => block.type === 'text' ? [block.text] : [])) ?? []
  }

  it('attaches the Tracking reminder after a successful prose write', async () => {
    const decision = await postStoryMutation(mutationExec(), success, async () => ({ kind: 'accept' }))
    const texts = reminderTexts(decision)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('<creative-post-write>')
    expect(texts[0]).toContain('正文/第002章.md')
    expect(texts[0]).toContain('不要把这条提醒当作用户的新写作要求')
  })

  it('passes a failed call through without a reminder', async () => {
    const downstream = { kind: 'accept' } as const
    const decision = await postStoryMutation(mutationExec(), failure, async () => downstream)
    expect(decision).toBe(downstream)
    expect(reminderTexts(decision)).toHaveLength(0)
  })

  it('passes non-prose mutations through without a reminder', async () => {
    const downstream = { kind: 'accept' } as const
    const exec = mutationExec()
    ;(exec as { arguments: unknown }).arguments = { file_path: '大纲/细纲_第002章.md' }
    const decision = await postStoryMutation(exec, success, async () => downstream)
    expect(decision).toBe(downstream)
  })

  it('preserves a downstream deny or block untouched', async () => {
    const downstream: PostToolDecision = { kind: 'block', feedback: [] }
    const decision = await postStoryMutation(mutationExec(), success, async () => downstream)
    expect(decision).toBe(downstream)
  })
})
