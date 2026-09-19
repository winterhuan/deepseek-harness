/** Draft reconciliation and Session-owned in-flight save state. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** An editable file and its last acknowledged disk revision. */
export interface FileBuffer {
  readonly content: string
  readonly saved: string
  readonly source: 'disk' | 'human' | 'agent'
  readonly version: string
  readonly error?: string | undefined
  readonly missing?: boolean | undefined
  readonly conflict?: {
    readonly message: string
    readonly theirs?: string | undefined
    readonly theirsVersion?: string | undefined
  } | undefined
}

/** Disk content returned by the workspace text endpoint. */
export interface FilePayload {
  readonly path: string
  readonly content: string
  readonly bytes: number
  readonly version: string
}

/** Session editor buffers indexed by workspace-relative file path. */
export type FileBuffers = Record<string, FileBuffer>

/**
 * Remove save flags written by older workbench stores without discarding drafts.
 * @param buffers - rehydrated editor state.
 * @returns buffers without persisted in-flight state.
 */
export function restoreBuffers(buffers: FileBuffers): FileBuffers {
  let result = buffers
  for (const [path, buffer] of Object.entries(buffers)) {
    if (!('saving' in buffer)) continue
    const { saving: _saving, ...rest } = buffer
    if (result === buffers) result = { ...buffers }
    result[path] = rest
  }
  return result
}

/**
 * Reconcile a directory listing without treating a partial listing as deletion.
 * @param buffers - current editor content, including uncommitted human drafts.
 * @param paths - files present in the listing or currently being written.
 * @param truncated - whether the listing omits unknown files.
 * @param removedMessage - localized notice for a deleted file with a draft.
 * @returns retained drafts and live files; clean deleted buffers are removed.
 */
export function reconcileBuffers(
  buffers: FileBuffers,
  paths: ReadonlySet<string>,
  truncated: boolean,
  removedMessage: string,
): FileBuffers {
  if (truncated) return buffers
  let changed = false
  const result: FileBuffers = {}
  for (const [path, buffer] of Object.entries(buffers)) {
    if (paths.has(path)) {
      result[path] = buffer
    } else if (buffer.source === 'human' && buffer.content !== buffer.saved) {
      result[path] = buffer.missing === true ? buffer : { ...buffer, missing: true, error: removedMessage }
      changed ||= result[path] !== buffer
    } else {
      changed = true
    }
  }
  return changed ? result : buffers
}

/**
 * Apply disk content while retaining a human draft and its CAS base revision.
 * @param existing - the latest buffer, which may have changed during the read.
 * @param file - observed disk revision.
 * @param conflictMessage - localized disk-change notice.
 * @returns the updated buffer or a draft with an explicit disk conflict.
 */
export function receiveFile(existing: FileBuffer | undefined, file: FilePayload, conflictMessage: string): FileBuffer {
  if (existing?.source === 'human' && existing.content !== existing.saved) {
    return {
      ...existing,
      missing: false,
      error: undefined,
      conflict: existing.version === file.version
        ? undefined
        : { message: conflictMessage, theirs: file.content, theirsVersion: file.version },
    }
  }
  return { content: file.content, saved: file.content, source: 'disk', version: file.version }
}

/**
 * Decide whether a listed revision still needs a content read.
 * @param buffer - cached content or a human draft.
 * @param version - current directory revision.
 * @returns whether the editor has not observed this disk revision.
 */
export function needsFileRead(buffer: FileBuffer | undefined, version: string): boolean {
  return buffer === undefined || buffer.missing === true || buffer.source === 'agent'
    || (buffer.conflict !== undefined && buffer.conflict.theirsVersion === undefined)
    || (buffer.version !== version && buffer.conflict?.theirsVersion !== version)
}

/**
 * Own save locks for one Session across Sidebar tab mounts, without persistence.
 * @returns an observable set with synchronous acquisition and release.
 */
export function createSaveState(): {
  active: SnapshotStore<ReadonlySet<string>>
  begin: (path: string) => boolean
  end: (path: string) => void
} {
  const active = createSnapshotStore<ReadonlySet<string>>(new Set())
  return {
    active,
    begin: (path: string): boolean => {
      const current = active.getSnapshot()
      if (current.has(path)) return false
      active.set(new Set([...current, path]))
      return true
    },
    end: (path: string): void => {
      const next = new Set(active.getSnapshot())
      next.delete(path)
      active.set(next)
    },
  }
}
