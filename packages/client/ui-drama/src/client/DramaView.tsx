// Short-drama panel view: the conversation.view entry of the drama creation
// mode. Read-only presentation over the package's own HTTP routes; all copy
// rides the ui-drama locale namespace, all styling rides --dsw-* tokens.
//
// The left pane lists project overview + episodes from `/drama/overview`;
// selecting an episode loads its parsed projection and creator documents from
// `/drama/episode`. Selecting a document opens it via `/drama/document`. The
// right pane previews the projection: document list, shot/asset/prompt counts,
// diagnostics (duplicate ids, unresolved references) and the media list — a
// read-only, non-authoritative projection over the owned Markdown.

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentValue, EpisodeValue, OverviewValue } from '../board.ts'
import css from './drama-view.module.css'

/** Full props of the short-drama view: session runtime seat plus the locale seat. */
export type DramaViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'ui-drama'>

/** One overview episode row (for stage labels). */
type EpisodeRow = OverviewValue['episodes'][number]

/**
 * The short-drama panel. Fetches the overview on mount and on refresh;
 * opening an episode fetches its projection and documents. Session data comes
 * through the runtime seat; nothing here subscribes to external stores.
 * @param props - the runtime + locale seat.
 * @returns the panel element.
 */
export function DramaView(props: DramaViewProps) {
  const { sessionId, t } = props
  const [overview, setOverview] = useState<OverviewValue | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [selectedEpisode, setSelectedEpisode] = useState<string | undefined>(undefined)
  const [episode, setEpisode] = useState<EpisodeValue | undefined>(undefined)
  const [doc, setDoc] = useState<DocumentValue | undefined>(undefined)
  const [docLoading, setDocLoading] = useState(false)

  const loadOverview = useCallback(async () => {
    setLoadError(undefined)
    try {
      const res = await fetch(`/drama/overview?sessionId=${encodeURIComponent(sessionId)}`)
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setOverview(await res.json() as OverviewValue)
    } catch (error) {
      setOverview(undefined)
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  useEffect(() => { void loadOverview() }, [loadOverview])

  const openEpisode = useCallback(async (episodeDir: string) => {
    setSelectedEpisode(episodeDir)
    setEpisode(undefined)
    setDoc(undefined)
    try {
      const res = await fetch(`/drama/episode?sessionId=${encodeURIComponent(sessionId)}&episode=${encodeURIComponent(episodeDir)}`)
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setEpisode(await res.json() as EpisodeValue)
    } catch (error) {
      setEpisode(undefined)
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  const openDocument = useCallback(async (file: string) => {
    setDocLoading(true)
    try {
      const res = await fetch(`/drama/document?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(file)}`)
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setDoc(await res.json() as DocumentValue)
    } catch {
      setDoc(undefined)
    } finally {
      setDocLoading(false)
    }
  }, [sessionId])

  const stageLabel = (stage: EpisodeRow['stage']): string => {
    switch (stage) {
      case 'develop': return t('panel.stage.develop')
      case 'screenplay': return t('panel.stage.screenplay')
      case 'assets': return t('panel.stage.assets')
      case 'storyboard': return t('panel.stage.storyboard')
      case 'image-prompts': return t('panel.stage.image-prompts')
      case 'video-prompts': return t('panel.stage.video-prompts')
      case 'produce': return t('panel.stage.produce')
      case 'review': return t('panel.stage.review')
    }
  }

  if (loadError !== undefined) {
    return (
      <div className={css.view}>
        <div className={css.state}>
          <p className={css.statePrimary}>{t('panel.error', { message: loadError })}</p>
          <button type='button' className={css.action} onClick={() => { void loadOverview() }}>{t('panel.retry')}</button>
        </div>
      </div>
    )
  }
  if (overview === undefined) {
    return (
      <div className={css.view}>
        <div className={css.state}><p>{t('panel.loading')}</p></div>
      </div>
    )
  }
  if (!overview.project.exists) {
    return (
      <div className={css.view}>
        <div className={css.state}>
          <p className={css.statePrimary}>{t('panel.empty.project')}</p>
          <p>{t('panel.empty.hint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={css.view}>
      <div className={css.header}>
        <span className={css.summary}>{t('panel.summary', {
          episodes: overview.episodes.length,
          pending: overview.pendingProductionCount,
        })}</span>
        <button type='button' className={css.action} onClick={() => { void loadOverview() }}>{t('panel.refresh')}</button>
      </div>
      <div className={css.body}>
        <div className={css.list}>
          <div className={css.items}>
            {overview.episodes.map(row => (
              <button
                key={row.episode}
                type='button'
                className={clsx(css.item, selectedEpisode === row.episode && css.itemActive)}
                onClick={() => { void openEpisode(row.episode) }}
              >
                <span>{t('panel.row.episode', { episode: row.episode })}</span>
                <span className={css.itemMeta}>{stageLabel(row.stage)} · {row.documents.length} {t('panel.documents')}</span>
              </button>
            ))}
            {overview.episodes.length === 0 && (
              <span className={css.listEmpty}>{t('panel.empty.episodes')}</span>
            )}
          </div>
          {episode !== undefined && (
            <div className={css.subList}>
              <span className={css.subListTitle}>{t('panel.documents')}</span>
              {episode.documents.map(file => (
                <button
                  key={file}
                  type='button'
                  className={clsx(css.item, doc?.file === `${episode.episode}/${file}` && css.itemActive)}
                  onClick={() => { void openDocument(`${episode.episode}/${file}`) }}
                >
                  <span>{file}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={css.pane}>
          {selectedEpisode === undefined && <span className={css.listEmpty}>{t('panel.episode.pane')}</span>}
          {selectedEpisode !== undefined && episode === undefined && <span className={css.listEmpty}>{t('panel.loading')}</span>}
          {selectedEpisode !== undefined && episode !== undefined && doc === undefined && !docLoading &&
            <EpisodePane episode={episode} t={t} />}
          {selectedEpisode !== undefined && doc !== undefined && (
            <>
              <div className={css.docHeader}>{doc.file}</div>
              <div className={css.prose}>{doc.text}</div>
              {doc.truncated && <p className={css.truncated}>{t('panel.truncated')}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The selected episode's read-only projection body. */
function EpisodePane({ episode, t }: { episode: EpisodeValue; t: PropsLocale<'ui-drama'>['t'] }) {
  const p = episode.projection
  const errorCount = p.diagnostics.filter(d => d.severity === 'error').length
  const warningCount = p.diagnostics.length - errorCount
  const assetCount = p.visualAssets.length
  const shotCount = p.shots.length
  const promptCount = p.imagePrompts.length + p.motions.length
  return (
    <div className={css.prose}>
      <p className={css.statePrimary}>{t('panel.row.episode', { episode: episode.episode })}</p>
      <p>{t('panel.shots')} {shotCount} · {t('panel.assets')} {assetCount} · {t('panel.prompts')} {promptCount}</p>
      <p>{t('panel.diagnostics')} {errorCount} / {warningCount}</p>
      <ul className={css.diagList}>
        {p.diagnostics.slice(0, 8).map((diag, index) => (
          <li key={`${diag.code}-${index}`} className={clsx(css.diag, diag.severity === 'error' ? css.diagError : css.diagWarn)}>
            {diag.path} · L{diag.line} · {diag.message}
          </li>
        ))}
        {p.diagnostics.length === 0 && <li className={css.listEmpty}>{t('panel.empty.diagnostics')}</li>}
      </ul>
      <p className={css.statePrimary}>{t('panel.media')}</p>
      <ul className={css.diagList}>
        {(episode.media ?? []).slice(0, 8).map(media => (
          <li key={media.path} className={css.mediaRow}><span>{media.name}</span><span>{media.kind}</span></li>
        ))}
        {(episode.media ?? []).length === 0 && <li className={css.listEmpty}>{t('panel.empty.media')}</li>}
      </ul>

    </div>
  )
}
