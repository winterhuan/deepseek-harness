import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { describe, expect, it, vi } from 'vitest'
import { createCreativeProductionTool } from '../src/production-tool.ts'
import { CREATIVE_PRODUCTION_TOOL_NAME } from '../src/production-intent.ts'

function agentFixture(options: { ownerSession?: string | undefined } = { ownerSession: 'session-own' }) {
  const read = vi.fn()
  const get = vi.fn((id: string) => {
    if (id !== 'bash-1') throw new Error('unknown job')
    return { id, ownerSession: options.ownerSession, status: 'running', startedAt: 42 }
  })
  const fs = {
    resolve: async (path: string, options?: { cwd: string }): Promise<FsTarget> => {
      const displayPath = path.startsWith('/') ? path : `${options?.cwd}/${path}`
      return { displayPath, targetKey: displayPath as FsTarget['targetKey'] }
    },
    contains: (parent: FsTarget, child: FsTarget) => child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`),
  }
  const agent = { session: { id: 'session-own', header: { cwd: '/workspace' } }, ctx: { get: (key: string) => key === 'jobs' ? { get, read } : key === 'fs' ? fs : undefined } } as unknown as Agent
  return { agent, read, get }
}

const tracking = { action: 'track_job', episode: '书甲/剧集/EP001', targetId: 'SHOT-001', requestId: 'card-1', jobId: 'bash-1', jobKind: 'composition' } as const

describe('native production job ownership', () => {
  it('binds a real owned job without consuming its output', async () => {
    const tool = createCreativeProductionTool()
    expect(tool.name).toBe(CREATIVE_PRODUCTION_TOOL_NAME)
    const { agent, read, get } = agentFixture()
    const result = await tool.execute(tracking, { agent } as ToolRunContext) as Parameters<typeof tool.output.render>[1]
    expect(result).toMatchObject({ action: 'track_job', production: { requestId: 'card-1', episode: tracking.episode, job: { jobId: 'bash-1', startedAt: 42 } } })
    expect(get).toHaveBeenCalledWith('bash-1', agent)
    expect(read).not.toHaveBeenCalled()
    expect(tool.output.presentationMeta?.(tracking, result)).toEqual(JSON.parse(tool.output.render(tracking, result).map(part => part.type === 'text' ? part.text : '').join('')))
  })

  it.each(['session-foreign', undefined])('refuses foreign or unowned jobs (%s)', async (owner) => {
    const fixture = agentFixture({ ownerSession: owner })
    await expect(createCreativeProductionTool().execute(tracking, { agent: fixture.agent } as ToolRunContext)).rejects.toThrow('current Session')
    expect(fixture.read).not.toHaveBeenCalled()
  })

  it('rejects a declaration without a real job or production request identity', async () => {
    const { agent } = agentFixture()
    const tool = createCreativeProductionTool()
    await expect(tool.execute({ ...tracking, jobId: 'invented' }, { agent } as ToolRunContext)).rejects.toThrow('unknown job')
    const { requestId: _requestId, ...legacy } = tracking
    await expect(tool.execute(legacy, { agent } as ToolRunContext)).rejects.toThrow('requestId')
  })
})
