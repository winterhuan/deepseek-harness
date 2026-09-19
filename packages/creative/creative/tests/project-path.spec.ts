import { describe, expect, it } from 'vitest'
import { parseCreativePath } from '../src/project-path.ts'
import { assertCreativePath } from '../src/workspace-route.ts'
import { detectStoryMutation } from '../src/native-hooks.ts'

describe('Host creative path consumers', () => {
  it.each([
    '正文/第001章.md', '书甲/正文/第001章.md', '长篇/书甲/正文/第001章.md', '短篇/书乙/正文.md', '正文.md',
    '书甲/short-drama.json', '长篇/书甲/追踪/_tracking-state.json', '短篇/书乙/小节大纲.md',
    '书甲/剧集/EP001/分镜.md', '书乙/剧集/EP001/分镜.md',
  ])('uses the parsed project when validating and guarding %s', (path) => {
    const parsed = parseCreativePath(path)!
    expect(() => { assertCreativePath(path, 'text') }).not.toThrow()
    const mutation = detectStoryMutation('write', { file_path: path }, '/workspace')
    if (parsed.role === 'body') {
      expect(mutation).toMatchObject({ root: parsed.projectRoot === '' ? '/workspace' : `/workspace/${parsed.projectRoot}`, path })
    } else expect(mutation).toBeUndefined()
  })

  it.each([
    ['/workspace/书甲/正文/第001章.md', '/workspace'],
    ['file:///workspace/%E4%B9%A6%E7%94%B2/正文/第001章.md', 'file:///workspace'],
    ['dsh://workspace/books/书甲/正文/第001章.md', 'dsh://workspace/books'],
    ['c:\\WORKSPACE\\书甲\\正文\\第001章.md', 'C:\\workspace'],
    ['file:///C:/workspace/书甲/正文/第001章.md', 'C:/workspace'],
  ])('scopes the native mutation %s', (path, cwd) => {
    expect(detectStoryMutation('write', { file_path: path }, cwd)?.path).toBe('书甲/正文/第001章.md')
  })

  it.each([
    '../正文/逃逸.md', '/other/正文/逃逸.md', 'file:///other/正文/逃逸.md', 'C:/other/正文/逃逸.md',
    'outer/nested/书甲/正文/第001章.md', '.git/正文/a.md', 'file:///workspace/正文/a.md?x', 'file:///workspace/%XX',
  ])('does not guard an unsupported mutation %s', (path) => {
    expect(detectStoryMutation('write', { file_path: path }, '/workspace')).toBeUndefined()
  })
})
