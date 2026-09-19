import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SessionUnavailableNotice, isSessionUnavailable } from '../src/client/session-notice.js'
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


describe('SessionUnavailableNotice', () => {
  it('treats only the unknown-session 404 as an unrestored session', () => {
    expect(isSessionUnavailable(404)).toBe(true)
    for (const status of [0, 400, 403, 409, 500, 503]) expect(isSessionUnavailable(status)).toBe(false)
  })

  it('tells the creator to resume the session before reloading', () => {
    const html = renderToStaticMarkup(<SessionUnavailableNotice t={tZh} />)
    expect(html).toContain('DSH 会话不可用')
    expect(html).toContain('发一句话')
    expect(html).toContain('刷新')
    expect(html).toContain('role="alert"')
  })
})
