/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-game-studio`.
 * @module @deepseek-ai/dsh-client-ui-game-studio/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-game-studio'

/** Cordis companion plugin name. */
export const name = 'ui-game-studio-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the UI plugin registers slots and dictionaries on its fiber. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
