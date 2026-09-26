/**
 * The creative production settings page, browser half: the six provider keys
 * and the runtime profile over the `creative-produce` namespace the
 * production adapters register. The page registers into the Plugins page's
 * `plugins.item` slot while the Host serves that namespace, so a deployment
 * without the adapters shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { CreativeProduceCard } from './CreativeProduceCard.tsx'
import { CREATIVE_PRODUCE_NS, CreativeProduceCardController } from './creative-produce-card-controller.ts'
import { en, zh, type CreativeProduceSettingsLocaleKey } from './locales.ts'

export type { CreativeProduceCardProps } from './CreativeProduceCard.tsx'
export type {
  CreativeProduceCardFace, CreativeProduceCardState, CreativeProduceSettings, ProduceKeyControlState, ProduceKeyField,
} from './creative-produce-card-controller.ts'
export type { CreativeProduceSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Creative production settings page copy. */
    'settings.creativeProduce': CreativeProduceSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.creativeProduce'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/**
 * Mount the creative production settings page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-creative-produce: dictionaries')
  const card = new CreativeProduceCardController(ctx.configForms.get(CREATIVE_PRODUCE_NS), ctx)
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-creative-produce: form subscription')
  // The credentials a page reports are not part of any settings section, so
  // its scope publishes nothing when one is written. This is the only signal
  // that a key written on another surface reached the Host.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { card.refreshCredential(ref) }),
    'ui-settings-creative-produce: credential invalidations',
  )
  ctx.effect(() => ctx.configForms.whileServed([CREATIVE_PRODUCE_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'creative-produce', order: 50, label: () => t('title'), locale: NS, inject: () => card.inject(),
  }, CreativeProduceCard))), 'ui-settings-creative-produce: page')
}
