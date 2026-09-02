const TITLE_KEYS = [
  'display_name', 'title', 'name', 'shot_id', 'scene_id', 'episode_id', 'character_id',
  'location_id', 'view_id', 'prop_id', 'state_id', 'decision_id', 'occurrence_id', 'record_id', 'id',
] as const

export interface JsonlRecord {
  readonly line: number
  readonly raw: string
  readonly value?: unknown
  readonly title: string
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

function metadata(value: unknown, line: number): Pick<JsonlRecord, 'title' | 'type' | 'status'> {
  const record = objectRecord(value)
  if (record === undefined) return { title: typeof value === 'string' ? value : JSON.stringify(value) ?? `第 ${String(line)} 行` }
  const type = stringField(record, ['record_type', 'type', 'kind'])
  const acceptance = objectRecord(record.creator_acceptance)
  const status = stringField(record, ['status']) ?? (acceptance === undefined ? undefined : stringField(acceptance, ['status']))
  return {
    title: stringField(record, TITLE_KEYS) ?? `记录 ${String(line)}`,
    ...(type === undefined ? {} : { type }),
    ...(status === undefined ? {} : { status }),
  }
}

export function parseJsonl(content: string): JsonlRecord[] {
  const records: JsonlRecord[] = []
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  for (const [index, raw] of lines.entries()) {
    if (raw.trim() === '') continue
    try {
      const value = JSON.parse(raw) as unknown
      records.push({ line: index + 1, raw, value, ...metadata(value, index + 1) })
    } catch (error) {
      records.push({
        line: index + 1,
        raw,
        title: `第 ${String(index + 1)} 行格式错误`,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return records
}

const PREVIEW_LIMIT = 200

export function JsonlPreview({ content, label }: { readonly content: string; readonly label: string }) {
  const records = parseJsonl(content)
  if (records.length === 0) return <div className="creative-markdown-empty">这个 JSONL 文件还是空的。</div>
  const valid = records.filter(record => record.error === undefined).length
  const errors = records.length - valid
  const visible = records.slice(0, PREVIEW_LIMIT)
  return <section className="creative-jsonl" aria-label={`${label} 结构化预览`}>
    <header className="creative-jsonl-summary">
      <strong>{errors === 0 ? `${String(valid)} 条记录` : `${String(valid)} 条有效记录`}</strong>
      {errors > 0 && <span>{String(errors)} 条格式错误</span>}
      {records.length > PREVIEW_LIMIT && <span>仅显示前 {String(PREVIEW_LIMIT)} 条</span>}
    </header>
    <div className="creative-jsonl-records">
      {visible.map(record => record.error === undefined
        ? <details key={record.line} open={records.length <= 2}>
          <summary>
            <span>第 {String(record.line)} 行</span>
            <strong>{record.title}</strong>
            {record.type !== undefined && <code>{record.type}</code>}
            {record.status !== undefined && <em>{record.status}</em>}
          </summary>
          <pre><code>{JSON.stringify(record.value, null, 2)}</code></pre>
        </details>
        : <div className="creative-jsonl-error" key={record.line} role="alert">
          <strong>{record.title}</strong>
          <span>{record.error}</span>
          <pre>{record.raw}</pre>
        </div>)}
    </div>
  </section>
}
