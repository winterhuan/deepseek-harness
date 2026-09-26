// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales/index.ts'
import { VideoStudio, type VideoProject } from '../src/client/video-studio.tsx'

const translate = makeTranslate(en)
const project: VideoProject = {
  id: 'project', root: 'video-recaps/project', title: 'Project', state: 'working', stage: 'cut', stageLabel: 'Cut', previews: [], artifacts: [],
}
const asset = { role: 'final' as const, label: 'Final', path: 'video-recaps/project/final.mp4', bytes: 4, version: 'first', mimeType: 'video/mp4' }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function props(current: VideoProject): ComponentProps<typeof VideoStudio> {
  return {
    t: translate, sessionId: 'session', projects: [current], running: false, projectId: current.id,
    tab: 'preview', hidden: false, workbenches: ['story', 'drama', 'game', 'video'],
    onProject: vi.fn(), onTab: vi.fn(), onWorkbench: vi.fn(),
  }
}

describe('Creative video refresh', () => {
  it('loads the first produced video but keeps later versions behind explicit selection', async () => {
    const view = render(<VideoStudio {...props(project)} />)
    expect(view.container.querySelector('video')).toBeNull()
    view.rerender(<VideoStudio {...props({ ...project, previews: [asset] })} />)
    await waitFor(() => { expect(view.container.querySelector('video')?.getAttribute('src')).toContain('version=first') })
    const player = view.container.querySelector('video')!
    view.rerender(<VideoStudio {...props({ ...project, previews: [{ ...asset, version: 'second' }] })} />)
    expect(view.container.querySelector('video')).toBe(player)
    expect(player.getAttribute('src')).toContain('version=first')
    fireEvent.click(view.getByRole('button', { name: translate('video.preview.loadNew') }))
    expect(view.container.querySelector('video')?.getAttribute('src')).toContain('version=second')
  })

  it('refreshes artifact content only when its path or revision changes', async () => {
    const fetchFile = vi.fn(async () => Response.json({ content: 'first artifact' }))
    vi.stubGlobal('fetch', fetchFile)
    const artifact = { path: 'video-recaps/project/narration.json', label: 'Narration', version: 'first', kind: 'script' as const }
    const view = render(<VideoStudio {...props(project)} tab="artifacts" />)
    expect(fetchFile).not.toHaveBeenCalled()
    view.rerender(<VideoStudio {...props({ ...project, artifacts: [artifact] })} tab="artifacts" />)
    await view.findByText('first artifact')
    view.rerender(<VideoStudio {...props({ ...project, artifacts: [{ ...artifact }], state: 'ready' })} tab="artifacts" />)
    expect(fetchFile).toHaveBeenCalledTimes(1)
    fetchFile.mockResolvedValueOnce(Response.json({ content: 'second artifact' }))
    view.rerender(<VideoStudio {...props({ ...project, artifacts: [{ ...artifact, version: 'second' }] })} tab="artifacts" />)
    await view.findByText('second artifact')
    expect(fetchFile).toHaveBeenCalledTimes(2)
  })

  it('ignores a late file response after switching Sessions', async () => {
    let resolveFirst!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const fetchFile = vi.fn().mockReturnValueOnce(firstResponse).mockResolvedValueOnce(Response.json({ content: 'second Session' }))
    vi.stubGlobal('fetch', fetchFile)
    const current = { ...project, artifacts: [{ path: 'video-recaps/project/narration.json', label: 'Narration', version: 'first', kind: 'script' as const }] }
    const view = render(<VideoStudio {...props(current)} tab="artifacts" />)
    view.rerender(<VideoStudio {...props(current)} sessionId="another-session" tab="artifacts" />)
    await view.findByText('second Session')
    await act(async () => { resolveFirst(Response.json({ content: 'first Session' })); await firstResponse })
    expect(view.queryByText('first Session')).toBeNull()
    expect(view.getByText('second Session')).toBeDefined()
  })
})
