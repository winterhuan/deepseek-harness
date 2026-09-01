/** Novel-panel-owned locale namespace and dictionaries. */

/** Namespace for the novel panel copy. */
export const NS = 'ui-novel'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'view.novel': '小说',
  'panel.summary': '共 {chapters} 章 · {words} 字 · 未回收伏笔 {foreshadows} 条',
  'panel.tab.chapters': '章节',
  'panel.tab.outline': '大纲',
  'panel.tab.characters': '人物',
  'panel.tab.tracking': '追踪',
  'panel.empty.tracking': '还没有追踪视图——用 novel_track 在 .novel/ 下生成。',
  'panel.empty.project': '这个会话的工作区还没有小说项目。',
  'panel.empty.hint': '让 Agent 运行 novel_scaffold 创建项目骨架，然后回到这里阅读。',
  'panel.empty.pane': '在左侧选择要阅读的章节或文档。',
  'panel.empty.outline': '还没有 outline.md。',
  'panel.empty.characters': 'characters/ 下还没有人物小传。',
  'panel.error': '加载失败：{message}',
  'panel.retry': '重试',
  'panel.refresh': '刷新',
  'panel.loading': '载入中…',
  'panel.truncated': '内容过长，已截断。',
  'panel.status.draft': '草稿',
  'panel.status.revised': '已修订',
  'panel.status.final': '定稿',
  'panel.words': '{words} 字',
} as const

/** English dictionary mirroring the zh key set. */
export const en: Record<NovelKey, string> = {
  'view.novel': 'Novel',
  'panel.summary': '{chapters} chapters · {words} chars · {foreshadows} open foreshadows',
  'panel.tab.chapters': 'Chapters',
  'panel.tab.outline': 'Outline',
  'panel.tab.characters': 'Characters',
  'panel.empty.project': 'This session workspace holds no novel project yet.',
  'panel.empty.hint': 'Ask the agent to run novel_scaffold to create the project skeleton, then come back here to read.',
  'panel.empty.pane': 'Pick a chapter or document on the left to read it here.',
  'panel.empty.outline': 'No outline.md yet.',
  'panel.tab.tracking': 'Tracking',
  'panel.empty.characters': 'No character sheets under characters/ yet.',
  'panel.empty.tracking': 'No tracking views yet — novel_track generates them under .novel/.',
  'panel.error': 'Failed to load: {message}',
  'panel.retry': 'Retry',
  'panel.refresh': 'Refresh',
  'panel.loading': 'Loading…',
  'panel.truncated': 'Content was too long and has been truncated.',
  'panel.status.draft': 'Draft',
  'panel.status.revised': 'Revised',
  'panel.status.final': 'Final',
  'panel.words': '{words} chars',
}

/** Novel-panel dictionary key. */
export type NovelKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The novel panel's own namespace. */
    'ui-novel': NovelKey
  }
}
