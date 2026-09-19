// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { DramaProductionView } from '../src/client/drama-production-view.tsx'
import { parseEpisodeProduction } from '../src/client/drama-production.ts'
import { createProductionRequest } from '../src/client/production-runtime.ts'
import { ProductionRequestId, type ProductionBinding } from '../src/production-binding.ts'
import { en } from '../src/client/locales/index.ts'

type Props = ComponentProps<typeof DramaProductionView>
const episode = '书甲/剧集/EP001'
const request = { ...createProductionRequest({ id: ProductionRequestId('card-1'), episode, targetId: 'SHOT-001', kind: 'image', prompt: 'a quiet room', expectedOutputs: 12 }), submissionId: 'rpc-1' as SessionRequestId }
const binding: ProductionBinding = {
  requestId: request.id, episode, targetId: 'SHOT-001', kind: 'image', job: { jobId: 'produce-1' as JobId, startedAt: 10 },
}

afterEach(cleanup)

function props(overrides: Partial<Props> = {}): Props {
  return {
    t: makeTranslate(en),
    production: parseEpisodeProduction({ [`${episode}/分镜.md`]: '# 分镜\n\n## SHOT-001 · 静室\n\n### 冻结关键帧提示词\n> a quiet room\n' }, episode),
    queue: [], section: 'tasks', selectedId: undefined, requests: [request], jobViews: [],
    versions: [], libraryVersions: [], selections: {}, manualReferences: {}, sequence: [], canvas: {}, zoom: 1,
    onSectionChange: vi.fn(), onSelect: vi.fn(), onNavigate: vi.fn(), onRequestsChange: vi.fn(),
    onSelectionsChange: vi.fn(), onManualReferencesChange: vi.fn(), onOpenMedia: vi.fn(),
    onSequenceChange: vi.fn(), onCanvasChange: vi.fn(), onZoomChange: vi.fn(),
    onBeginSubmission: vi.fn(() => 'rpc-created' as SessionRequestId), onDispatchPrompt: vi.fn(async () => {}),
    onStopJob: vi.fn(async () => {}), onRemoveQueued: vi.fn(async () => {}), onRefresh: vi.fn(), ...overrides,
  }
}

describe('production request interactions', () => {
  it.each(['begin', 'dispatch'] as const)('retains a failed draft when %s submission fails', async (failure) => {
    const input = props({ section: 'shots', requests: [] })
    if (failure === 'begin') vi.mocked(input.onBeginSubmission).mockImplementation(() => { throw new Error('offline') })
    else vi.mocked(input.onDispatchPrompt).mockRejectedValue(new Error('offline'))
    const view = render(<DramaProductionView {...input} />)
    fireEvent.click(view.getByRole('button', { name: 'Prepare batch keyframes' }))
    await waitFor(() => {
      expect(input.onRequestsChange).toHaveBeenLastCalledWith([expect.objectContaining({
        episode, submissionError: 'offline', expectedOutputs: 1,
      })])
    })
    const saved = vi.mocked(input.onRequestsChange).mock.calls.at(-1)![0][0]!
    expect(saved.id).not.toBe(saved.submissionId)
    expect(saved).not.toHaveProperty('status')
    if (failure === 'dispatch') expect(input.onDispatchPrompt).toHaveBeenCalledWith(expect.stringContaining(saved.id), 'rpc-created')
    else expect(input.onDispatchPrompt).not.toHaveBeenCalled()
  })

  it('withdraws only the preparation message with the exact RPC identity', async () => {
    const input = props({ queue: [
      { id: 'foreign-message' as MessageId, rpcId: 'foreign-rpc' as SessionRequestId },
      { id: 'own-message' as MessageId, rpcId: request.submissionId },
    ] })
    const view = render(<DramaProductionView {...input} />)
    fireEvent.click(view.getByRole('button', { name: 'Remove from the DSH queue' }))
    await waitFor(() => { expect(input.onRequestsChange).toHaveBeenCalledWith([{ ...request, withdrawn: true }]) })
    expect(input.onRemoveQueued).toHaveBeenCalledExactlyOnceWith('own-message')
    expect(input.onStopJob).not.toHaveBeenCalled()
  })

  it('keeps a request unchanged when queue withdrawal fails and offers no unbound stop', async () => {
    const input = props({ queue: [{ id: 'own-message' as MessageId, rpcId: request.submissionId }] })
    vi.mocked(input.onRemoveQueued).mockRejectedValue(new Error('already admitted'))
    const view = render(<DramaProductionView {...input} />)
    fireEvent.click(view.getByRole('button', { name: 'Remove from the DSH queue' }))
    await view.findByText('already admitted')
    expect(input.onRequestsChange).not.toHaveBeenCalled()
    view.rerender(<DramaProductionView {...input} queue={[]} />)
    expect(view.queryByRole('button', { name: 'Stop this job' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Remove from the DSH queue' })).toBeNull()
  })

  it('shows every registered outcome without treating planned outputs as progress', async () => {
    const statuses = ['running', 'stopping', 'failed', 'completed', 'killed', 'unavailable', 'loading'] as const
    const input = props({ jobViews: statuses.map((status, index) => ({
      status, binding: { ...binding, targetId: `SHOT-${index}`, job: { jobId: `produce-${index}` as JobId, startedAt: index } },
    })) })
    const view = render(<DramaProductionView {...input} />)
    expect(view.container.querySelectorAll('[data-job-id]')).toHaveLength(statuses.length)
    expect(view.getByText('Planned outputs: 12')).toBeTruthy()
    expect(view.getByText('3/7 registered jobs ended; this does not mean the whole batch succeeded.')).toBeTruthy()
    expect(view.container.querySelector('progress, [role="progressbar"]')).toBeNull()
    const running = view.container.querySelector<HTMLElement>('[data-job-id="produce-0"]')!
    await act(async () => { fireEvent.click(within(running).getByRole('button', { name: 'Stop this job' })) })
    expect(input.onStopJob).toHaveBeenCalledExactlyOnceWith({ jobId: 'produce-0', startedAt: 0 })
    expect(input.onRequestsChange).not.toHaveBeenCalled()
    expect(running.dataset.status).toBe('running')
    view.rerender(<DramaProductionView {...input} jobViews={input.jobViews.map(job => job.status === 'running' ? { ...job, status: 'completed' } : job)} />)
    expect(running.dataset.status).toBe('completed')
    expect(view.queryByRole('button', { name: 'Stop this job' })).toBeNull()
  })
})
