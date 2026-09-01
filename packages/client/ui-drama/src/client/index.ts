/**
 * Browser half of `@deepseek-ai/dsh-client-ui-drama`: the short-drama panel
 * in the conversation view switcher, plus its dictionaries. The view seats
 * into the `conversation.view` slot declared by ui-conversation; the
 * contribution lives with that declaration via `slots.inject`.
 * @module @deepseek-ai/dsh-client-ui-drama/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DramaView } from './DramaView.tsx'
import { NS, en, zh } from './locale.ts'

/** Services required before the view can be registered. */
export const inject = ['slots', 'locale']

/**
 * Register the dictionaries and the `drama` conversation view entry.
 * @param ctx - client Cordis context carrying the slots and locale seats.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-drama: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'drama',
    order: 1,
    label: () => t('view.drama'),
    locale: NS,
  }, DramaView))
}
