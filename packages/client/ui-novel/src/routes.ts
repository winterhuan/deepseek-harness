/**
 * HTTP surface of the novel panel: two read-only exact routes over the
 * calling session's workspace. `/novel/overview` derives the project state
 * value; `/novel/document` serves one validated `.md` file truncated to the
 * byte cap. Both are GET-only and answer JSON.
 * @module @deepseek-ai/dsh-client-ui-novel/routes
 */

import type { ServerResponse, IncomingMessage } from 'node:http'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import { readDocument, readOverview, sanitizeDocumentPath } from './board.ts'

/** Services the novel routes read. */
export interface NovelRouteServices {
  /** Filesystem backend resolving workspace-relative paths. */
  fs: FileSystem
  /** Session store supplying each session's workspace root. */
  sessions: SessionStore
}

/** Reply one JSON value and end the response. */
function respond(res: ServerResponse, status: number, value: unknown): void {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.statusCode = status
  res.end(JSON.stringify(value))
}

/** Map a route failure to its status: missing workspace files are 404, everything else 500. */
function respondError(res: ServerResponse, error: unknown): void {
  if (error instanceof FsError && error.code === 'FS_NOT_FOUND') {
    respond(res, 404, { error: 'workspace file not found' })
    return
  }
  respond(res, 500, { error: error instanceof Error ? error.message : 'internal error' })
}

/** The session workspace root for a request, or the failure response to send instead. */
function sessionCwd(sessions: SessionStore, sessionId: string): { cwd: string } | { status: number; value: unknown } {
  if (sessionId.length === 0) return { status: 400, value: { error: 'sessionId query parameter is required' } }
  const session = sessions.get(SessionId(sessionId))
  if (session === undefined) return { status: 404, value: { error: `unknown session "${sessionId}"` } }
  if (session.header.cwd === undefined) return { status: 404, value: { error: `session "${sessionId}" has no workspace` } }
  return { cwd: session.header.cwd }
}

/**
 * Build the two novel routes against concrete services. Registration and
 * disposal belong to the caller (the node-half plugin's effect).
 * @param services - the filesystem backend and session store to read.
 * @returns the routes in registration order.
 */
export function novelRoutes(services: NovelRouteServices): WebRoute[] {
  const overview: WebRoute = {
    kind: 'exact',
    path: '/novel/overview',
    handler(req, res) {
      void handleOverview(req, res, services)
    },
  }
  const document: WebRoute = {
    kind: 'exact',
    path: '/novel/document',
    handler(req, res) {
      void handleDocument(req, res, services)
    },
  }
  return [overview, document]
}

async function handleOverview(req: IncomingMessage, res: ServerResponse, services: NovelRouteServices): Promise<void> {
  try {
    if (req.method !== 'GET') {
      respond(res, 405, { error: 'GET only' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const located = sessionCwd(services.sessions, url.searchParams.get('sessionId') ?? '')
    if ('status' in located) {
      respond(res, located.status, located.value)
      return
    }
    respond(res, 200, await readOverview(services.fs, located.cwd))
  } catch (error) {
    respondError(res, error)
  }
}

async function handleDocument(req: IncomingMessage, res: ServerResponse, services: NovelRouteServices): Promise<void> {
  try {
    if (req.method !== 'GET') {
      respond(res, 405, { error: 'GET only' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const located = sessionCwd(services.sessions, url.searchParams.get('sessionId') ?? '')
    if ('status' in located) {
      respond(res, located.status, located.value)
      return
    }
    const file = url.searchParams.get('file')
    if (file === null) {
      respond(res, 400, { error: 'file query parameter is required' })
      return
    }
    // The path rule is the only thrower on this request path, and it throws
    // plain Errors (typed same-process boundary).
    try {
      sanitizeDocumentPath(file)
    } catch (error) {
      respond(res, 400, { error: (error as Error).message })
      return
    }
    const value = await readDocument(services.fs, located.cwd, file)
    if (value === undefined) {
      respond(res, 404, { error: `document "${file}" not found` })
      return
    }
    respond(res, 200, value)
  } catch (error) {
    respondError(res, error)
  }
}
