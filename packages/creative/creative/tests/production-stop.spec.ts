import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { registerWorkspaceRoute } from '../src/workspace-route.ts'

function fixture() {
  const jobs = new Map([
    ['produce-1', { id: 'produce-1', ownerSession: 'own', startedAt: 10, status: 'running' }],
    ['produce-2', { id: 'produce-2', ownerSession: 'foreign', startedAt: 11, status: 'running' }],
  ])
  const read = vi.fn()
  const cancel = vi.fn()
  const kill = vi.fn((id: string) => jobs.get(id)?.status === 'running' ? 'requested' : 'already-finished')
  const get = vi.fn((id: string) => {
    const job = jobs.get(id)
    if (job === undefined) throw new Error('unknown job')
    return job
  })
  const services = { jobs: { get, read, kill }, fs: { resolve: async (path: string) => ({ displayPath: path }) }, sandboxPolicy: {} }
  const agent = { session: { id: 'own', header: { cwd: '/workspace' } }, cancel, ctx: { get: (key: keyof typeof services) => services[key] } }
  let handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
  const context = {
    effect: (effect: () => unknown) => effect(),
    webServer: { register: (entry: { handler: typeof handler }) => { handler = entry.handler; return () => {} } },
    typert: { lookups: new Map([['agent', { resolve: async () => agent }]]) },
    logger: () => ({ error: vi.fn() }),
  } as unknown as Context
  registerWorkspaceRoute(context, { maxBytes: 1_024 })
  const stop = async (body: unknown, origin = 'http://localhost:3000') => {
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: 'POST', url: '/creative/job/stop?sessionId=own', headers: { host: 'localhost:3000', origin },
    }) as IncomingMessage
    let status = 0
    let result = ''
    const response = {
      writeHead: (value: number) => { status = value }, end: (value: string) => { result = value },
    } as unknown as ServerResponse
    await handler(request, response)
    return { status, body: JSON.parse(result) as unknown }
  }
  return { stop, kill, read, cancel, jobs, agent }
}

describe('trusted production stop route', () => {
  it('stops only the referenced Session-owned job and does not consume output or cancel a turn', async () => {
    const { stop, kill, read, cancel, agent } = fixture()
    await expect(stop({ jobId: 'produce-1', startedAt: 10 })).resolves.toEqual({ status: 200, body: { status: 'requested' } })
    expect(kill).toHaveBeenCalledExactlyOnceWith('produce-1', agent)
    expect(read).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('rejects foreign, missing, and restarted job references', async () => {
    const { stop, kill } = fixture()
    expect((await stop({ jobId: 'produce-2', startedAt: 11 })).status).toBe(404)
    expect((await stop({ jobId: 'invented', startedAt: 10 })).status).toBe(404)
    expect((await stop({ jobId: 'produce-1', startedAt: 9 })).status).toBe(409)
    expect((await stop({ jobId: 'produce-1' })).status).toBe(400)
    expect((await stop({ jobId: 'produce-1', startedAt: 10 }, 'https://untrusted.example')).status).toBe(403)
    expect(kill).not.toHaveBeenCalled()
  })

  it('returns a completed-race result without claiming cancellation', async () => {
    const { stop, kill, jobs } = fixture()
    kill.mockImplementation(() => {
      jobs.get('produce-1')!.status = 'completed'
      return 'already-finished'
    })
    await expect(stop({ jobId: 'produce-1', startedAt: 10 })).resolves.toEqual({ status: 200, body: { status: 'already-finished' } })
  })
})
