import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { createDramaSkillProvider, createNovelToGameSkillProvider, createCreativeSkillProvider, createVideoRecapSkillProvider } from './skill-provider.js'
import { registerCreativeHooks } from './native-hooks.js'
import { registerCreativeRoleTool } from './role-tool.js'
import { createCreativeProductionTool } from './production-tool.js'
import { registerWorkspaceRoute } from './workspace-route.js'
import { assertTrustedWorkspaceAuthority } from './workspace-request-trust.js'

export { createDramaSkillProvider, createNovelToGameSkillProvider, createCreativeSkillProvider, createVideoRecapSkillProvider, parseBundledSkill } from './skill-provider.js'
export { CREATIVE_ROLE_NAMES, loadBundledRole } from './role-provider.js'
export { createCreativeRoleTool, CREATIVE_ROLE_TOOL_NAME, registerCreativeRoleTool, roleToolFilter, type CreativeRoleSubagents } from './role-tool.js'
export { createCreativeProductionTool, registerCreativeProductionTool } from './production-tool.js'
export { CREATIVE_PRODUCTION_TOOL_NAME, validateProductionIntent, type ProductionIntentArgs } from './production-intent.js'
export { bundledReferenceGuard, createCreativeReferenceTool, CREATIVE_REFERENCE_TOOL_NAME } from './reference-tool.js'
export { registerWorkspaceRoute } from './workspace-route.js'
export { registerCreativeHooks } from './native-hooks.js'

export const name = 'creative'
export const inject = ['skills', 'subagents', 'tools', 'typert', 'webServer']

/** DSH owns models, providers, presets, permissions, roots, runs, and sessions. */
export interface Config {
  readonly editorMaxBytes?: number
  readonly trustedHosts?: string[]
}

export const Config = z.object({
  editorMaxBytes: z.natural().min(65_536).max(8_388_608).default(2_097_152),
  trustedHosts: z.array(z.string()).default([]),
}) as z<Config>

/** Mount only domain contributions into the current DSH process. */
export async function apply(context: Context, config: Config = {}): Promise<void> {
  const trustedHosts = config.trustedHosts ?? []
  for (const entry of trustedHosts) assertTrustedWorkspaceAuthority(entry)
  context.effect(() => context.skills.registerProvider(() => createCreativeSkillProvider()), 'creative: creative skills')
  context.effect(() => context.skills.registerProvider(() => createDramaSkillProvider()), 'creative: drama skills')
  context.effect(() => context.skills.registerProvider(() => createNovelToGameSkillProvider()), 'creative: novel-to-game skills')
  context.effect(() => context.skills.registerProvider(() => createVideoRecapSkillProvider()), 'creative: video-recap skills')
  registerCreativeHooks(context)
  context.effect(() => context.tools.register(createCreativeProductionTool()), 'creative: production tool')
  await registerCreativeRoleTool(context)
  registerWorkspaceRoute(context, { maxBytes: config.editorMaxBytes ?? 2_097_152, trustedHosts })
}
