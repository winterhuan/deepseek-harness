/** Short-drama panel-owned locale namespace and dictionaries. */

/** Namespace for the short-drama panel copy. */
export const NS = 'ui-drama'

/** Simplified Chinese dictionary and source-of-truth key set. */
export const zh = {
  'view.drama': '短剧',
  'panel.empty.project': '这个会话的工作区还没有短剧项目。',
  'panel.empty.hint': '让 Agent 运行 drama_scaffold 创建项目骨架，再回到这里阅读。',
  'panel.loading': '载入中…',
  'panel.error': '加载失败：{message}',
  'panel.retry': '重试',
  'panel.refresh': '刷新',
  'panel.summary': '共 {episodes} 集 · 待生产 {pending} 项',
  'panel.tab.overview': '项目',
  'panel.tab.episodes': '剧集',
  'panel.row.episode': '剧集 {episode}',
  'panel.stage.develop': '开发',
  'panel.stage.screenplay': '剧本',
  'panel.stage.assets': '资产',
  'panel.stage.storyboard': '分镜',
  'panel.stage.image-prompts': '图片提示词',
  'panel.stage.video-prompts': '视频提示词',
  'panel.stage.produce': '生产',
  'panel.stage.review': '审查',
  'panel.documents': '创作文档',
  'panel.media': '制作成果',
  'panel.diagnostics': '诊断',
  'panel.shots': '镜头',
  'panel.assets': '资产',
  'panel.prompts': '提示词',
  'panel.empty.overview': '还没有可读的项目概览。',
  'panel.empty.episodes': '还没有剧集目录——drama_board 在写入一集时登记 剧集/EP001。',
  'panel.empty.documents': '这一集还没有五份创作文档。',
  'panel.empty.media': '制作成果/ 下还没有媒体。',
  'panel.empty.diagnostics': '无可读诊断。',
  'panel.episode.pane': '在左侧选择要阅读的剧集或文档。',
  'panel.truncated': '内容过长，已截断。',
} as const

/** Short-drama panel dictionary key. */
export type DramaKey = keyof typeof zh

/** English dictionary mirroring the zh key set. */
export const en: Record<DramaKey, string> = {
  'view.drama': 'Short Drama',
  'panel.empty.project': 'This session workspace holds no short-drama project yet.',
  'panel.empty.hint': 'Ask the agent to run drama_scaffold to create the project skeleton, then come back here to read.',
  'panel.loading': 'Loading…',
  'panel.error': 'Failed to load: {message}',
  'panel.retry': 'Retry',
  'panel.refresh': 'Refresh',
  'panel.summary': '{episodes} episodes · {pending} pending production',
  'panel.tab.overview': 'Project',
  'panel.tab.episodes': 'Episodes',
  'panel.row.episode': 'Episode {episode}',
  'panel.stage.develop': 'Develop',
  'panel.stage.screenplay': 'Screenplay',
  'panel.stage.assets': 'Assets',
  'panel.stage.storyboard': 'Storyboard',
  'panel.stage.image-prompts': 'Image prompts',
  'panel.stage.video-prompts': 'Video prompts',
  'panel.stage.produce': 'Producing',
  'panel.stage.review': 'Review',
  'panel.documents': 'Creator documents',
  'panel.media': 'Delivery',
  'panel.diagnostics': 'Diagnostics',
  'panel.shots': 'Shots',
  'panel.assets': 'Assets',
  'panel.prompts': 'Prompts',
  'panel.empty.overview': 'No readable project overview yet.',
  'panel.empty.episodes': 'No episode directories yet — drama_board registers 剧集/EP001 when you write one.',
  'panel.empty.documents': 'No creator documents yet for this episode.',
  'panel.empty.media': 'No media under 制作成果/ yet.',
  'panel.empty.diagnostics': 'No projection diagnostics — clean.',
  'panel.episode.pane': 'Pick an episode or document on the left to open it here.',
  'panel.truncated': 'Content was too long and has been truncated.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The short-drama panel's own namespace. */
    'ui-drama': DramaKey
  }
}
