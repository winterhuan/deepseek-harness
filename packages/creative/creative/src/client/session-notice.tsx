import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales/index.ts'

/** The workspace route answers 404 only when the session has no live agent in this process. */
export function isSessionUnavailable(status: number): boolean {
  return status === 404
}

/** Recovery guidance for a session the current server process does not know. */
export function SessionUnavailableNotice({ t }: { readonly t: TranslateNS<typeof NS> }) {
  return <div className="creative-warning" role="alert">{t('session.unavailable')}</div>
}
