import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { createDramaSkillProvider, createNovelToGameSkillProvider, createCreativeSkillProvider, createVideoRecapSkillProvider } from './skill-provider.ts'
import { registerCreativeHooks } from './native-hooks.ts'
import { registerCreativeRoleTool } from './role-tool.ts'
import { registerCreativeProductionTool } from './production-tool.ts'
import { registerCreativeProduceRunTool } from './produce-tool.ts'
import { ProduceSettingsSchema, registerProduceSettings, type ProduceConfig } from './produce-settings.ts'
import { registerWorkspaceRoute } from './workspace-route.ts'
import { assertTrustedWorkspaceAuthority } from './workspace-request-trust.ts'

export { createDramaSkillProvider, createNovelToGameSkillProvider, createCreativeSkillProvider, createVideoRecapSkillProvider, parseBundledSkill } from './skill-provider.ts'
export { CREATIVE_ROLE_NAMES, loadBundledRole } from './role-provider.ts'
export { createCreativeRoleTool, CREATIVE_ROLE_TOOL_NAME, registerCreativeRoleTool, roleToolFilter, type CreativeRoleSubagents } from './role-tool.ts'
export { createCreativeProduceRunTool, DRAMA_ADAPTERS, CREATIVE_PRODUCE_RUN_TOOL_NAME, PRODUCE_ENTRIES, dramaScriptFor, registerCreativeProduceRunTool, type DramaAdapter, type ProduceEntry } from './produce-tool.ts'
export { createCreativeProductionTool, registerCreativeProductionTool } from './production-tool.ts'
export { CREATIVE_PRODUCTION_TOOL_NAME, validateProductionIntent, type ProductionIntentArgs } from './production-intent.ts'
export { bundledReferenceGuard, createCreativeReferenceTool, CREATIVE_REFERENCE_TOOL_NAME } from './reference-tool.ts'
export { registerWorkspaceRoute } from './workspace-route.ts'
export { registerCreativeHooks } from './native-hooks.ts'

export const name = 'creative'
export const inject = ['skills', 'subagents', 'tools', 'typert', 'webServer']

/** DSH owns models, providers, presets, permissions, roots, runs, and sessions. */
export interface Config {
  /** Largest creative file the workbench reads or writes, in bytes. */
  readonly editorMaxBytes?: number
  /** Extra non-loopback host authorities allowed to reach the workbench routes. */
  readonly trustedHosts?: string[]
  /** Production runtime profile seeding the creative-produce settings namespace. */
  readonly produce?: ProduceConfig
}

export const Config = z.object({
  editorMaxBytes: z.natural().min(65_536).max(8_388_608).default(2_097_152),
  trustedHosts: z.array(z.string()).default([]),
  produce: ProduceSettingsSchema,
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
  registerCreativeProductionTool(context)
  registerProduceSettings(context, config.produce ?? {})
  registerCreativeProduceRunTool(context, { entry: config.produce ?? {} })
  await registerCreativeRoleTool(context)
  registerWorkspaceRoute(context, { maxBytes: config.editorMaxBytes ?? 2_097_152, trustedHosts })
}

export default { name, inject, Config, apply }
