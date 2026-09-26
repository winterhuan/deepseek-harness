/** Registry of Creative workbench domains in tab order. */
import type { WorkbenchMode } from '../file-activity.js'
import { dramaDomain } from './drama.tsx'
import { gameDomain } from './game.tsx'
import { storyDomain } from './story.tsx'
import type { WorkbenchDomain } from './types.ts'
import { videoDomain } from './video.tsx'

export type { EditorDomain, StudioDomain, StudioProps, WorkbenchDomain } from './types.ts'
export { useDramaProduction } from './drama.tsx'

/** Every domain keyed by its mode. */
export const WORKBENCH_DOMAINS: { readonly [Mode in WorkbenchMode]: WorkbenchDomain<Mode> } = {
  story: storyDomain,
  drama: dramaDomain,
  game: gameDomain,
  video: videoDomain,
}

/** Workbench modes in tab order. */
export const WORKBENCH_MODES = ['story', 'drama', 'game', 'video'] as const satisfies readonly WorkbenchMode[]

/** Studio domains in tab order. */
export const STUDIO_DOMAINS = WORKBENCH_MODES.flatMap((mode) => {
  const domain: WorkbenchDomain = WORKBENCH_DOMAINS[mode]
  return domain.surface === 'studio' ? [domain] : []
})
