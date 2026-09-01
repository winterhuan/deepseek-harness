/**
 * @deepseek-ai/dsh-host-game-studio — Game studio host plugin.
 *
 * Provides bundled novel-to-game skills and the workspace HTTP API that the
 * browser-side game studio panel uses to list projects, read/write source
 * files, serve media, and preview the playable build under an isolated,
 * sandboxed origin.
 * @module @deepseek-ai/dsh-host-game-studio
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import { createNovelToGameSkillProvider } from './skill-provider.js'
import { registerWorkspaceRoute } from './workspace-route.js'

/** Stable Cordis plugin name. */
export const name = 'game-studio-host'

/** Services required before the game-studio host plugin can activate. */
export const inject = ['skills', 'webServer', 'sessions', 'fs', 'typert']

/**
 * Register bundled novel-to-game skills and the game-studio workspace API.
 * @param ctx - Cordis context carrying skills, webServer, sessions, fs and typert.
 */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => createNovelToGameSkillProvider())
  registerWorkspaceRoute(ctx)
}

export { createNovelToGameSkillProvider } from './skill-provider.js'
export { registerWorkspaceRoute } from './workspace-route.js'
export type { GameProjectSummary, GameVerificationSummary } from './workspace-route.js'
