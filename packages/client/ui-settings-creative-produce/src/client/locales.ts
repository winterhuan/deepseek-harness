/** Locale bundles for the creative production settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type CreativeProduceSettingsLocaleKey =
  | 'title' | 'description' | 'keySet' | 'keyUnset'
  | 'groupOpenai' | 'groupSeedance' | 'groupMinimax'
  | 'groupMimo' | 'groupFish' | 'groupAgnes' | 'groupVoice'
  | 'openaiKeyLabel' | 'openaiKeyHint'
  | 'arkKeyLabel' | 'arkKeyHint'
  | 'minimaxKeyLabel' | 'minimaxKeyHint'
  | 'mimoKeyLabel' | 'mimoKeyHint'
  | 'fishKeyLabel' | 'fishKeyHint'
  | 'agnesKeyLabel' | 'agnesKeyHint'
  | 'seedanceModel' | 'seedanceModelHint'
  | 'minimaxVideoModel' | 'minimaxVideoModelHint'
  | 'openaiBaseUrl' | 'minimaxBaseUrl' | 'minimaxVideoBaseUrl'
  | 'seedanceBaseUrl' | 'mimoApiUrl' | 'baseUrlHint'
  | 'agnesBaseUrl' | 'agnesImageModel' | 'agnesImageModelHint'
  | 'agnesVideoModel' | 'agnesVideoModelHint'
  | 'manageKeys' | 'keysDialogDescription' | 'keysDialogPlaceholder'
  | 'keysCount' | 'keysClear' | 'keysCloseLabel'
  | 'ttsProvider' | 'ttsProviderHint'
  | 'mimoModel' | 'mimoTtsVoice' | 'modelHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'discard' | 'saveFailed' | 'invalidNumber'

/** English copy. */
export const en: Record<CreativeProduceSettingsLocaleKey, string> = {
  title: 'Creative production',
  description: 'Keys and runtime profile for short-drama and video production.',
  keySet: 'A key is configured.',
  keyUnset: 'No key is configured.',
  groupOpenai: 'OpenAI (image)',
  groupSeedance: 'Seedance video (Volcengine Ark)',
  groupMinimax: 'MiniMax (video and music)',
  groupMimo: 'MiMo (video understanding and voice)',
  groupFish: 'Fish Audio (voice fallback)',
  groupAgnes: 'Agnes (image and video)',
  groupVoice: 'Voice routing',
  openaiKeyLabel: 'OpenAI API key (image)',
  openaiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key. Separate multiple references with commas to rotate across keys, failing over on authentication or rate-limit errors.',
  arkKeyLabel: 'Volcengine Ark API key (Seedance video)',
  arkKeyHint: 'Stored outside the settings file. Leave blank to keep the current key. Separate multiple references with commas to rotate across keys, failing over on authentication or rate-limit errors.',
  minimaxKeyLabel: 'MiniMax API key (video and music)',
  minimaxKeyHint: 'Stored outside the settings file. Leave blank to keep the current key. Separate multiple references with commas to rotate across keys, failing over on authentication or rate-limit errors.',
  mimoKeyLabel: 'MiMo API key (video understanding and voice)',
  mimoKeyHint: 'Stored outside the settings file. Leave blank to keep the current key. Separate multiple references with commas to rotate across keys, failing over on authentication or rate-limit errors.',
  fishKeyLabel: 'Fish Audio API key (voice fallback)',
  fishKeyHint: 'Stored outside the settings file. Leave blank to keep the current key. Separate multiple references with commas to rotate across keys, failing over on authentication or rate-limit errors.',
  agnesKeyLabel: 'Agnes API key (image and video)',
  agnesKeyHint: 'Stored outside the settings file. Leave blank to keep the current key. Separate multiple references with commas to rotate across keys, failing over on authentication or rate-limit errors.',
  seedanceModel: 'Seedance model',
  seedanceModelHint: 'The exact enabled Seedance model or endpoint id; the adapter defines no default.',
  minimaxVideoModel: 'MiniMax video model',
  minimaxVideoModelHint: 'The exact enabled MiniMax video model id; the adapter defines no default.',
  openaiBaseUrl: 'OpenAI endpoint',
  minimaxBaseUrl: 'MiniMax endpoint',
  minimaxVideoBaseUrl: 'MiniMax video endpoint',
  seedanceBaseUrl: 'Seedance endpoint',
  mimoApiUrl: 'MiMo endpoint',
  agnesBaseUrl: 'Agnes endpoint',
  baseUrlHint: 'Leave blank to use the adapter default.',
  ttsProvider: 'Speech provider',
  ttsProviderHint: 'auto, mimo-tts, or fish-audio. Leave blank for auto.',
  mimoModel: 'MiMo model',
  mimoTtsVoice: 'MiMo narration voice',
  modelHint: 'Leave blank to use the adapter default.',
  agnesImageModel: 'Agnes image model',
  agnesImageModelHint: 'Leave blank to use agnes-image-2.5-flash.',
  agnesVideoModel: 'Agnes video model',
  agnesVideoModelHint: 'agnes-video-2.5-flash is free; agnes-video-2.5 bills per second.',
  manageKeys: 'Manage keys in bulk',
  keysDialogDescription: 'One key per line; tens of thousands of lines are accepted. Saving replaces every key under the reference.',
  keysDialogPlaceholder: 'Paste one key per line',
  keysCount: 'Valid keys: ',
  keysClear: 'Clear',
  keysCloseLabel: 'Close the bulk keys dialog',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
}

/** Simplified Chinese copy. */
export const zh: Record<CreativeProduceSettingsLocaleKey, string> = {
  title: '创意生产',
  description: '短剧与视频生产的密钥与运行时配置。',
  keySet: '已配置密钥。',
  keyUnset: '未配置密钥。',
  groupOpenai: 'OpenAI（图片）',
  groupSeedance: 'Seedance 视频（火山引擎 Ark）',
  groupMinimax: 'MiniMax（视频与音乐）',
  groupMimo: 'MiMo（视频理解与语音）',
  groupFish: 'Fish Audio（语音兜底）',
  groupAgnes: 'Agnes（图片与视频）',
  groupVoice: '语音路由',
  openaiKeyLabel: 'OpenAI API Key（图片）',
  openaiKeyHint: '不写入设置文件。留空表示保持当前密钥。多个引用用英文逗号分隔，按顺序轮询，遇鉴权或限流失败自动换下一个。',
  arkKeyLabel: '火山引擎 Ark API Key（Seedance 视频）',
  arkKeyHint: '不写入设置文件。留空表示保持当前密钥。多个引用用英文逗号分隔，按顺序轮询，遇鉴权或限流失败自动换下一个。',
  minimaxKeyLabel: 'MiniMax API Key（视频与音乐）',
  minimaxKeyHint: '不写入设置文件。留空表示保持当前密钥。多个引用用英文逗号分隔，按顺序轮询，遇鉴权或限流失败自动换下一个。',
  mimoKeyLabel: 'MiMo API Key（视频理解与语音）',
  mimoKeyHint: '不写入设置文件。留空表示保持当前密钥。多个引用用英文逗号分隔，按顺序轮询，遇鉴权或限流失败自动换下一个。',
  fishKeyLabel: 'Fish Audio API Key（语音兜底）',
  fishKeyHint: '不写入设置文件。留空表示保持当前密钥。多个引用用英文逗号分隔，按顺序轮询，遇鉴权或限流失败自动换下一个。',
  agnesKeyLabel: 'Agnes API Key（图片与视频）',
  agnesKeyHint: '不写入设置文件。留空表示保持当前密钥。多个引用用英文逗号分隔，按顺序轮询，遇鉴权或限流失败自动换下一个。',
  seedanceModel: 'Seedance 模型',
  seedanceModelHint: '已启用的 Seedance 模型或端点 ID（必填，适配器不设默认值）。',
  minimaxVideoModel: 'MiniMax 视频模型',
  minimaxVideoModelHint: '已启用的 MiniMax 视频模型 ID（必填，适配器不设默认值）。',
  openaiBaseUrl: 'OpenAI 接口地址',
  minimaxBaseUrl: 'MiniMax 接口地址',
  minimaxVideoBaseUrl: 'MiniMax 视频接口地址',
  seedanceBaseUrl: 'Seedance 接口地址',
  mimoApiUrl: 'MiMo 接口地址',
  agnesBaseUrl: 'Agnes 接口地址',
  baseUrlHint: '留空则使用适配器默认地址。',
  ttsProvider: '语音提供方',
  ttsProviderHint: 'auto、mimo-tts 或 fish-audio。留空表示 auto。',
  mimoModel: 'MiMo 模型',
  mimoTtsVoice: 'MiMo 解说声音',
  modelHint: '留空则使用适配器默认值。',
  agnesImageModel: 'Agnes 图片模型',
  agnesImageModelHint: '留空则使用 agnes-image-2.5-flash。',
  agnesVideoModel: 'Agnes 视频模型',
  agnesVideoModelHint: 'agnes-video-2.5-flash 免费；agnes-video-2.5 按秒计费。',
  manageKeys: '批量管理密钥',
  keysDialogDescription: '每行一个密钥，可粘贴上万行。保存后覆盖该引用下全部密钥。',
  keysDialogPlaceholder: '每行粘贴一个密钥',
  keysCount: '有效密钥：',
  keysClear: '清空',
  keysCloseLabel: '关闭批量密钥弹框',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: CreativeProduceSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
