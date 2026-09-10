import type { SessionJob, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { describe, expect, it } from 'vitest'
import { ProductionRequestId, type ProductionBinding } from '../src/production-binding.ts'
import {
  createProductionRequest, mediaTargetFromPath, productionJobView, queuedItemForRequest,
  reconcileSequence, reorderSequence, sequenceIssues, type ProductionMediaVersion,
} from '../src/client/production-runtime.ts'

const request = createProductionRequest({ id: ProductionRequestId('card-1'), episode: '书甲/剧集/EP001', targetId: 'SHOT-001', kind: 'video', prompt: '动作', expectedOutputs: 20 })
const binding: ProductionBinding = {
  requestId: request.id, episode: request.episode, targetId: request.targetId, kind: request.kind,
  job: { jobId: 'produce-1' as JobId, startedAt: 10 },
}
const live: SessionJob = { id: binding.job.jobId, kind: 'produce', label: 'produce drama', status: 'running', startedAt: 10 }

describe('production requests and live job projection', () => {
  it('stores preparation data without a duplicate execution state', () => {
    expect(request).toMatchObject({ id: 'card-1', expectedOutputs: 20, episode: '书甲/剧集/EP001' })
    expect(request).not.toHaveProperty('status')
    expect(request).not.toHaveProperty('progress')
    expect(request).not.toHaveProperty('completedOutputs')
  })

  it('correlates an exact RPC identity, never quoted Chinese labels', () => {
    const submitted = { ...request, submissionId: 'rpc-1' as SessionRequestId }
    const queue = [
      { id: 'message-foreign' as MessageId, rpcId: 'rpc-2' as SessionRequestId, preview: '任务 ID：card-1' },
      { id: 'message-own' as MessageId, rpcId: 'rpc-1' as SessionRequestId, preview: '任意预览' },
    ]
    expect(queuedItemForRequest(submitted, queue)?.id).toBe('message-own')
    expect(queuedItemForRequest(request, queue)).toBeUndefined()
    expect(queuedItemForRequest(submitted, queue.slice(0, 1))).toBeUndefined()
  })

  it.each(['running', 'stopping', 'completed', 'killed', 'failed'] as const)('projects registry status %s without inferring output success', (status) => {
    expect(productionJobView(binding, [{ ...live, status, detail: 'exit code: 2' }], true))
      .toEqual({ binding, status, detail: 'exit code: 2' })
  })

  it('waits for complete reconnect baselines and refuses reused ids after a host restart', () => {
    expect(productionJobView(binding, [live], false).status).toBe('loading')
    expect(productionJobView(binding, [], false).status).toBe('loading')
    expect(productionJobView(binding, [], true).status).toBe('unavailable')
    expect(productionJobView(binding, [{ ...live, startedAt: 11 }], true).status).toBe('unavailable')
    expect(productionJobView(binding, [live], true).status).toBe('running')
  })

  it('keeps execution state independent of planned counts and workspace versions', () => {
    expect(productionJobView({ ...binding, expectedOutputs: 500 }, [live], true).status).toBe('running')
    expect(productionJobView(binding, [live], true)).not.toHaveProperty('progress')
    expect(mediaTargetFromPath('书甲/剧集/EP001/制作成果/SHOT-010/out.mp4', ['SHOT-001', 'SHOT-010'])).toBe('SHOT-010')
    expect(mediaTargetFromPath('书甲/剧集/EP001/SHOT-0100-out.mp4', ['SHOT-010'])).toBeUndefined()
  })

  it('reconciles and reorders the delivery sequence while reporting missing shots', () => {
    const versions: ProductionMediaVersion[] = [{
      id: 'image-v1', targetId: 'SHOT-001', kind: 'image', url: '/creative/media', path: '书甲/剧集/EP001/制作成果/1.png',
    }, {
      id: 'video-v1', targetId: 'SHOT-001', kind: 'video', url: '/creative/media', path: '书甲/剧集/EP001/制作成果/1.mp4',
    }]
    const sequence = reconcileSequence(['SHOT-001', 'SHOT-002'], [], versions, { 'SHOT-001': 'image-v1' })
    expect(sequence[0]?.versionId).toBe('video-v1')
    expect(sequenceIssues(sequence, versions)).toEqual(['SHOT-002 缺少已选视频版本'])
    expect(reorderSequence(sequence, 1, 0).map(item => item.shotId)).toEqual(['SHOT-002', 'SHOT-001'])
    expect(reorderSequence(sequence, 0, 9)).toEqual(sequence)
  })
})
