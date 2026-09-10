// @vitest-environment jsdom
/**
 * SkillViewerPanel and the sidebar-foot action over a real controller store:
 * the list views (loading, error with retry, empty with and without a backing
 * session, stale banner, query filtering, user-only badges), the detail views
 * (loading, error with reselect, ready with metadata and the verbatim body,
 * all three resource-base kinds), and the action button driving the modal.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillViewerEntry, SkillViewerGetValue } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillViewerController, type SkillViewerRemote } from '../src/client/controller.ts'
import { SkillViewerAction, type SkillViewerActionProps } from '../src/client/SkillViewerAction.tsx'
import { SkillViewerPanel } from '../src/client/SkillViewerPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { SkillViewerState } from '../src/client/controller.ts'

afterEach(cleanup)

// The action never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('viewer action must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SkillViewerActionProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SkillViewerActionProps['useSessionPendingInteraction'] =
  selector => selector(noAttention)

const t = makeTranslate(zh)

function entry(overrides: Partial<SkillViewerEntry> = {}): SkillViewerEntry {
  return {
    name: 'review',
    description: 'Review the current change.',
    modelInvocable: true,
    userInvocable: true,
    source: 'project-dsh',
    provider: 'filesystem',
    ...overrides,
  }
}

function detail(overrides: Partial<SkillViewerGetValue> = {}): SkillViewerGetValue {
  return {
    name: 'review',
    description: 'Review the current change.',
    modelInvocable: true,
    userInvocable: true,
    source: 'project-dsh',
    provider: 'filesystem',
    content: '# Review\nFollow the checklist.',
    references: { files: ['references/guide.md'], truncated: false },
    ...overrides,
  }
}

function state(overrides: Partial<SkillViewerState> = {}): SkillViewerState {
  return {
    open: true, query: '', status: 'ready', skills: [], stale: false,
    error: null, scoped: true, detail: null, reference: null,
    ...overrides,
  }
}

function renderPanel(overrides: Partial<SkillViewerState> = {}): {
  onQuery: ReturnType<typeof vi.fn>
  onRetry: ReturnType<typeof vi.fn>
  onSelect: ReturnType<typeof vi.fn>
  onBack: ReturnType<typeof vi.fn>
  onReference: ReturnType<typeof vi.fn>
} {
  const onQuery = vi.fn()
  const onRetry = vi.fn()
  const onSelect = vi.fn()
  const onBack = vi.fn()
  const onReference = vi.fn()
  render(
    <SkillViewerPanel
      state={state(overrides)}
      t={t}
      onQuery={onQuery}
      onRetry={onRetry}
      onSelect={onSelect}
      onBack={onBack}
      onReference={onReference}
    />,
  )
  return { onQuery, onRetry, onSelect, onBack, onReference }
}

describe('SkillViewerPanel list views', () => {
  it('renders the loading state', () => {
    renderPanel({ status: 'loading' })
    expect(screen.getByText(zh['list.loading'])).toBeDefined()
  })

  it('renders the error state and routes retry', () => {
    const { onRetry } = renderPanel({ status: 'error', error: 'offline' })

    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText(`${zh['list.error']}：offline`)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['list.retry'] }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders the error state without a failure text', () => {
    renderPanel({ status: 'error', error: null })

    expect(screen.getByText(`${zh['list.error']}：${zh['error.unknown']}`)).toBeDefined()
  })

  it('renders rows with name, description, and source metadata, and routes selection', () => {
    const { onSelect } = renderPanel({ skills: [entry()] })

    const row = screen.getByRole('button', { name: new RegExp('review') })
    expect(row.textContent).toContain('Review the current change.')
    expect(row.textContent).toContain('project-dsh · filesystem')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('review')
  })

  it('badges a skill hidden from the model', () => {
    renderPanel({ skills: [entry({ name: 'manual-only', modelInvocable: false })] })

    expect(screen.getByText(zh['row.userOnly'])).toBeDefined()
  })

  it('filters rows by the query', () => {
    renderPanel({ skills: [entry(), entry({ name: 'release-notes', description: 'Draft notes.' })], query: 'review' })

    expect(screen.getByRole('button', { name: /review/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /release-notes/ })).toBeNull()
  })

  it('shows the stale banner above a partial catalog', () => {
    renderPanel({ stale: true, skills: [entry()] })

    expect(screen.getByText(zh['list.stale'])).toBeDefined()
  })

  it('explains when the search has no matches', () => {
    renderPanel({ skills: [entry()], query: 'missing-skill' })
    expect(screen.getByText(zh['list.noResults'])).toBeDefined()
    expect(screen.queryByRole('button', { name: /review/ })).toBeNull()
  })

  it('renders the empty state with the hint only when unscoped', () => {
    renderPanel({ skills: [] })
    expect(screen.queryByText(zh['list.emptyHint'])).toBeNull()

    renderPanel({ skills: [], scoped: false })
    expect(screen.getByText(zh['list.emptyHint'])).toBeDefined()
  })

  it('hides the search input when no session backs the view', () => {
    renderPanel({ scoped: false })

    expect(screen.queryByRole('textbox', { name: zh['search.label'] })).toBeNull()
  })

  it('routes search edits through onQuery', () => {
    const { onQuery } = renderPanel({ skills: [entry()] })

    fireEvent.change(screen.getByRole('textbox', { name: zh['search.label'] }), { target: { value: 'rev' } })
    expect(onQuery).toHaveBeenCalledWith('rev')
  })
})

describe('SkillViewerPanel detail views', () => {
  it.each([
    { references: null, message: zh['reference.unavailable'] },
    { references: { files: [], truncated: false }, message: zh['reference.empty'] },
    { references: { files: [], truncated: true }, message: zh['reference.listTruncated'] },
  ])('explains unavailable, empty, and incomplete reference listings: $message', ({ references, message }) => {
    renderPanel({ detail: { name: 'review', status: 'ready', value: detail({ references }), error: null } })
    expect(screen.getByText(message)).toBeDefined()
    expect(screen.queryByRole('combobox', { name: zh['reference.label'] })).toBeNull()
    if (references?.truncated === true) expect(screen.queryByText(zh['reference.empty'])).toBeNull()
  })

  it('shows progress while a reference is loading', () => {
    renderPanel({
      detail: { name: 'review', status: 'ready', value: detail(), error: null },
      reference: { path: 'references/guide.md', status: 'loading', value: null, error: null },
    })
    expect(screen.getByText(zh['reference.loading'])).toBeDefined()
    expect(screen.queryByText(detail().content)).toBeNull()
  })

  it.each(['gone', null])('shows a reference failure and retries the same file: %s', (error) => {
    const { onReference } = renderPanel({
      detail: { name: 'review', status: 'ready', value: detail(), error: null },
      reference: { path: 'references/guide.md', status: 'error', value: null, error },
    })
    expect(screen.getByRole('alert').textContent).toContain(`${zh['reference.error']}：${error ?? zh['error.unknown']}`)
    fireEvent.click(screen.getByRole('button', { name: zh['detail.retry'] }))
    expect(onReference).toHaveBeenCalledWith('references/guide.md')
  })

  it('offers reference files and displays their previews with truncation feedback', () => {
    const { onReference } = renderPanel({
      detail: { name: 'review', status: 'ready', value: detail(), error: null },
      reference: { path: 'references/guide.md', status: 'ready', value: { path: 'references/guide.md', content: 'Reference preview', bytes: 2048, truncated: true }, error: null },
    })
    expect(screen.getByText('Reference preview')).toBeDefined()
    expect(screen.getByText(zh['reference.truncated'])).toBeDefined()
    fireEvent.change(screen.getByRole('combobox', { name: zh['reference.label'] }), { target: { value: '' } })
    expect(onReference).toHaveBeenCalledWith('')
    expect(screen.getByRole('button', { name: zh['reference.back'] })).toBeDefined()
  })

  it('keeps search and other skills available while reading a selected skill', () => {
    const { onQuery, onSelect } = renderPanel({
      skills: [entry(), entry({ name: 'release-notes', description: 'Draft notes.' })],
      detail: { name: 'review', status: 'ready', value: detail(), error: null },
    })
    expect(screen.getByRole('button', { name: /review/ }).getAttribute('aria-current')).toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: zh['search.label'] }), { target: { value: 'release' } })
    expect(onQuery).toHaveBeenCalledWith('release')
    fireEvent.click(screen.getByRole('button', { name: /release-notes/ }))
    expect(onSelect).toHaveBeenCalledWith('release-notes')
    expect(screen.getByRole('region', { name: zh['detail.instructions'] })).toBeDefined()
  })

  it('shows metadata without a disclosure control', () => {
    renderPanel({ detail: { name: 'review', status: 'ready', value: detail(), error: null } })
    expect(screen.getByRole('region', { name: zh['meta.details'] })).toBeDefined()
    expect(document.querySelector('details')).toBeNull()
    expect(screen.getByText('project-dsh')).toBeDefined()
    expect(screen.getByRole('region', { name: zh['detail.instructions'] })).toBeDefined()
  })

  it('renders the loading state with the back control', () => {
    const { onBack } = renderPanel({
      detail: { name: 'review', status: 'loading', value: null, error: null },
    })

    expect(screen.getByText(zh['detail.loading'])).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['detail.back'] }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('renders the error state and routes the retry back through selection', () => {
    const { onSelect } = renderPanel({
      detail: { name: 'review', status: 'error', value: null, error: 'gone' },
    })

    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText(`${zh['detail.error']}：gone`)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['detail.retry'] }))
    expect(onSelect).toHaveBeenCalledWith('review')
  })

  it('renders the error state without a failure text', () => {
    renderPanel({ detail: { name: 'review', status: 'error', value: null, error: null } })

    expect(screen.getByText(`${zh['detail.error']}：${zh['error.unknown']}`)).toBeDefined()
  })

  it('renders the loaded skill with metadata and the verbatim body', () => {
    renderPanel({
      detail: {
        name: 'review', status: 'ready', value: detail({
          whenToUse: 'Before publishing.',
          path: '/project/.dsh/skills/review/SKILL.md',
          resourceBase: { kind: 'directory', path: '/project/.dsh/skills/review' },
        }), error: null,
      },
    })

    expect(screen.getByText(zh['meta.source'])).toBeDefined()
    expect(screen.getByText('project-dsh')).toBeDefined()
    expect(screen.getByText(zh['meta.whenToUse'])).toBeDefined()
    expect(screen.getByText('Before publishing.')).toBeDefined()
    expect(screen.getByText('/project/.dsh/skills/review/SKILL.md')).toBeDefined()
    expect(screen.getByText(zh['detail.instructions'])).toBeDefined()
    // Whitespace normalization flattens the <pre> body; match a fragment and
    // pin the element to the verbatim-body region.
    const body = screen.getByText(/Follow the checklist\./)
    expect(body.tagName).toBe('PRE')
  })

  it('omits the optional metadata rows when the skill carries none', () => {
    renderPanel({ detail: { name: 'review', status: 'ready', value: detail(), error: null } })

    expect(screen.getByText('project-dsh')).toBeDefined()
    expect(screen.queryByText(zh['meta.whenToUse'])).toBeNull()
    expect(screen.queryByText(zh['meta.path'])).toBeNull()
    expect(screen.queryByText(zh['meta.resources'])).toBeNull()
  })

  it.each([
    { kind: 'directory', path: '/skills/review' } as const,
    { kind: 'url', url: 'https://example.invalid/skills/review/' } as const,
    { kind: 'opaque', description: 'Ask the provider.' } as const,
  ])('renders the $kind resource base verbatim', (resourceBase) => {
    renderPanel({ detail: { name: 'review', status: 'ready', value: detail({ resourceBase }), error: null } })

    const line = resourceBase.kind === 'directory'
      ? resourceBase.path
      : resourceBase.kind === 'url' ? resourceBase.url : resourceBase.description
    expect(screen.getByText(line)).toBeDefined()
  })
})

describe('SkillViewerAction', () => {
  /**
   * Mount the action over a reactive snapshot: the real renderer binds
   * `hooks.viewer` into the useViewer hook, so the stand-in subscribes to the
   * same store the controller publishes to.
   */
  function ActionMount({ controller, wide }: { controller: SkillViewerController; wide: boolean }): ReactNode {
    const [snap, setSnap] = useState(controller.store.getSnapshot())
    useEffect(() => controller.store.subscribe(() => { setSnap(controller.store.getSnapshot()) }), [controller])
    return (
      <SkillViewerAction
        wide={wide}
        controller={controller}
        useViewer={select => select(snap)}
        t={t}
        useSessions={neverHook}
        useSessionPendingInteraction={useSessionPendingInteraction}
        useWorkspaces={neverHook}
        useResource={neverHook}
        usePanelInfo={neverHook}
      />
    )
  }

  function actionHarness() {
    const calls: { method: string; request: unknown }[] = []
    const remote: SkillViewerRemote = {
      listDetails: (request) => {
        calls.push({ method: 'listDetails', request })
        return Promise.resolve({ ok: true, value: { skills: [entry()], stale: false } })
      },
      get: (request) => {
        calls.push({ method: 'get', request })
        return Promise.resolve({ ok: true, value: detail() })
      },
      readReference: () => Promise.resolve({ ok: true, value: { path: 'references/guide.md', content: '# Guide', bytes: 7, truncated: false } }),
    }
    const sessions = {
      list: {
        getSnapshot: (): { readonly current: SessionId | undefined } => ({ current: 's-1' as SessionId }),
        subscribe: (): (() => void) => () => {},
      },
      subagentAddress: (): unknown => undefined,
    }
    const controller = new SkillViewerController(remote, sessions)
    return { controller, calls }
  }

  it('opens the viewer modal from the foot action and closes it again', async () => {
    const { controller } = actionHarness()
    render(<ActionMount controller={controller} wide={false} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['action.label'] }))
    expect(controller.store.getSnapshot().open).toBe(true)
    expect(screen.getByRole('dialog', { name: zh['panel.title'] })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: zh['panel.close'] }))
    expect(controller.store.getSnapshot().open).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: zh['action.label'] }))
  })

  it('routes the panel intents through the controller inside the modal', async () => {
    const { controller, calls } = actionHarness()
    render(<ActionMount controller={controller} wide={false} />)

    fireEvent.click(screen.getByRole('button', { name: zh['action.label'] }))
    fireEvent.change(await screen.findByRole('textbox', { name: zh['search.label'] }), { target: { value: 'rev' } })
    expect(controller.store.getSnapshot().query).toBe('rev')

    fireEvent.click(screen.getByRole('button', { name: /review/ }))
    expect(await screen.findByText(zh['detail.back'])).toBeDefined()
    expect(calls.some(call => call.method === 'get')).toBe(true)

    fireEvent.change(await screen.findByRole('combobox', { name: zh['reference.label'] }), { target: { value: 'references/guide.md' } })
    expect(await screen.findByText('# Guide')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['reference.back'] }))
    expect((await screen.findByText(/Follow the checklist\./)).textContent).toBe(detail().content)

    fireEvent.click(screen.getByRole('button', { name: zh['detail.back'] }))
    expect(controller.store.getSnapshot().detail).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('surfaces a failed catalog inside the modal and retries it', async () => {
    const calls: { method: string; request: unknown }[] = []
    const remote: SkillViewerRemote = {
      listDetails: (request) => {
        calls.push({ method: 'listDetails', request })
        return Promise.resolve({
          ok: false,
          error: new RemoteError('gateway/internal', 'offline', {}),
        })
      },
      get: () => Promise.resolve({ ok: true, value: detail() }),
      readReference: () => Promise.resolve({ ok: true, value: { path: 'references/guide.md', content: '# Guide', bytes: 7, truncated: false } }),
    }
    const sessions = {
      list: {
        getSnapshot: (): { readonly current: SessionId | undefined } => ({ current: 's-1' as SessionId }),
        subscribe: (): (() => void) => () => {},
      },
      subagentAddress: (): unknown => undefined,
    }
    const controller = new SkillViewerController(remote, sessions)
    render(<ActionMount controller={controller} wide={false} />)

    fireEvent.click(screen.getByRole('button', { name: zh['action.label'] }))
    expect(await screen.findByRole('alert')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: zh['list.retry'] }))
    await waitFor(() => { expect(calls).toHaveLength(2) })
  })

  it('shows the text label next to the icon in the wide variant', () => {
    const { controller } = actionHarness()
    render(<ActionMount controller={controller} wide />)

    const action = screen.getByRole('button', { name: zh['action.label'] })
    expect(action.textContent).toContain(zh['action.label'])
  })
})
