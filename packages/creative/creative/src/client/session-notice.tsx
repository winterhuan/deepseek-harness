/** The workspace route answers 404 only when the session has no live agent in this process. */
export function isSessionUnavailable(status: number): boolean {
  return status === 404
}

/** Recovery guidance for a session the current server process does not know. */
export function SessionUnavailableNotice() {
  return <div className="creative-warning" role="alert">DSH 会话不可用：在当前会话发一句话以恢复连接，然后点 ↻ 刷新。</div>
}
