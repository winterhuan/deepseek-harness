/**
 * @deepseek-ai/dsh-client-ui-game-studio — game studio panel browser plugin.
 *
 * The browser half registers a `conversation.view` entry named `game-studio`
 * that renders the playable preview and project browser. The node half is a
 * no-op placeholder; the host plugin that owns the workspace API is supplied
 * by `@deepseek-ai/dsh-host-game-studio`.
 * @module @deepseek-ai/dsh-client-ui-game-studio
 */

/** Stable Cordis plugin name. */
export const name = 'client-ui-game-studio'

/** No host-side behavior. */
export function apply(): void {}
