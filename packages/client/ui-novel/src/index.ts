/**
 * `@deepseek-ai/dsh-client-ui-novel` — the novel-writing mode's reading panel.
 *
 * The node half registers two read-only HTTP routes (`/novel/overview`,
 * `/novel/document`) over the calling session's workspace; the browser half
 * (see `./client/index.ts`) registers a `conversation.view` entry named
 * `novel` that renders the panel against those routes. The on-disk project
 * conventions are owned by the `novelist` agent preset; this package only
 * reads them. The webserver is optional: deployments without HTTP transport
 * (headless, transport-less test boots) still mount the panel's browser half.
 * @module @deepseek-ai/dsh-client-ui-novel
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import { novelRoutes } from './routes.ts'

/** Stable Cordis plugin name. */
export const name = 'client-ui-novel'

/** Services required before the routes can be registered; the webserver is read optionally. */
export const inject = ['sessions', 'fs']

/**
 * Register the novel routes on the webserver for this plugin fiber's
 * lifetime. Without a webserver the routes are absent and the panel shows
 * its error state — the reading flow needs HTTP transport by definition.
 * @param ctx - Cordis context carrying the sessions and fs seats.
 */
export function apply(ctx: Context): void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return
  ctx.effect(() => {
    const disposers = novelRoutes({ fs: ctx.fs, sessions: ctx.sessions })
      .map(route => webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'client-ui-novel: /novel/overview + /novel/document routes')
}
