/** Typed normalization of Creative job references in settled tool results. */

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

const PRODUCTION_TOOLS = new Set(['creative_production', 'creative_produce_run'])

/**
 * Replace process-local job epochs with stable, relationship-preserving ordinals.
 * Only Creative Native results and PTC sub-results participate; prose and other
 * tools retain their original numbers. Repeated references keep the same epoch,
 * while a reused job ID with another start time remains a different execution.
 * @param records - parsed Session records owned by the current normalization pass.
 */
export function normalizeProductionJobReferences(records: readonly Record<string, unknown>[]): void {
  const calls = new Map<string, string>()
  const epochs = new Map<string, number>()
  for (const record of records) {
    const data = object(record.data)
    if (record.type === 'tool/call' && typeof data?.callId === 'string' && typeof data.name === 'string') {
      calls.set(data.callId, data.name)
    }
  }

  function normalizeBinding(value: unknown): boolean {
    const binding = object(value)
    const job = object(binding?.job)
    if (binding === undefined || typeof binding.requestId !== 'string' || typeof binding.episode !== 'string'
      || typeof binding.targetId !== 'string' || !['image', 'video', 'composition'].includes(String(binding.kind))
      || typeof job?.jobId !== 'string' || typeof job.startedAt !== 'number' || !Number.isFinite(job.startedAt)) return false
    const key = JSON.stringify([job.jobId, job.startedAt])
    const epoch = epochs.get(key) ?? epochs.size + 1
    epochs.set(key, epoch)
    job.startedAt = epoch
    return true
  }

  function normalizeContent(value: unknown): void {
    if (!Array.isArray(value)) return
    for (const item of value) {
      const block = object(item)
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      let decoded: unknown
      try {
        decoded = JSON.parse(block.text)
      } catch (error) {
        if (error instanceof SyntaxError) continue
        throw error
      }
      if (normalizeBinding(object(decoded)?.production)) block.text = JSON.stringify(decoded)
    }
  }

  for (const record of records) {
    const data = object(record.data)
    if (data === undefined) continue
    if (record.type === 'tool/ptc-dispatch' && typeof data.name === 'string' && PRODUCTION_TOOLS.has(data.name)) {
      normalizeContent(data.content)
    }
    if (record.type !== 'tool/result') continue
    const message = object(data.message)
    const callId = object(message?.source)?.callId
    if (typeof callId !== 'string' || !PRODUCTION_TOOLS.has(calls.get(callId) ?? '')) continue
    normalizeBinding(object(data.meta)?.production)
    if (!Array.isArray(message?.content)) continue
    for (const item of message.content) {
      const block = object(item)
      if (block?.type === 'tool-result' && block.toolCallId === callId) normalizeContent(block.content)
    }
  }
}
