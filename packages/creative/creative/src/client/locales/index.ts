/** `creative` namespace dictionaries, assembled from per-view fragments. */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { en as dramaEn, zh as dramaZh } from './drama.ts'
import { en as previewsEn, zh as previewsZh } from './previews.ts'
import { en as videoEn, zh as videoZh } from './video.ts'
import { en as workbenchEn, zh as workbenchZh } from './workbench.ts'

/** Dictionary namespace owned by this plugin. */
export const NS = 'creative'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  ...workbenchZh,
  ...dramaZh,
  ...videoZh,
  ...previewsZh,
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<CreativeLocaleKey, string> = {
  ...workbenchEn,
  ...dramaEn,
  ...videoEn,
  ...previewsEn,
}

/** Key domain of the `creative` namespace (zh is the source of truth). */
export type CreativeLocaleKey = keyof typeof zh

/** Translate function for tests and non-slot callers; no module augmentation needed. */
export type CreativeTranslate = Translate<CreativeLocaleKey>
