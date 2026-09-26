import { describe, expect, it } from 'vitest'
import { parseCreativePath, workspaceRelativePath } from '../src/project-path.ts'
import { creativeRelativePath, workbenchModeForPath } from '../src/client/file-activity.ts'
import { episodeDirectoryForPath, isCreatorDocumentPath } from '../src/client/drama-production.ts'

const layouts = [
  ['', '正文/第001章.md', 'story', 'body'],
  ['书甲', '正文/第001章.md', 'story', 'body'],
  ['长篇/书甲', '正文/第001章.md', 'story', 'body'],
  ['短篇/书乙', '正文.md', 'story', 'body'],
  ['', '正文.md', 'story', 'body'],
  ['书甲', 'short-drama.json', 'drama', 'drama-config'],
  ['长篇/书甲', '追踪/_tracking-state.json', 'story', 'tracking'],
  ['短篇/书乙', '小节大纲.md', 'story', 'outline'],
  ['书甲', '剧集/EP001/分镜.md', 'drama', 'creator-document'],
  ['书乙', '剧集/EP001/分镜.md', 'drama', 'creator-document'],
] as const

describe('shared creative project paths', () => {
  it.each(layouts)('uses the same project for %s / %s', (root, relativePath, domain, role) => {
    const path = root === '' ? relativePath : `${root}/${relativePath}`
    expect(parseCreativePath(path)).toMatchObject({ path, projectRoot: root, relativePath, domain, role })
    expect(creativeRelativePath(`/workspace/${path}`, '/workspace')).toBe(path)
    expect(workbenchModeForPath(path)).toBe(domain)
    expect(isCreatorDocumentPath(path)).toBe(role === 'creator-document')
  })

  it.each([
    ['/workspace/书甲/正文/第001章.md', '/workspace'],
    ['file:///workspace/%E4%B9%A6%E7%94%B2/正文/第001章.md', 'file:///workspace'],
    ['dsh://workspace/books/书甲/正文/第001章.md', 'dsh://workspace/books'],
    ['c:\\WORKSPACE\\书甲\\正文\\第001章.md', 'C:\\workspace'],
    ['file:///C:/workspace/书甲/正文/第001章.md', 'C:/workspace'],
  ])('scopes native and URI input %s', (path, cwd) => {
    expect(parseCreativePath(path, cwd)?.path).toBe('书甲/正文/第001章.md')
    expect(creativeRelativePath(path, cwd)).toBe('书甲/正文/第001章.md')
  })

  it.each(['../正文/逃逸.md', '/other/正文/逃逸.md', 'file:///other/正文/逃逸.md', 'C:/other/正文/逃逸.md', 'outer/nested/书甲/正文/第001章.md', '.git/正文/a.md', 'file:///workspace/正文/a.md?x', 'file:///workspace/%XX'])('rejects unsupported path %s', (path) => {
    expect(parseCreativePath(path, '/workspace')).toBeUndefined()
    expect(creativeRelativePath(path, '/workspace')).toBeUndefined()
  })

  it('separates repeated episode identities and delivery paths', () => {
    expect(episodeDirectoryForPath('书甲/剧集/EP001/分镜.md')).toBe('书甲/剧集/EP001')
    expect(episodeDirectoryForPath('书乙/交付/EP001/SHOT-001.mp4')).toBe('书乙/剧集/EP001')
    expect(episodeDirectoryForPath('书乙/剧集/EP001/制作成果/SHOT-001/out.mp4')).toBe('书乙/剧集/EP001')
  })

  it('normalizes dot segments without admitting a workspace escape', () => {
    expect(workspaceRelativePath('书甲/正文/分卷/../第001章.md')).toBe('书甲/正文/第001章.md')
    expect(workspaceRelativePath('书甲/../../正文/a.md')).toBeUndefined()
    expect(workspaceRelativePath('')).toBeUndefined()
    expect(workspaceRelativePath('正文/\0.md')).toBeUndefined()
  })
})
