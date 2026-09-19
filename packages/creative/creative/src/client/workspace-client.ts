/** Workspace listing and response handling for the Creative client. */
import { useCallback, useEffect, useState } from 'react'
import type { CreativeProjectSummary } from '../project-path.ts'
import type { VideoProject } from './video-studio.tsx'
import { endpoint } from './workbench-ui.ts'
import { isSessionUnavailable } from './session-notice.tsx'

/** A listed file revision; content is loaded separately. */
export interface WorkspaceFile {
  readonly path: string
  readonly bytes: number
  readonly version: string
  readonly kind: 'text' | 'media'
  readonly mimeType?: string | undefined
}
/** Session workspace index with an explicit completeness flag. */
export interface WorkspacePayload {
  readonly cwd: string
  readonly files: readonly WorkspaceFile[]
  readonly truncated: boolean
  readonly games: readonly GameProject[]
  readonly videos: readonly VideoProject[]
  readonly projects: readonly CreativeProjectSummary[]
  readonly mode: 'dsh-session'
}
/** A workspace or bundled game preview. */
export interface GameProject {
  readonly id: string
  readonly root: string
  readonly title: string
  readonly source: 'workspace' | 'example'
  readonly previewReady: boolean
  readonly previewUrl?: string | undefined
  readonly previewVersion: string
}

/** A workspace HTTP failure with its response status. */
export class WorkspaceRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/**
 * Decode a workspace response and preserve HTTP failure status.
 * @param response - response from a Creative endpoint.
 * @returns the endpoint's decoded payload.
 */
export async function json<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { readonly error?: string }
  if (!response.ok) throw new WorkspaceRequestError(response.status, value.error ?? `HTTP ${String(response.status)}`)
  return value
}

/**
 * Load the current Session directory without exposing another Session's files.
 * @param sessionId - the active Session identity.
 * @returns the latest listing, loading status, and explicit refresh action.
 */
export function useWorkspace(sessionId: string): {
  readonly workspace: WorkspacePayload | undefined
  readonly error: string | undefined
  readonly sessionUnavailable: boolean
  readonly loading: boolean
  readonly reload: () => void
} {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ readonly sessionId: string; readonly workspace: WorkspacePayload }>()
  const [failure, setFailure] = useState<{ readonly sessionId: string; readonly status: number; readonly message: string }>()
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    setVersion(value => value + 1)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailure(undefined)
    void fetch(endpoint('workspace', sessionId), { signal: controller.signal })
      .then(response => json<WorkspacePayload>(response))
      .then((workspace) => { if (!controller.signal.aborted) setResult({ sessionId, workspace }) })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setFailure(reason instanceof WorkspaceRequestError
            ? { sessionId, status: reason.status, message: reason.message }
            : { sessionId, status: 0, message: reason instanceof Error ? reason.message : String(reason) })
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [sessionId, version])
  const workspace = result?.sessionId === sessionId ? result.workspace : undefined
  const currentFailure = failure?.sessionId === sessionId ? failure : undefined
  const sessionUnavailable = currentFailure !== undefined && isSessionUnavailable(currentFailure.status)
  return {
    workspace, error: currentFailure?.message, sessionUnavailable,
    loading: loading || (workspace === undefined && currentFailure === undefined), reload,
  }
}
