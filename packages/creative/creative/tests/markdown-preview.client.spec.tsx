import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview, parseMarkdownBlocks } from '../src/client/markdown-preview.js'
import type {} from '../src/client/index.js'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, zh, type CreativeLocaleKey } from '../src/client/locales/index.ts'

function translator(dictionary: Record<CreativeLocaleKey, string>): TranslateNS<typeof NS> {
  return (key, params = {}) => {
    const template = dictionary[key as CreativeLocaleKey] ?? key
    return template.replace(/\{(\w+)\}/gu, (_match: string, name: string): string => {
      const value = params[name]
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : ''
    })
  }
}

/** zh-Hans translator mirroring the shipped source-of-truth dictionary. */
export const tZh = translator(zh)


describe('MarkdownPreview', () => {
  it('renders tables, task lists, fenced code, and inline formatting', () => {
    const content = [
      '# 场景计划',
      '',
      '| 场次 | 状态 |',
      '| :--- | ---: |',
      '| SC001 | **完成** |',
      '',
      '- [x] 人物确认',
      '- [ ] 分镜待审',
      '',
      '~~~json',
      '{"scene":"SC001"}',
      '~~~',
      '',
      '保留 ~~旧稿~~ `版本 A`。',
    ].join('\n')

    const html = renderToStaticMarkup(<MarkdownPreview content={content} label="计划.md" t={tZh} />)
    expect(html).toContain('<table>')
    expect(html).toContain('text-align:left')
    expect(html).toContain('text-align:right')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('data-language="json"')
    expect(html).toContain('<del>旧稿</del>')
    expect(parseMarkdownBlocks(content).map(block => block.kind)).toEqual([
      'heading', 'table', 'ul', 'code', 'paragraph',
    ])
  })

  it('keeps raw HTML inert and only activates safe web links', () => {
    const content = '<script>alert(1)</script> [官网](https://example.com) [脚本](javascript:alert(1))'
    const html = renderToStaticMarkup(<MarkdownPreview content={content} label="安全.md" t={tZh} />)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('href="javascript:')
  })
})
