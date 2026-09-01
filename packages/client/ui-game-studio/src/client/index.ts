/**
 * Browser half of `@deepseek-ai/dsh-client-ui-game-studio`: the game-studio
 * panel view in the conversation view switcher.
 * @module @deepseek-ai/dsh-client-ui-game-studio/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { GameStudioView } from './GameStudioView.tsx'
import { NS, en, zh } from './locales.ts'

/** Services required before the view can be registered. */
export const inject = ['slots', 'locale']

/**
 * Register the dictionaries and the `game-studio` conversation view entry.
 * @param ctx - client Cordis context carrying the slots and locale seats.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-game-studio: dictionaries')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'game-studio',
    order: 2,
    label: () => '游戏',
    locale: NS,
  }, GameStudioView))
}
