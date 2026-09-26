/**
 * The creative production settings section, node half: one Loader row whose
 * Config declaration IS the `creative-produce` namespace the web card edits.
 * Every field is volatile, so the section's live values come from the profile
 * layer the settings service projects, and the host production tool reads them
 * back through `settings.describe()`.
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ProduceConfig } from './produce-settings.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'creative-produce'

/** Plugin config (all optional — the settings section carries the defaults). */
export type Config = { readonly [K in keyof ProduceConfig]: Volatile<ProduceConfig[K]> }

export const Config = z.object({
  openaiApiKeyEnv: z.string().role('credential-ref').default('OPENAI_API_KEY').volatile(),
  arkApiKeyEnv: z.string().role('credential-ref').default('ARK_API_KEY').volatile(),
  minimaxApiKeyEnv: z.string().role('credential-ref').default('MINIMAX_API_KEY').volatile(),
  mimoApiKeyEnv: z.string().role('credential-ref').default('MIMO_API_KEY').volatile(),
  fishApiKeyEnv: z.string().role('credential-ref').default('FISH_API_KEY').volatile(),
  agnesApiKeyEnv: z.string().role('credential-ref').default('AGNES_API_KEY').volatile(),
  openaiBaseUrl: z.string().volatile(),
  minimaxBaseUrl: z.string().volatile(),
  minimaxVideoBaseUrl: z.string().volatile(),
  seedanceBaseUrl: z.string().volatile(),
  mimoApiUrl: z.string().volatile(),
  seedanceModel: z.string().volatile(),
  minimaxVideoModel: z.string().volatile(),
  minimaxVideoResolutions: z.string().volatile(),
  minimaxVideoMinDuration: z.number().step(1).min(1).volatile(),
  minimaxVideoMaxDuration: z.number().step(1).min(1).volatile(),
  minimaxVideoRatios: z.string().volatile(),
  seedanceAllowedRatios: z.string().volatile(),
  seedanceMinDuration: z.number().step(1).min(1).volatile(),
  seedanceMaxDuration: z.number().step(1).min(1).volatile(),
  minimaxVideoPollInterval: z.number().step(1).min(1).volatile(),
  minimaxVideoTimeoutSeconds: z.number().step(1).min(1).volatile(),
  seedancePollInterval: z.number().step(1).min(1).volatile(),
  seedanceTimeoutSeconds: z.number().step(1).min(1).volatile(),
  ttsProvider: z.string().default('auto').volatile(),
  mimoModel: z.string().volatile(),
  mimoTtsVoice: z.string().volatile(),
  agnesBaseUrl: z.string().volatile(),
  agnesImageModel: z.string().volatile(),
  agnesVideoModel: z.string().volatile(),
  agnesVideoPollInterval: z.number().step(1).min(1).volatile(),
  agnesVideoTimeoutSeconds: z.number().step(1).min(1).volatile(),
}) as z<Config>

/** Host plugin body — the section exists through the Config declaration alone. */
export function apply(): void {}
