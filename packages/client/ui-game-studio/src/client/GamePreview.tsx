// Game preview: an isolated iframe plus controls to refresh, fullscreen, and
// adopt a newer build without losing the current play session.

import { useEffect, useRef, useState } from 'react'
import type { GameProject } from './stores.js'
import { NS } from './locales.js'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './game-studio.module.css'

/** Props for the preview pane. */
export interface GamePreviewProps extends PropsLocale<typeof NS> {
  readonly project: GameProject
}

interface PreviewUrl {
  readonly href: string
  readonly isolated: boolean
}

function isolatedPreviewUrl(path: string, version: string, revision: number): PreviewUrl {
  const url = new URL(path, globalThis.location.origin)
  if (url.hostname === '127.0.0.1') url.hostname = 'localhost'
  else if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  url.searchParams.set('build', version)
  url.searchParams.set('reload', String(revision))
  return { href: url.toString(), isolated: url.origin !== globalThis.location.origin }
}

/**
 * Render the playable preview iframe with refresh, fullscreen, and pending-build controls.
 * @param props - project, session id, and locale seat.
 * @returns the preview element.
 */
export function GamePreview(props: GamePreviewProps) {
  const { project, t } = props
  const shellRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loadedVersion, setLoadedVersion] = useState(project.previewVersion)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setLoadError(false)
    setLoadedVersion(project.previewVersion)
    setRevision(value => value + 1)
  }, [project.previewVersion, project.id])

  const preview = isolatedPreviewUrl(project.previewUrl ?? '', loadedVersion, revision)
  const pending = project.previewVersion !== loadedVersion

  const refresh = (): void => {
    setLoaded(false)
    setLoadError(false)
    setRevision(value => value + 1)
  }

  const reload = (): void => {
    setLoaded(false)
    setLoadError(false)
    setLoadedVersion(project.previewVersion)
    setRevision(value => value + 1)
  }

  const fullscreen = (): void => {
    const shell = shellRef.current
    if (shell === null) return
    void shell.requestFullscreen().catch(() => {})
  }

  if (!project.previewReady || project.previewUrl === undefined) {
    return (
      <div className={css.empty}>
        <strong>{t('preview.empty.title')}</strong>
        <p>{t('preview.empty.hint')}</p>
      </div>
    )
  }

  const runtimeState = loadError
    ? t('preview.error')
    : pending
      ? t('preview.pending')
      : loaded
        ? preview.isolated
          ? t('preview.ready')
          : `${t('preview.ready')} · ${t('preview.error')}`
        : t('preview.loading')

  return (
    <div ref={shellRef} className={css.previewShell}>
      <div className={css.previewStatus}>
        <span className={css.runtimeState}>{runtimeState}</span>
        <div className={css.previewActions}>
          {pending && <button type='button' onClick={reload}>{t('preview.reload')}</button>}
          <button type='button' onClick={refresh}>{t('preview.refresh')}</button>
          <button type='button' onClick={fullscreen}>{t('preview.fullscreen')}</button>
        </div>
      </div>
      <PreviewProbe href={preview.href} onFailed={() => { setLoaded(false); setLoadError(true) }} />
      <iframe
        key={`${project.id}:${loadedVersion}:${String(revision)}`}
        src={preview.href}
        title={project.title}
        sandbox={preview.isolated
          ? 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads'
          : 'allow-scripts allow-forms allow-modals allow-downloads'}
        allow='autoplay; fullscreen; gamepad'
        allowFullScreen
        referrerPolicy='no-referrer'
        onLoad={() => { setLoadError(false); setLoaded(true) }}
        onError={() => { setLoaded(false); setLoadError(true) }}
        onFocus={() => { setFocused(true) }}
        onBlur={() => { setFocused(false) }}
      />
      <div className={css.focusHint}>{focused ? t('preview.focused') : t('preview.focusHint')}</div>
    </div>
  )
}

function PreviewProbe({ href, onFailed }: { readonly href: string; readonly onFailed: () => void }) {
  const failedRef = useRef(onFailed)
  useEffect(() => { failedRef.current = onFailed }, [onFailed])
  useEffect(() => {
    const controller = new AbortController()
    void fetch(href, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        const type = response.headers.get('content-type') ?? ''
        if (!response.ok || !type.includes('text/html')) failedRef.current()
      })
      .catch(() => { if (!controller.signal.aborted) failedRef.current() })
    return () => { controller.abort() }
  }, [href])
  return null
}
