/** Host ownership checks for production context and process-local jobs. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { parseCreativePath } from './project-path.ts'
import { parseProductionContext, type ProductionContext } from './production-binding.ts'

/**
 * Validate production context and filesystem containment before starting work.
 * @param value - tool-supplied production context.
 * @param agent - calling Agent whose workspace owns the episode.
 * @returns normalized context scoped to the Agent's workspace.
 * @throws when the context is invalid or a resolved directory leaves its project.
 */
export async function resolveProductionContext(value: unknown, agent: Agent): Promise<ProductionContext> {
  const context = parseProductionContext(value)
  const parsed = parseCreativePath(context?.episode)
  if (context === undefined || parsed === undefined) throw new Error('Production context requires a requestId, full episode path, targetId, and media kind.')
  const cwd = agent.session.header.cwd
  const fs = agent.ctx.get('fs')
  if (cwd === undefined || fs === undefined) throw new Error('Production context requires the Session workspace filesystem.')
  const workspace = await fs.resolve(cwd)
  const project = parsed.projectRoot === '' ? workspace : await fs.resolve(parsed.projectRoot, { cwd })
  const episode = await fs.resolve(context.episode, { cwd })
  if (!fs.contains(workspace, project) || !fs.contains(project, episode)) throw new Error('Production episode must remain inside its workspace project.')
  return context
}

/**
 * Inspect an owned job without consuming output or changing completion reporting.
 * @param agent - Session owner requesting the reference.
 * @param jobId - actual framework job identity.
 * @returns its non-consuming snapshot.
 * @throws for missing, unowned, or foreign jobs.
 */
export function ownedProductionJob(agent: Agent, jobId: JobId): JobSnapshot {
  const jobs = agent.ctx.get('jobs')
  if (jobs === undefined) throw new Error('Production jobs are unavailable in this Session.')
  const snapshot = jobs.get(jobId, agent)
  if (snapshot.ownerSession !== agent.session.id) throw new Error('Production job must belong to the current Session.')
  return snapshot
}
