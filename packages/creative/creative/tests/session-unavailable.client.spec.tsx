import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SessionUnavailableNotice, isSessionUnavailable } from '../src/client/session-notice.js'

describe('SessionUnavailableNotice', () => {
  it('treats only the unknown-session 404 as an unrestored session', () => {
    expect(isSessionUnavailable(404)).toBe(true)
    for (const status of [0, 400, 403, 409, 500, 503]) expect(isSessionUnavailable(status)).toBe(false)
  })

  it('tells the creator to resume the session before reloading', () => {
    const html = renderToStaticMarkup(<SessionUnavailableNotice />)
    expect(html).toContain('DSH 会话不可用')
    expect(html).toContain('发一句话')
    expect(html).toContain('刷新')
    expect(html).toContain('role="alert"')
  })
})
