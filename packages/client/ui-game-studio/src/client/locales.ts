/** Game-studio-owned locale namespace and dictionaries. */

/** Namespace for the game-studio panel copy. */
export const NS = 'ui-game-studio'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'view.game': '游戏',
  'preview.empty.title': '还没有可试玩版本',
  'preview.empty.hint': '在右侧 Chat 使用 /novel-to-game quick，产物写入 game-adaptations/<project>/build/app/ 后会自动出现在这里。',
  'preview.loading': '正在载入预览…',
  'preview.ready': '预览已载入',
  'preview.building': 'Agent 正在更新游戏文件 · 当前预览保持不变',
  'preview.pending': '新版本已就绪 · 由你决定何时载入',
  'preview.error': '预览载入失败 · 可重新载入',
  'preview.reload': '载入新版本',
  'preview.refresh': '刷新',
  'preview.fullscreen': '全屏试玩',
  'preview.focusHint': '点击画面进入试玩',
  'preview.focused': '游戏正在接收键鼠输入',
  'project.workspace': '我的项目',
  'project.example': '内置示例',
  'project.label': '游戏项目',
  'panel.tab.preview': '试玩',
  'panel.tab.files': '项目文件',
  'panel.tab.qa': 'QA',
  'qa.status.pass': '通过',
  'qa.status.fail': '失败',
  'qa.status.notRun': '未运行',
  'qa.check.launch': '启动',
  'qa.check.render': '渲染',
  'qa.check.input': '输入',
  'qa.check.coreLoop': '核心循环',
  'qa.check.outcome': '结果',
  'qa.check.restart': '重开',
  'file.empty': '当前项目还没有可检查的文件。',
  'error': '加载失败：{message}',
  'retry': '重试',
} as const

/** English dictionary mirroring the zh key set. */
export const en: Record<GameStudioKey, string> = {
  'view.game': 'Game',
  'preview.empty.title': 'No playable build yet',
  'preview.empty.hint': 'Use /novel-to-game quick in Chat; the build will appear here once game-adaptations/<project>/build/app/ is ready.',
  'preview.loading': 'Loading preview…',
  'preview.ready': 'Preview loaded',
  'preview.building': 'Agent is updating the game · current preview unchanged',
  'preview.pending': 'New build ready · load when you want',
  'preview.error': 'Preview failed to load · retry',
  'preview.reload': 'Load new build',
  'preview.refresh': 'Refresh',
  'preview.fullscreen': 'Fullscreen',
  'preview.focusHint': 'Click to play',
  'preview.focused': 'Game is receiving input',
  'project.workspace': 'Workspace',
  'project.example': 'Example',
  'project.label': 'Game project',
  'panel.tab.preview': 'Play',
  'panel.tab.files': 'Files',
  'panel.tab.qa': 'QA',
  'qa.status.pass': 'PASS',
  'qa.status.fail': 'FAIL',
  'qa.status.notRun': 'NOT RUN',
  'qa.check.launch': 'Launch',
  'qa.check.render': 'Render',
  'qa.check.input': 'Input',
  'qa.check.coreLoop': 'Core Loop',
  'qa.check.outcome': 'Outcome',
  'qa.check.restart': 'Restart',
  'file.empty': 'No files to inspect in this project yet.',
  'error': 'Failed to load: {message}',
  'retry': 'Retry',
}

/** Game-studio dictionary key. */
export type GameStudioKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The game-studio panel's own namespace. */
    'ui-game-studio': GameStudioKey
  }
}
