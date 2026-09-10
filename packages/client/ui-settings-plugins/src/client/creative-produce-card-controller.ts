/**
 * The creative production card's staged form over the `creative-produce`
 * settings namespace.
 *
 * Six provider keys are staged here — one per production backend — and none
 * of their literals ever rides a response: each writes through the credentials
 * domain under the reference its section field names. The runtime profile
 * (models, endpoints, voice routing) stages as ordinary section fields beside
 * them, so one save covers everything the card shows.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the creative production profile. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const CREATIVE_PRODUCE_NS = 'creative-produce'

/** Section fields this card edits. */
export interface CreativeProduceSettings {
  /** Credential reference naming the image key. */
  openaiApiKeyEnv?: string
  /** Credential reference naming the Seedance key. */
  arkApiKeyEnv?: string
  /** Credential reference naming the MiniMax key. */
  minimaxApiKeyEnv?: string
  /** Credential reference naming the MiMo key. */
  mimoApiKeyEnv?: string
  /** Credential reference naming the Fish key. */
  fishApiKeyEnv?: string
  /** Credential reference naming the Agnes key. */
  agnesApiKeyEnv?: string
  /** Image endpoint; blank inherits the adapter default. */
  openaiBaseUrl?: string
  /** MiniMax music endpoint; blank inherits the adapter default. */
  minimaxBaseUrl?: string
  /** MiniMax video endpoint; blank inherits the adapter default. */
  minimaxVideoBaseUrl?: string
  /** Seedance endpoint; blank inherits the adapter default. */
  seedanceBaseUrl?: string
  /** MiMo endpoint; blank inherits the adapter default. */
  mimoApiUrl?: string
  /** Exact Seedance model/endpoint id; the adapter defines no default. */
  seedanceModel?: string
  /** Exact MiniMax video model id; the adapter defines no default. */
  minimaxVideoModel?: string
  /** Speech provider routing; the adapter defaults to auto. */
  ttsProvider?: string
  /** MiMo model; blank inherits the adapter default. */
  mimoModel?: string
  /** MiMo narration voice; blank inherits the adapter default. */
  mimoTtsVoice?: string
  /** Agnes endpoint; blank inherits the adapter default. */
  agnesBaseUrl?: string
  /** Exact Agnes image model id; blank uses agnes-image-2.5-flash. */
  agnesImageModel?: string
  /** Exact Agnes video model id: agnes-video-2.5-flash (free) or agnes-video-2.5 (billed). */
  agnesVideoModel?: string
}

/** One staged provider key. */
export type ProduceKeyField = 'openaiApiKey' | 'arkApiKey' | 'minimaxApiKey' | 'mimoApiKey' | 'fishApiKey' | 'agnesApiKey'

const KEY_FIELDS: readonly ProduceKeyField[] = ['openaiApiKey', 'arkApiKey', 'minimaxApiKey', 'mimoApiKey', 'fishApiKey', 'agnesApiKey']

const KEY_REF_FALLBACK: Readonly<Record<ProduceKeyField, string>> = {
  openaiApiKey: 'OPENAI_API_KEY',
  arkApiKey: 'ARK_API_KEY',
  minimaxApiKey: 'MINIMAX_API_KEY',
  mimoApiKey: 'MIMO_API_KEY',
  fishApiKey: 'FISH_API_KEY',
  agnesApiKey: 'AGNES_API_KEY',
}

const KEY_REF_FIELD: Readonly<Record<ProduceKeyField, keyof CreativeProduceSettings>> = {
  openaiApiKey: 'openaiApiKeyEnv',
  arkApiKey: 'arkApiKeyEnv',
  minimaxApiKey: 'minimaxApiKeyEnv',
  mimoApiKey: 'mimoApiKeyEnv',
  fishApiKey: 'fishApiKeyEnv',
  agnesApiKey: 'agnesApiKeyEnv',
}

/** What the credentials domain last reported for one key. */
interface KeyCredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** One key control as the card renders it. */
export interface ProduceKeyControlState {
  /** The staged credential, which starts blank on every load. */
  draft: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  configured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  writable: boolean
}

/** What the creative production card renders. */
export interface CreativeProduceCardState extends CardShell {
  /** Provider keys by control. */
  keys: Record<ProduceKeyField, ProduceKeyControlState>
  /** Seedance model/endpoint id. */
  seedanceModel: CardFieldState
  /** MiniMax video model id. */
  minimaxVideoModel: CardFieldState
  /** Image endpoint. */
  openaiBaseUrl: CardFieldState
  /** MiniMax music endpoint. */
  minimaxBaseUrl: CardFieldState
  /** MiniMax video endpoint. */
  minimaxVideoBaseUrl: CardFieldState
  /** Seedance endpoint. */
  seedanceBaseUrl: CardFieldState
  /** MiMo endpoint. */
  mimoApiUrl: CardFieldState
  /** Speech provider routing. */
  ttsProvider: CardFieldState
  /** MiMo model. */
  mimoModel: CardFieldState
  /** MiMo narration voice. */
  mimoTtsVoice: CardFieldState
  /** Agnes endpoint. */
  agnesBaseUrl: CardFieldState
  /** Agnes image model. */
  agnesImageModel: CardFieldState
  /** Agnes video model. */
  agnesVideoModel: CardFieldState
}

/** The registration-side face the creative production card's slot entry injects. */
export interface CreativeProduceCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useCreativeProduceCard. */
    creativeProduceCard: SnapshotStore<CreativeProduceCardState>
  }
  /**
   * Write one provider's keys immediately, bypassing the card's staged save.
   * The bulk dialog owns its own save gesture, so it commits directly instead
   * of staging thousands of lines into the card form.
   */
  saveKeys: (field: ProduceKeyField, text: string) => Promise<boolean>
}

/** Bridges the `creative-produce` scope and the credentials domain onto the card. */
export class CreativeProduceCardController {
  private readonly form: CardForm<CreativeProduceSettings>
  private readonly store: SnapshotStore<CreativeProduceCardState>
  private readonly credentials = new Map<ProduceKeyField, KeyCredentialState>()

  /**
   * @param scope - the bound settings scope for the `creative-produce` namespace.
   * @param ctx - the card plugin's context, whose `remote.credentials` namespace
   * answers for the credentials the section references.
   */
  constructor(
    private readonly scope: SettingsScope<CreativeProduceSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new CardForm(
      scope,
      [
        textField('seedanceModel'), textField('minimaxVideoModel'),
        textField('openaiBaseUrl'), textField('minimaxBaseUrl'), textField('minimaxVideoBaseUrl'),
        textField('seedanceBaseUrl'), textField('mimoApiUrl'),
        textField('ttsProvider'), textField('mimoModel'), textField('mimoTtsVoice'),
        textField('agnesBaseUrl'), textField('agnesImageModel'), textField('agnesVideoModel'),
      ],
      KEY_FIELDS.map(field => ({ field, write: (text: string) => this.writeKey(field, text) })),
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredentials() })
    void this.readCredentials()
  }

  private credential(field: ProduceKeyField): KeyCredentialState {
    return this.credentials.get(field) ?? { ref: '', configured: false, writable: true }
  }

  private projection(): CreativeProduceCardState {
    const keys = Object.fromEntries(KEY_FIELDS.map((field) => {
      const state = this.credential(field)
      return [field, {
        draft: this.form.field(field),
        configured: state.configured,
        writable: state.writable,
      } satisfies ProduceKeyControlState]
    })) as Record<ProduceKeyField, ProduceKeyControlState>
    return {
      ...this.form.shell(),
      keys,
      seedanceModel: this.form.field('seedanceModel'),
      minimaxVideoModel: this.form.field('minimaxVideoModel'),
      openaiBaseUrl: this.form.field('openaiBaseUrl'),
      minimaxBaseUrl: this.form.field('minimaxBaseUrl'),
      minimaxVideoBaseUrl: this.form.field('minimaxVideoBaseUrl'),
      seedanceBaseUrl: this.form.field('seedanceBaseUrl'),
      mimoApiUrl: this.form.field('mimoApiUrl'),
      ttsProvider: this.form.field('ttsProvider'),
      mimoModel: this.form.field('mimoModel'),
      mimoTtsVoice: this.form.field('mimoTtsVoice'),
      agnesBaseUrl: this.form.field('agnesBaseUrl'),
      agnesImageModel: this.form.field('agnesImageModel'),
      agnesVideoModel: this.form.field('agnesVideoModel'),
    }
  }

  /**
   * Ask the credentials domain about every reference the section names, in one
   * call. Each answer is stored with the reference it describes: a reference
   * can change between the request and its response, so a response publishes
   * only while it still answers for the references in force.
   */
  private async readCredentials(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const watches = KEY_FIELDS.map(field => ({ field, ref: refOf(field, snapshot) }))
    let changed = false
    for (const { field, ref } of watches) {
      if (ref !== this.credential(field).ref) {
        // A new reference knows nothing yet; keeping the old answer would claim
        // the key is configured under a name nobody has checked.
        this.credentials.set(field, { ref, configured: false, writable: true })
        changed = true
      }
    }
    if (changed) this.store.set(this.projection())
    const response = await this.ctx.remote.credentials.describe(watches.map(watch => watch.ref))
    if (!response.ok) return
    const live = this.scope.getSnapshot()
    let settled = false
    for (const { field, ref } of watches) {
      if (ref !== refOf(field, live)) continue
      const view = response.value[ref]
      const next: KeyCredentialState = {
        ref,
        configured: view?.configured ?? false,
        // An unknown reference is treated as writable: the control stays usable
        // and the Host is what refuses, rather than the card guessing a refusal.
        writable: view?.writable ?? true,
      }
      const current = this.credential(field)
      if (next.configured === current.configured && next.writable === current.writable && next.ref === current.ref) continue
      this.credentials.set(field, next)
      settled = true
    }
    if (settled) this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to a watched reference.
   *
   * A key can be written from somewhere else — the Models page may address an
   * overlapping reference — and the settings section does not change when it
   * is, so without this the badge keeps reporting a state the Host already
   * replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (!KEY_FIELDS.some(field => this.credential(field).ref === ref)) return
    void this.readCredentials()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): CreativeProduceCardFace {
    return {
      hooks: { creativeProduceCard: this.store },
      ...this.form.actions(),
      saveKeys: (field, text) => this.saveKeys(field, text),
    }
  }

  /**
   * Write one provider's keys from the bulk dialog. Blank lines never reach
   * the store: only non-empty trimmed lines are stored, and a text without
   * any writes nothing.
   * @param field - which provider key to write.
   * @param text - the dialog's whole text, one key per line.
   * @returns whether the Host reports a configured credential afterwards.
   */
  async saveKeys(field: ProduceKeyField, text: string): Promise<boolean> {
    if (text.trim() === '') return false
    return this.writeKey(field, text.trim())
  }

  /**
   * Write one staged key, then re-read whether the Host now holds one.
   * @param field - which provider key to write.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(field: ProduceKeyField, value: string): Promise<boolean> {
    // Refusals surface through the re-read below: the Host is the only
    // authority on whether the key now exists.
    await this.ctx.remote.credentials.set(refOf(field, this.scope.getSnapshot()), value)
    await this.readCredentials()
    return this.credential(field).configured
  }
}

/**
 * The credential reference the section names for one key, or its default.
 * @param field - which provider key to address.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(field: ProduceKeyField, snapshot: SettingsScopeSnapshot<CreativeProduceSettings>): string {
  const declared = snapshot.value?.[KEY_REF_FIELD[field]]
  return declared !== undefined && declared.length > 0 ? declared : KEY_REF_FALLBACK[field]
}
