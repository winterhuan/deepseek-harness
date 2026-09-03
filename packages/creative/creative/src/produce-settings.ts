import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Settings namespace carrying the creative production runtime profile. */
export const CREATIVE_PRODUCE_SETTINGS_NAMESPACE = 'creative-produce'

/**
 * Deployment profile for the pinned creative production scripts. Secret values
 * never enter this section: each `*ApiKeyEnv` names one or more credential
 * references (comma-separated for rotation) the scripts' environment variable
 * resolves through, following the model provider pattern. Non-secret model,
 * endpoint, and polling choices live here so a deployment changes them
 * without editing host environment files.
 */
export interface ProduceConfig {
  /**
   * Credential references for the image key, comma-separated for rotation; a stored value may itself hold
   * newline-separated keys for bulk pools.
   * defaults to OPENAI_API_KEY.
   */
  readonly openaiApiKeyEnv?: string
  /**
   * Credential references for the Seedance key, comma-separated for rotation; a stored value may itself hold
   * newline-separated keys for bulk pools.
   * defaults to ARK_API_KEY.
   */
  readonly arkApiKeyEnv?: string
  /**
   * Credential references for the MiniMax key, comma-separated for rotation; a stored value may itself hold
   * newline-separated keys for bulk pools.
   * defaults to MINIMAX_API_KEY.
   */
  readonly minimaxApiKeyEnv?: string
  /**
   * Credential references for the MiMo key, comma-separated for rotation; a stored value may itself hold
   * newline-separated keys for bulk pools.
   * defaults to MIMO_API_KEY.
   */
  readonly mimoApiKeyEnv?: string
  /**
   * Credential references for the Fish key, comma-separated for rotation; a stored value may itself hold
   * newline-separated keys for bulk pools.
   * defaults to FISH_API_KEY.
   */
  readonly fishApiKeyEnv?: string
  /**
   * Credential references for the Agnes key, comma-separated for rotation; a stored value may itself hold
   * newline-separated keys for bulk pools.
   * defaults to AGNES_API_KEY.
   */
  readonly agnesApiKeyEnv?: string
  /** Image endpoint override; blank inherits the adapter default. */
  readonly openaiBaseUrl?: string
  /** MiniMax music endpoint override; blank inherits the adapter default. */
  readonly minimaxBaseUrl?: string
  /** MiniMax video endpoint override; blank inherits the adapter default. */
  readonly minimaxVideoBaseUrl?: string
  /** Seedance endpoint override; blank inherits the adapter default. */
  readonly seedanceBaseUrl?: string
  /** MiMo endpoint override; blank inherits the adapter default. */
  readonly mimoApiUrl?: string
  /** Exact enabled Seedance model or endpoint id; the adapter defines no default. */
  readonly seedanceModel?: string
  /** Exact enabled MiniMax video model id; the adapter defines no default. */
  readonly minimaxVideoModel?: string
  /** Resolutions the MiniMax video model accepts, e.g. 768P. */
  readonly minimaxVideoResolutions?: string
  /** Minimum whole-second duration the MiniMax video model accepts. */
  readonly minimaxVideoMinDuration?: number
  /** Maximum whole-second duration the MiniMax video model accepts. */
  readonly minimaxVideoMaxDuration?: number
  /** Ratios the MiniMax video model accepts, e.g. 9:16,16:9. */
  readonly minimaxVideoRatios?: string
  /** Ratios the Seedance model accepts, e.g. 9:16,16:9. */
  readonly seedanceAllowedRatios?: string
  /** Minimum whole-second duration the Seedance model accepts. */
  readonly seedanceMinDuration?: number
  /** Maximum whole-second duration the Seedance model accepts. */
  readonly seedanceMaxDuration?: number
  /** Seconds between MiniMax video status polls. */
  readonly minimaxVideoPollInterval?: number
  /** Seconds before a MiniMax video run times out. */
  readonly minimaxVideoTimeoutSeconds?: number
  /** Seconds between Seedance status polls. */
  readonly seedancePollInterval?: number
  /** Seconds before a Seedance run times out. */
  readonly seedanceTimeoutSeconds?: number
  /** Speech provider routing: auto, mimo-tts, or fish-audio. */
  readonly ttsProvider?: string
  /** MiMo model override; blank inherits the adapter default. */
  readonly mimoModel?: string
  /** MiMo narration voice; blank inherits the adapter default. */
  readonly mimoTtsVoice?: string
  /** Agnes endpoint override; blank inherits the adapter default. */
  readonly agnesBaseUrl?: string
  /** Exact Agnes image model id; blank uses agnes-image-2.5-flash. */
  readonly agnesImageModel?: string
  /** Exact Agnes video model id: agnes-video-2.5-flash (free) or agnes-video-2.5 (billed). */
  readonly agnesVideoModel?: string
  /** Seconds between Agnes video status polls. */
  readonly agnesVideoPollInterval?: number
  /** Seconds before an Agnes video run times out. */
  readonly agnesVideoTimeoutSeconds?: number
}

/** Schema of the creative-produce settings namespace and the plugin's produce entry. */
export const ProduceSettingsSchema = z.object({
  openaiApiKeyEnv: z.string().role('credential-ref').default('OPENAI_API_KEY'),
  arkApiKeyEnv: z.string().role('credential-ref').default('ARK_API_KEY'),
  minimaxApiKeyEnv: z.string().role('credential-ref').default('MINIMAX_API_KEY'),
  mimoApiKeyEnv: z.string().role('credential-ref').default('MIMO_API_KEY'),
  fishApiKeyEnv: z.string().role('credential-ref').default('FISH_API_KEY'),
  agnesApiKeyEnv: z.string().role('credential-ref').default('AGNES_API_KEY'),
  openaiBaseUrl: z.string(),
  minimaxBaseUrl: z.string(),
  minimaxVideoBaseUrl: z.string(),
  seedanceBaseUrl: z.string(),
  mimoApiUrl: z.string(),
  seedanceModel: z.string(),
  minimaxVideoModel: z.string(),
  minimaxVideoResolutions: z.string(),
  minimaxVideoMinDuration: z.number().step(1).min(1),
  minimaxVideoMaxDuration: z.number().step(1).min(1),
  minimaxVideoRatios: z.string(),
  seedanceAllowedRatios: z.string(),
  seedanceMinDuration: z.number().step(1).min(1),
  seedanceMaxDuration: z.number().step(1).min(1),
  minimaxVideoPollInterval: z.number().step(1).min(1),
  minimaxVideoTimeoutSeconds: z.number().step(1).min(1),
  seedancePollInterval: z.number().step(1).min(1),
  seedanceTimeoutSeconds: z.number().step(1).min(1),
  ttsProvider: z.string().default('auto'),
  mimoModel: z.string(),
  mimoTtsVoice: z.string(),
  agnesBaseUrl: z.string(),
  agnesImageModel: z.string(),
  agnesVideoModel: z.string(),
  agnesVideoPollInterval: z.number().step(1).min(1),
  agnesVideoTimeoutSeconds: z.number().step(1).min(1),
}) as z<ProduceConfig>

interface KeyAddress {
  /** Section field naming the credential reference. */
  readonly field: 'openaiApiKeyEnv' | 'arkApiKeyEnv' | 'minimaxApiKeyEnv' | 'mimoApiKeyEnv' | 'fishApiKeyEnv' | 'agnesApiKeyEnv'
  /** Fallback reference when the section names none. */
  readonly fallback: string
}

const KEY_ADDRESSES: readonly KeyAddress[] = [
  { field: 'openaiApiKeyEnv', fallback: 'OPENAI_API_KEY' },
  { field: 'arkApiKeyEnv', fallback: 'ARK_API_KEY' },
  { field: 'minimaxApiKeyEnv', fallback: 'MINIMAX_API_KEY' },
  { field: 'mimoApiKeyEnv', fallback: 'MIMO_API_KEY' },
  { field: 'fishApiKeyEnv', fallback: 'FISH_API_KEY' },
  { field: 'agnesApiKeyEnv', fallback: 'AGNES_API_KEY' },
]

interface ProfileAddress {
  /** Section field carrying the non-secret value. */
  readonly field: Exclude<keyof ProduceConfig, KeyAddress['field']>
  /** Environment variable the pinned scripts read. */
  readonly env: string
}

const PROFILE_ADDRESSES: readonly ProfileAddress[] = [
  { field: 'openaiBaseUrl', env: 'OPENAI_BASE_URL' },
  { field: 'minimaxBaseUrl', env: 'MINIMAX_BASE_URL' },
  { field: 'minimaxVideoBaseUrl', env: 'MINIMAX_VIDEO_BASE_URL' },
  { field: 'seedanceBaseUrl', env: 'SEEDANCE_BASE_URL' },
  { field: 'mimoApiUrl', env: 'MIMO_API_URL' },
  { field: 'seedanceModel', env: 'SEEDANCE_MODEL' },
  { field: 'minimaxVideoModel', env: 'MINIMAX_VIDEO_MODEL' },
  { field: 'minimaxVideoResolutions', env: 'MINIMAX_VIDEO_RESOLUTIONS' },
  { field: 'minimaxVideoMinDuration', env: 'MINIMAX_VIDEO_MIN_DURATION' },
  { field: 'minimaxVideoMaxDuration', env: 'MINIMAX_VIDEO_MAX_DURATION' },
  { field: 'minimaxVideoRatios', env: 'MINIMAX_VIDEO_RATIOS' },
  { field: 'seedanceAllowedRatios', env: 'SEEDANCE_ALLOWED_RATIOS' },
  { field: 'seedanceMinDuration', env: 'SEEDANCE_MIN_DURATION' },
  { field: 'seedanceMaxDuration', env: 'SEEDANCE_MAX_DURATION' },
  { field: 'minimaxVideoPollInterval', env: 'MINIMAX_VIDEO_POLL_INTERVAL' },
  { field: 'minimaxVideoTimeoutSeconds', env: 'MINIMAX_VIDEO_TIMEOUT_SECONDS' },
  { field: 'seedancePollInterval', env: 'SEEDANCE_POLL_INTERVAL' },
  { field: 'seedanceTimeoutSeconds', env: 'SEEDANCE_TIMEOUT_SECONDS' },
  { field: 'ttsProvider', env: 'TTS_PROVIDER' },
  { field: 'mimoModel', env: 'MIMO_MODEL' },
  { field: 'mimoTtsVoice', env: 'MIMO_TTS_VOICE' },
  { field: 'agnesBaseUrl', env: 'AGNES_BASE_URL' },
  { field: 'agnesImageModel', env: 'AGNES_IMAGE_MODEL' },
  { field: 'agnesVideoModel', env: 'AGNES_VIDEO_MODEL' },
  { field: 'agnesVideoPollInterval', env: 'AGNES_VIDEO_POLL_INTERVAL' },
  { field: 'agnesVideoTimeoutSeconds', env: 'AGNES_VIDEO_TIMEOUT_SECONDS' },
]

function text(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Project one resolved section into the environment a pinned production script
 * receives. Every entry is a deliberate caller opt-in, so credential-shaped
 * names survive the subprocess credential scrub. Resolution is per call with
 * no cross-operation cache: the settings section wins, the launch environment
 * covers what it does not name, and an unset value stays unset so the
 * script's own default applies.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param section - the currently authoritative profile.
 * @returns environment entries to forward explicitly; never secret metadata.
 */
export async function resolveProduceEnv(
  ctx: Context,
  section: ProduceConfig,
): Promise<Record<string, string>> {
  const envs = await resolveProduceEnvs(ctx, section)
  const first = envs[0]
  /* v8 ignore next -- resolveProduceEnvs always yields at least one environment. */
  if (first === undefined) throw new Error('produce settings resolved no key environment.')
  return first
}

/**
 * Split one key field into the credential references it names. A field may
 * carry several references separated by commas for rotation; a blank field
 * falls back to the single default reference.
 * @param declared - the section's raw field value.
 * @param fallback - the default reference when the field names none.
 * @returns the references to resolve, in rotation order.
 */
export function keyReferences(declared: unknown, fallback: string): string[] {
  const refs = typeof declared === 'string'
    ? declared.split(',').map(part => part.trim()).filter(part => part !== '')
    : []
  return refs.length > 0 ? refs : [fallback]
}

/**
 * Split one resolved credential value into the keys it carries. A value holds
 * either a single key or a bulk pool with one key per line, so thousands of
 * keys ride one reference while the credentials read stays a single lookup.
 * @param value - the stored credential value.
 * @returns the non-empty trimmed lines, in pool order.
 */
export function keyLines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/**
 * Project one resolved section into one environment per key rotation attempt.
 * Attempt zero carries every field's first resolved key, which is exactly what
 * {@link resolveProduceEnv} returns; later attempts rotate each multi-key
 * field independently while single-key fields repeat. Fields with no
 * resolvable key stay unset on every attempt so the script keeps reporting
 * `missing_credential` instead of receiving an empty value.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param section - the currently authoritative profile.
 * @returns one explicit environment per attempt; never secret metadata.
 */
export async function resolveProduceEnvs(
  ctx: Context,
  section: ProduceConfig,
): Promise<Array<Record<string, string>>> {
  const credentials = ctx.get('credentials')
  const launch = launchEnvironmentOf(ctx)
  const profile: Record<string, string> = {}
  for (const { field, env: name } of PROFILE_ADDRESSES) {
    const value = text(section[field]) ?? launch.get(name)?.value
    if (value !== undefined && value !== '') profile[name] = value
  }
  const rotations: Array<Array<{ readonly ref: string; readonly value: string }>> = []
  for (const { field, fallback } of KEY_ADDRESSES) {
    const variants: Array<{ ref: string; value: string }> = []
    for (const ref of keyReferences(section[field], fallback)) {
      const stored = await credentials?.resolve(credentialRef(ref))
      const raw = stored?.value ?? launch.get(ref)?.value
      if (typeof raw !== 'string') continue
      for (const line of keyLines(raw)) variants.push({ ref, value: line })
    }
    rotations.push(variants)
  }
  const attempts = Math.max(1, ...rotations.map(variants => variants.length))
  const envs: Array<Record<string, string>> = []
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const env: Record<string, string> = { ...profile }
    for (const variants of rotations) {
      if (variants.length === 0) continue
      const pick = variants[attempt % variants.length]
      /* v8 ignore next -- a non-empty rotation always yields a pick for a valid attempt. */
      if (pick === undefined) continue
      env[pick.ref] = pick.value
    }
    envs.push(env)
  }
  return envs
}

/**
 * Read the currently authoritative profile: the settings namespace when a
 * provider serves it, otherwise the composition entry the plugin loaded with.
 * @param ctx - plugin context optionally carrying the settings service.
 * @param entry - composition entry fallback when no provider is mounted.
 * @returns the resolved profile snapshot.
 */
export function currentProduceConfig(ctx: Context, entry: ProduceConfig): ProduceConfig {
  return (ctx.get('settings')?.get(CREATIVE_PRODUCE_SETTINGS_NAMESPACE) as ProduceConfig | undefined) ?? entry
}

/**
 * Expose the production profile on the Plugin configuration tab. The tool
 * resolves the section per call, so a committed change needs no
 * re-registration.
 * @param ctx - creative plugin context owning the namespace.
 * @param entry - composition entry seeding the base layer.
 */
export function registerProduceSettings(ctx: Context, entry: ProduceConfig): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, CREATIVE_PRODUCE_SETTINGS_NAMESPACE, ProduceSettingsSchema, entry, {
      setSource: () => {},
      onChange: () => {},
    })
  })
}
