// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/client/workspace-client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Creative workspace requests', () => {
  it('does not expose the previous Session directory while another Session loads', async () => {
    let resolveSecond!: (response: Response) => void
    const second = new Promise<Response>((resolve) => { resolveSecond = resolve })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ cwd: '/first' })).mockReturnValueOnce(second))
    const view = renderHook(({ session }) => useWorkspace(session), { initialProps: { session: 'first' } })
    await waitFor(() => { expect(view.result.current.workspace?.cwd).toBe('/first') })
    view.rerender({ session: 'second' })
    expect(view.result.current.workspace).toBeUndefined()
    expect(view.result.current.loading).toBe(true)
    await act(async () => { resolveSecond(Response.json({ cwd: '/second' })); await second })
    await waitFor(() => { expect(view.result.current.workspace?.cwd).toBe('/second') })
  })

  it('ignores a late directory response after an explicit refresh replaces it', async () => {
    let resolveFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const fetchDirectory = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(Response.json({ cwd: '/current' }))
    vi.stubGlobal('fetch', fetchDirectory)
    const view = renderHook(() => useWorkspace('session'))
    act(() => { view.result.current.reload() })
    await waitFor(() => { expect(view.result.current.workspace?.cwd).toBe('/current') })
    await act(async () => { resolveFirst(Response.json({ cwd: '/stale' })); await first })
    expect(view.result.current.workspace?.cwd).toBe('/current')
    expect(fetchDirectory).toHaveBeenCalledTimes(2)
  })

  it('clears a Session failure when the next Session loads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 404 })).mockResolvedValueOnce(Response.json({ cwd: '/next' })))
    const view = renderHook(({ session }) => useWorkspace(session), { initialProps: { session: 'first' } })
    await waitFor(() => { expect(view.result.current.error).toBe('unavailable') })
    expect(view.result.current.loading).toBe(false)
    view.rerender({ session: 'next' })
    expect(view.result.current.error).toBeUndefined()
    await waitFor(() => { expect(view.result.current.workspace?.cwd).toBe('/next') })
  })
})
