/** Story domain: fiction documents in the shared editor. */
import type { EditorDomain } from './types.ts'

/** The fiction workbench domain. */
export const storyDomain: EditorDomain<'story'> = {
  mode: 'story',
  surface: 'editor',
  groupOrder: ['正文', '大纲', '设定', '追踪', '对标', '参考资料'],
  treeLabelKey: 'tree.story.files',
  Empty: ({ t }) => <>{t('editor.empty.story.prefix')} <code>{t('editor.empty.story.command')}</code>{t('editor.empty.story.suffix')}</>,
}
