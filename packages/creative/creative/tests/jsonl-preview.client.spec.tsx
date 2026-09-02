import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JsonlPreview, parseJsonl } from '../src/client/jsonl-preview.js'

describe('JsonlPreview', () => {
  it('summarizes typed records and preserves line numbers', () => {
    const content = [
      '{"record_type":"character","character_id":"CHAR-GUHE","display_name":"顾禾","creator_acceptance":{"status":"accepted"}}',
      '',
      '{"record_type":"shot","shot_id":"SHOT-001","scene_id":"SC001"}',
    ].join('\n')
    const records = parseJsonl(content)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ line: 1, title: '顾禾', type: 'character', status: 'accepted' })
    expect(records[1]).toMatchObject({ line: 3, title: 'SHOT-001', type: 'shot' })

    const html = renderToStaticMarkup(<JsonlPreview content={content} label="shots.jsonl" />)
    expect(html).toContain('2 条记录')
    expect(html).toContain('顾禾')
    expect(html).toContain('character')
    expect(html).toContain('accepted')
    expect(html).toContain('第 3 行')
  })

  it('shows malformed lines without hiding valid records', () => {
    const content = '{"record_type":"scene","scene_id":"SC001"}\n{"broken":\n42\n'
    const records = parseJsonl(content)
    expect(records).toHaveLength(3)
    expect(records[1]?.error).toBeDefined()
    expect(records[2]).toMatchObject({ line: 3, title: '42' })

    const html = renderToStaticMarkup(<JsonlPreview content={content} label="mixed.jsonl" />)
    expect(html).toContain('2 条有效记录')
    expect(html).toContain('1 条格式错误')
    expect(html).toContain('role="alert"')
    expect(html).toContain('{&quot;broken&quot;:')
  })
})
