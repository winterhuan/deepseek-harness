import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales/index.ts'

// JSON property names scanned for a record heading, not display copy.
const RECORD_NAME_KEYS = [
  'display_name', 'title', 'name', 'shot_id', 'scene_id', 'episode_id', 'character_id',
  'location_id', 'view_id', 'prop_id', 'state_id', 'decision_id', 'occurrence_id', 'record_id', 'id',
] as const

export interface JsonlRecord {
  readonly line: number
  readonly raw: string
  readonly value?: unknown
  /** Heading from the record's own fields; `undefined` falls back to the localized line label. */
  readonly title?: string
  readonly type?: string
  readonly status?: string
  readonly error?: string
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

function metadata(value: unknown): Pick<JsonlRecord, 'title' | 'type' | 'status'> {
  const record = objectRecord(value)
  if (record === undefined) return { title: typeof value === 'string' ? value : JSON.stringify(value) ?? String(value) }
  const type = stringField(record, ['record_type', 'type', 'kind'])
  const acceptance = objectRecord(record.creator_acceptance)
  const status = stringField(record, ['status']) ?? (acceptance === undefined ? undefined : stringField(acceptance, ['status']))
  const title = stringField(record, RECORD_NAME_KEYS)
  return {
    ...(title === undefined ? {} : { title }),
    ...(type === undefined ? {} : { type }),
    ...(status === undefined ? {} : { status }),
  }
}

/** Parse JSONL into display records; malformed lines keep their raw text and the parse error. */
export function parseJsonl(content: string): JsonlRecord[] {
  const records: JsonlRecord[] = []
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  for (const [index, raw] of lines.entries()) {
    if (raw.trim() === '') continue
    try {
      const value = JSON.parse(raw) as unknown
      records.push({ line: index + 1, raw, value, ...metadata(value) })
    } catch (error) {
      records.push({
        line: index + 1,
        raw,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return records
}

const PREVIEW_LIMIT = 200

function recordTitle(t: TranslateNS<typeof NS>, record: JsonlRecord): string {
  return record.title ?? (record.error === undefined ? t('jsonl.record', { line: String(record.line) }) : t('jsonl.line.malformed', { line: String(record.line) }))
}

export function JsonlPreview({ content, label, t }: {
  readonly content: string
  readonly label: string
  readonly t: TranslateNS<typeof NS>
}) {
  const records = parseJsonl(content)
  if (records.length === 0) return <div className="creative-markdown-empty">{t('jsonl.empty')}</div>
  const valid = records.filter(record => record.error === undefined).length
  const errors = records.length - valid
  const visible = records.slice(0, PREVIEW_LIMIT)
  return <section className="creative-jsonl" aria-label={t('jsonl.preview', { label })}>
    <header className="creative-jsonl-summary">
      <strong>{errors === 0 ? t('jsonl.summary.records', { count: String(valid) }) : t('jsonl.summary.valid', { count: String(valid) })}</strong>
      {errors > 0 && <span>{t('jsonl.summary.errors', { count: String(errors) })}</span>}
      {records.length > PREVIEW_LIMIT && <span>{t('jsonl.summary.limit', { count: String(PREVIEW_LIMIT) })}</span>}
    </header>
    <div className="creative-jsonl-records">
      {visible.map(record => record.error === undefined
        ? <details key={record.line} open={records.length <= 2}>
          <summary>
            <span>{t('jsonl.line', { line: String(record.line) })}</span>
            <strong>{recordTitle(t, record)}</strong>
            {record.type !== undefined && <code>{record.type}</code>}
            {record.status !== undefined && <em>{record.status}</em>}
          </summary>
          <pre><code>{JSON.stringify(record.value, null, 2)}</code></pre>
        </details>
        : <div className="creative-jsonl-error" key={record.line} role="alert">
          <strong>{recordTitle(t, record)}</strong>
          <span>{record.error}</span>
          <pre>{record.raw}</pre>
        </div>)}
    </div>
  </section>
}
