/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-novel`.
 * @module @deepseek-ai/dsh-client-ui-novel/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-novel'

/** Cordis companion plugin name. */
export const name = 'client-ui-novel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the node half's route registrations are effects owned
 * and observed by the webserver registry and covered by route specs against
 * stub services; the browser view is covered by component specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
