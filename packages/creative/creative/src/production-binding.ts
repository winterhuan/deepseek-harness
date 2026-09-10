/** Durable production request identities and non-consuming job references. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { parseCreativePath } from './project-path.ts'

/** Credential-aware producer tool whose results may bind a production request. */
export const CREATIVE_PRODUCE_RUN_TOOL_NAME = 'creative_produce_run'

/** Identity of a production card, independent of prompt RPCs and process jobs. */
export type ProductionRequestId = Branded<'ProductionRequestId'>

/**
 * Brand an already generated or validated production request identity.
 * @param value - raw request identity.
 * @returns the unchanged branded identity.
 */
export function ProductionRequestId(value: string): ProductionRequestId {
  return value as ProductionRequestId
}

/** Context supplied when a confirmed production request starts a real job. */
export interface ProductionContext {
  readonly requestId: ProductionRequestId
  readonly episode: string
  readonly targetId: string
  readonly kind: 'image' | 'video' | 'composition'
  readonly expectedOutputs?: number
  readonly prompt?: string
}

/** A logged association; job state belongs exclusively to the live registry. */
export interface ProductionBinding extends ProductionContext {
  readonly job: {
    readonly jobId: JobId
    readonly startedAt: number
  }
}

/** Tool input fields shared by produce execution and its durable result. */
export const PRODUCTION_CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requestId: { type: 'string', required: true, description: 'Production request identity from the confirmed preparation.' },
    episode: { type: 'string', required: true, description: 'Full workspace-relative episode path, including the book prefix.' },
    targetId: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['image', 'video', 'composition'] },
    expectedOutputs: { type: 'integer', description: 'Planned output count, not completed work.' },
    prompt: { type: 'string' },
  },
} as const

/** Structured job association persisted in both Native metadata and PTC content. */
export const PRODUCTION_BINDING_SCHEMA = {
  ...PRODUCTION_CONTEXT_SCHEMA,
  properties: {
    ...PRODUCTION_CONTEXT_SCHEMA.properties,
    job: {
      type: 'object', required: true, additionalProperties: false,
      properties: {
        jobId: { type: 'string', required: true },
        startedAt: { type: 'number', required: true },
      },
    },
  },
} as const

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Validate model arguments or persisted production context.
 * @param value - untrusted JSON value.
 * @returns normalized context, or undefined for unsupported fields and paths.
 */
export function parseProductionContext(value: unknown): ProductionContext | undefined {
  const record = object(value)
  if (record === undefined || typeof record.requestId !== 'string' || record.requestId.trim() === '' || record.requestId.length > 512
    || typeof record.episode !== 'string' || typeof record.targetId !== 'string' || record.targetId.trim() === '' || record.targetId.length > 512
    || (record.kind !== 'image' && record.kind !== 'video' && record.kind !== 'composition')
    || (record.prompt !== undefined && typeof record.prompt !== 'string')
    || (record.expectedOutputs !== undefined && (typeof record.expectedOutputs !== 'number' || !Number.isInteger(record.expectedOutputs) || record.expectedOutputs < 1 || record.expectedOutputs > 500))) return undefined
  const parsed = parseCreativePath(record.episode)
  if (parsed?.role !== 'episode' || parsed.path !== parsed.episodePath) return undefined
  return {
    requestId: ProductionRequestId(record.requestId), episode: parsed.path, targetId: record.targetId, kind: record.kind,
    ...(record.expectedOutputs === undefined ? {} : { expectedOutputs: record.expectedOutputs }),
    ...(record.prompt === undefined ? {} : { prompt: record.prompt }),
  }
}

/**
 * Decode an association without inferring execution from a tool call's arguments.
 * @param value - untrusted result metadata or decoded JSON content.
 * @returns the real job reference, or undefined for legacy and malformed results.
 */
export function parseProductionBinding(value: unknown): ProductionBinding | undefined {
  const context = parseProductionContext(value)
  const job = object(object(value)?.job)
  if (context === undefined || job === undefined || typeof job.jobId !== 'string' || job.jobId === ''
    || typeof job.startedAt !== 'number' || !Number.isFinite(job.startedAt) || job.startedAt < 0) return undefined
  return { ...context, job: { jobId: job.jobId as JobId, startedAt: job.startedAt } }
}
