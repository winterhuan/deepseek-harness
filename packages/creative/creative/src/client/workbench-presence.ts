/**
 * DSH is a general Harness: one installed plugin must not turn every Session
 * into a writing surface. The workbench claims the conversation layout only for
 * a workspace that actually holds creative work, and the creator can always
 * take the layout back.
 */

/** The creator's explicit choice for one workspace, when they made one. */
export type WorkbenchPreference = 'open' | 'closed'

/** The workspace facts presence depends on; satisfied by the workspace payload. */
export interface WorkbenchPresenceWorkspace {
  readonly files: readonly unknown[]
  readonly games: readonly { readonly source: 'workspace' | 'example' }[]
  readonly videos: readonly unknown[]
}

/** The localStorage surface the preference persists through, injectable for tests. */
export interface WorkbenchPreferenceStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * Decide whether a workspace holds creative work. The bundled game example
 * ships with the plugin, so it never counts.
 * @param workspace - the loaded workspace payload, if it arrived yet.
 * @returns true when story/drama files, workspace games, or video projects exist.
 */
export function hasCreativeProject(workspace: WorkbenchPresenceWorkspace | undefined): boolean {
  if (workspace === undefined) return false
  return workspace.files.length > 0
    || workspace.videos.length > 0
    || workspace.games.some(game => game.source === 'workspace')
}

/**
 * Resolve whether the workbench opens. An explicit creator choice always wins
 * over what the workspace happens to contain.
 * @param preference - the stored choice, if the creator made one.
 * @param creativeProject - whether the workspace currently holds creative work.
 * @returns true when the workbench takes the conversation layout.
 */
export function resolveWorkbenchOpen(preference: WorkbenchPreference | undefined, creativeProject: boolean): boolean {
  return preference === undefined ? creativeProject : preference === 'open'
}

/**
 * Local-storage key carrying one workspace's choice.
 * @param cwd - the workspace root the choice belongs to.
 * @returns the namespaced storage key.
 */
export function workbenchPreferenceKey(cwd: string): string {
  return `creative.workbench.${cwd}`
}

/**
 * Read one workspace's stored choice. The DSH Session Store is not persisted,
 * so the choice is kept per workspace instead.
 * @param storage - the persistence surface, if the browser allows one.
 * @param cwd - the workspace root, if the workspace arrived yet.
 * @returns the stored choice, if any is readable and valid.
 */
export function readWorkbenchPreference(
  storage: WorkbenchPreferenceStorage | undefined,
  cwd: string | undefined,
): WorkbenchPreference | undefined {
  if (storage === undefined || cwd === undefined) return undefined
  let value: string | null
  try {
    value = storage.getItem(workbenchPreferenceKey(cwd))
  } catch {
    return undefined
  }
  return value === 'open' || value === 'closed' ? value : undefined
}

/**
 * Store one workspace's choice.
 * @param storage - the persistence surface, if the browser allows one.
 * @param cwd - the workspace root, if the workspace arrived yet.
 * @param preference - the choice to keep.
 */
export function writeWorkbenchPreference(
  storage: WorkbenchPreferenceStorage | undefined,
  cwd: string | undefined,
  preference: WorkbenchPreference,
): void {
  if (storage === undefined || cwd === undefined) return
  // Private windows and blocked site data refuse to persist; the Session still keeps the choice.
  try {
    storage.setItem(workbenchPreferenceKey(cwd), preference)
  } catch {
    // The Session Store remains the in-session authority.
  }
}

/**
 * Resolve the browser persistence surface, if reading it is allowed at all.
 * @returns the local storage, or undefined where even reading it throws.
 */
export function workbenchPreferenceStorage(): WorkbenchPreferenceStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
