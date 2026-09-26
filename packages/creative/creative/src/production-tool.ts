import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { PRODUCTION_BINDING_SCHEMA, type ProductionRequestId } from './production-binding.ts'
import { ownedProductionJob, resolveProductionContext } from './production-context.ts'
import {
  CREATIVE_PRODUCTION_TOOL_NAME,
  PRODUCTION_INTENT_ACTIONS,
  PRODUCTION_INTENT_JOB_KINDS,
  PRODUCTION_INTENT_SECTIONS,
  validateProductionIntent,
  type ProductionIntentArgs,
} from './production-intent.js'

function intentMessage(intent: ProductionIntentArgs): string {
  if (intent.action === 'track_job') return `已将作业 ${intent.jobId ?? ''} 绑定到 ${intent.episode} 的生产请求。`
  if (intent.action === 'set_sequence') return `已把 ${String(intent.shotIds?.length ?? 0)} 个镜头的顺序发送到 ${intent.episode} 成片视图。`
  if (intent.action === 'focus_target') return `已请求 ${intent.episode} 生产视图聚焦 ${intent.targetId ?? '目标'}。`
  return `已把 ${intent.action} 界面意图发送到 ${intent.episode} 生产工作台。`
}

/**
 * Build the production projection tool. Tracking validates an existing owned job;
 * successful results carry the association through the existing tool log.
 * @returns the tool definition consumed by the tools registry.
 */
export function createCreativeProductionTool(): ToolDefinition {
  return defineTool({
    name: CREATIVE_PRODUCTION_TOOL_NAME,
    description: 'Open or focus short-drama production targets, set an explicit shot order, or bind an existing background job to a confirmed production request. For track_job, start the background command first, then supply its actual JobId and the preparation requestId. The job must belong to the current Session. This tool does not generate media or authorize paid production.',
    parameters: {
      action: { type: 'string', required: true, enum: PRODUCTION_INTENT_ACTIONS, description: 'The exact production UI/task projection operation.' },
      episode: { type: 'string', required: true, description: 'Full workspace-relative episode directory, for example 书名/剧集/EP001.' },
      section: { type: 'string', enum: PRODUCTION_INTENT_SECTIONS },
      targetId: { type: 'string' },
      shotIds: { type: 'array', items: { type: 'string' } },
      jobId: { type: 'string', description: 'Actual framework job ID returned by an already started background command.' },
      requestId: { type: 'string', description: 'Production request ID from the confirmed preparation; required for track_job.' },
      jobKind: { type: 'string', enum: PRODUCTION_INTENT_JOB_KINDS },
      expectedOutputs: { type: 'integer', description: 'Planned output count. This is not execution progress or proof of output success.' },
      prompt: { type: 'string', description: 'Exact prompt/specification for a tracked job; not a production authorization.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: PRODUCTION_INTENT_ACTIONS },
          episode: { type: 'string', required: true },
          message: { type: 'string', required: true },
          production: PRODUCTION_BINDING_SCHEMA,
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.production === undefined ? value.message : JSON.stringify({ production: value.production }) }],
      presentationMeta: (_args, value) => value.production === undefined ? {} : { production: value.production },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const intent = validateProductionIntent({ ...args, requestId: args.requestId as ProductionRequestId | undefined })
      if (intent.action !== 'track_job') return { action: intent.action, episode: intent.episode, message: intentMessage(intent) }
      if (exec.agent === undefined) throw new Error('creative_production track_job requires the current Session Agent.')
      const context = await resolveProductionContext({
        requestId: intent.requestId, episode: intent.episode, targetId: intent.targetId, kind: intent.jobKind,
        ...(intent.expectedOutputs === undefined ? {} : { expectedOutputs: intent.expectedOutputs }),
        ...(intent.prompt === undefined ? {} : { prompt: intent.prompt }),
      }, exec.agent)
      const snapshot = ownedProductionJob(exec.agent, intent.jobId as JobId)
      return {
        action: intent.action, episode: intent.episode, message: intentMessage(intent),
        production: { ...context, job: { jobId: snapshot.id, startedAt: snapshot.startedAt } },
      }
    },
  })
}

/**
 * Register {@link createCreativeProductionTool} into the tools registry.
 * @param context - the plugin context holding the tools service.
 */
export function registerCreativeProductionTool(context: Context): void {
  context.tools.register(createCreativeProductionTool())
}
