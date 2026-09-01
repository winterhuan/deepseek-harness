// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { OverviewValue } from '../src/board.ts'
import { NovelView } from '../src/client/NovelView.tsx'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

const SID = 'session-1' as SessionId

/** The ui-novel dictionary with {placeholder} interpolation, falling back to the key itself. */
const seatOver = (dict: Record<string, string>): NovelViewProps['t'] => (key, params) => {
  const template = dict[key] ?? key
  return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
}

type NovelViewProps = Parameters<typeof NovelView>[0]

const overview: OverviewValue = {
  project: { exists: true },
  chapters: [
    { chapter: '01-雪夜.md', status: 'final', words: 3200 },
    { chapter: '02-火车站.md', status: 'draft', words: 1800 },
  ],
  characters: ['林见舟.md', 'roster.md'],
  outline: true,
  trackingViews: ['.novel/上下文.md', '.novel/伏笔.md', '.novel/时间线/作者真相.md'],
  foreshadows: [
    { id: 'f01', summary: '车票上的日期是明天', plantedIn: '01-雪夜.md' },
    { id: 'f02', summary: '修表匠的右耳', plantedIn: '01-雪夜.md', paidoffIn: '02-火车站.md' },
  ],
  summary: { totalWords: 5000, chapterCount: 2, byStatus: { draft: 1, revised: 0, final: 1 }, openForeshadowCount: 1 },
}

/** The URL a fetch stub received (jsdom fetch sees same-origin strings here). */
const urlOf = (input: RequestInfo | URL): string =>
  (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

/** Mount the view against a mocked fetch, returning the calls it issued. */
function mount(fetchImpl: typeof fetch, dict: Record<string, string> = zh) {
  const calls: string[] = []
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(urlOf(input))
    return fetchImpl(input)
  })
  vi.stubGlobal('fetch', spy)
  // The view reads only sessionId, viewRequest, and t; the remaining runtime
  // seats stay plain no-op stubs.
  const props = {
    sessionId: SID,
    viewRequest: null,
    openView: () => {},
    completeViewRequest: () => {},
    useSession: () => undefined,
    useProjection: () => undefined,
    useConversation: () => undefined,
    useInput: () => undefined,
    t: seatOver(dict),
  }
  render(<NovelView {...(props as unknown as NovelViewProps)} />)
  return { calls }
}

describe('NovelView', () => {
  it('renders the summary and chapter rows from the overview', async () => {
    mount(async () => Response.json(overview))
    await screen.findByText('01-雪夜.md')
    expect(screen.getByText(/共 2 章 · 5000 字 · 未回收伏笔 1 条/)).toBeTruthy()
    expect(screen.getByText(/定稿 · 3200 字/)).toBeTruthy()
    expect(screen.getByText(/草稿 · 1800 字/)).toBeTruthy()
  })

  it('loads a chapter document when its row is clicked', async () => {
    const { calls } = mount(async (input) => {
      if (urlOf(input).includes('/novel/document')) {
        return Response.json({ file: 'chapters/01-雪夜.md', text: '雪下了一夜。', truncated: false })
      }
      return Response.json(overview)
    })
    fireEvent.click(await screen.findByText('01-雪夜.md'))
    await screen.findByText('雪下了一夜。')
    expect(calls.some(call => call.includes('file=chapters%2F01-%E9%9B%AA%E5%A4%9C.md'))).toBe(true)
  })

  it('switches to characters and outline tabs', async () => {
    mount(async () => Response.json(overview))
    await screen.findByText('01-雪夜.md')
    fireEvent.click(screen.getByText(zh['panel.tab.characters']))
    expect(await screen.findByText('林见舟.md')).toBeTruthy()
    fireEvent.click(screen.getByText(zh['panel.tab.outline']))
    expect(await screen.findByText('outline.md')).toBeTruthy()
  })

  it('shows the no-project guidance for an empty workspace', async () => {
    mount(async () => Response.json({ ...overview, project: { exists: false } }))
    await screen.findByText(zh['panel.empty.project'])
    expect(screen.getByText(zh['panel.empty.hint'])).toBeTruthy()
  })

  it('falls back to the error placeholder when a document fetch fails', async () => {
    mount(async (input) => {
      if (urlOf(input).includes('/novel/document')) return new Response('gone', { status: 404 })
      return Response.json(overview)
    })
    fireEvent.click(await screen.findByText('01-雪夜.md'))
    await screen.findByText(zh['panel.error'].replace('{message}', 'chapters/01-雪夜.md'))
  })

  it('shows the failure state with a retry that reloads', async () => {
    mount(async () => new Response('boom', { status: 500 }))
    const error = await screen.findByText(zh['panel.error'].replace('{message}', 'HTTP 500'))
    expect(error).toBeTruthy()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(overview)))
    fireEvent.click(screen.getByText(zh['panel.retry']))
    await screen.findByText('01-雪夜.md')
  })

  it('reloads the overview when the header 刷新 button is clicked', async () => {
    const { calls } = mount(async () => Response.json(overview))
    await screen.findByText('01-雪夜.md')
    fireEvent.click(screen.getByText(zh['panel.refresh']))
    await waitFor(() => { expect(calls.filter(call => call.includes('/novel/overview')).length).toBe(2) })
  })

  it('labels the revised status', async () => {
    mount(async () => Response.json({
      ...overview,
      chapters: [{ chapter: '01-雪夜.md', status: 'revised', words: 3200 }],
      summary: { ...overview.summary, chapterCount: 1, byStatus: { draft: 0, revised: 1, final: 0 } },
    }))
    await screen.findByText('01-雪夜.md')
    expect(screen.getByText(/已修订 · 3200 字/)).toBeTruthy()
  })

  it('renders empty-state text for a missing outline and an empty cast', async () => {
    mount(async () => Response.json({ ...overview, outline: false, characters: [] }))
    await screen.findByText('01-雪夜.md')
    fireEvent.click(screen.getByText(zh['panel.tab.outline']))
    expect(await screen.findByText(zh['panel.empty.outline'])).toBeTruthy()
    fireEvent.click(screen.getByText(zh['panel.tab.characters']))
    expect(await screen.findByText(zh['panel.empty.characters'])).toBeTruthy()
  })

  it('marks a truncated document', async () => {
    mount(async (input) => {
      if (urlOf(input).includes('/novel/document')) {
        return Response.json({ file: 'chapters/01-雪夜.md', text: '雪下了一夜。', truncated: true })
      }
      return Response.json(overview)
    })
    fireEvent.click(await screen.findByText('01-雪夜.md'))
    expect(await screen.findByText(zh['panel.truncated'])).toBeTruthy()
  })

  it('shows a non-Error fetch rejection as its string form', async () => {
    mount(async () => { throw 'boom' })
    await screen.findByText(zh['panel.error'].replace('{message}', 'boom'))
  })
  it('keeps the localized dictionary on the en seat', async () => {
    mount(async () => Response.json(overview), en)
    expect(await screen.findByText('Chapters')).toBeTruthy()
    expect(screen.getByText(/2 chapters · 5000 chars · 1 open foreshadow/)).toBeTruthy()
  })

  it('fetches the overview once per session id', async () => {
    const { calls } = mount(async () => Response.json(overview))
    await screen.findByText('01-雪夜.md')
    await waitFor(() => { expect(calls.filter(call => call.includes('/novel/overview')).length).toBe(1) })
  })
})
