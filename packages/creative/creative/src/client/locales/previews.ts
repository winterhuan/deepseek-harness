/** `creative` namespace fragment: shared preview and notice copy. */

/** Simplified Chinese fragment (the key-set source of truth). */
export const zh = {
  'session.unavailable': 'DSH 会话不可用：在当前会话发一句话以恢复连接，然后点 ↻ 刷新。',
  'markdown.empty': '这个 Markdown 文件还是空的。',
  'markdown.preview': '渲染预览',
  'markdown.task.done': '已完成',
  'markdown.task.pending': '未完成',
  'jsonl.empty': '这个 JSONL 文件还是空的。',
  'jsonl.preview': '{label} 结构化预览',
  'jsonl.line': '第 {line} 行',
  'jsonl.record': '记录 {line}',
  'jsonl.line.malformed': '第 {line} 行格式错误',
  'jsonl.summary.records': '{count} 条记录',
  'jsonl.summary.valid': '{count} 条有效记录',
  'jsonl.summary.errors': '{count} 条格式错误',
  'jsonl.summary.limit': '仅显示前 {count} 条',
} as const

/** English fragment, key-identical to the Chinese source of truth. */
export const en: Record<keyof typeof zh, string> = {
  'session.unavailable': 'DSH session is unavailable: send one message in this session to reconnect, then press ↻ to reload.',
  'markdown.empty': 'This Markdown file is still empty.',
  'markdown.preview': 'rendered preview',
  'markdown.task.done': 'completed',
  'markdown.task.pending': 'not completed',
  'jsonl.empty': 'This JSONL file is still empty.',
  'jsonl.preview': '{label} structured preview',
  'jsonl.line': 'Line {line}',
  'jsonl.record': 'Record {line}',
  'jsonl.line.malformed': 'Line {line} is malformed',
  'jsonl.summary.records': '{count} records',
  'jsonl.summary.valid': '{count} valid records',
  'jsonl.summary.errors': '{count} malformed',
  'jsonl.summary.limit': 'Showing the first {count}',
}
