// Novel panel view: the conversation.view entry of the novel-writing mode.
// Read-only presentation over the package's own HTTP routes; all copy rides
// the ui-novel locale namespace, all styling rides --dsw-* tokens.

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentValue, OverviewValue } from '../board.ts'
import { CHAPTERS_DIR, CHARACTERS_DIR } from '../board.ts'
import css from './novel-view.module.css'

/** Full props of the novel view: session runtime seat plus the locale seat. */
export type NovelViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'ui-novel'>

/** One selectable document row of the left pane. */
interface ListRow {
  /** Workspace-relative path to fetch. */
  file: string
  /** Primary label. */
  label: string
  /** Secondary meta line, when the row carries one. */
  meta?: string
}

type PanelTab = 'chapters' | 'outline' | 'characters' | 'tracking'

const TAB_KEYS: readonly PanelTab[] = ['chapters', 'outline', 'characters', 'tracking']

const TAB_LABEL_KEY: Record<PanelTab, 'panel.tab.chapters' | 'panel.tab.outline' | 'panel.tab.characters' | 'panel.tab.tracking'> = {
  chapters: 'panel.tab.chapters',
  outline: 'panel.tab.outline',
  characters: 'panel.tab.characters',
  tracking: 'panel.tab.tracking',
}

/**
 * The novel reading panel. Fetches the overview on mount and on refresh;
 * opening a row fetches that document. Session data comes in through the
 * runtime seat; nothing here subscribes to external stores.
 * @param props - the four-shares runtime + locale seat.
 * @returns the panel element.
 */
export function NovelView(props: NovelViewProps) {
  const { sessionId, t } = props
  const [overview, setOverview] = useState<OverviewValue | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<PanelTab>('chapters')
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [doc, setDoc] = useState<DocumentValue | undefined>(undefined)
  const [docLoading, setDocLoading] = useState(false)

  const loadOverview = useCallback(async () => {
    setLoadError(undefined)
    try {
      const res = await fetch(`/novel/overview?sessionId=${encodeURIComponent(sessionId)}`)
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setOverview(await res.json() as OverviewValue)
    } catch (error) {
      setOverview(undefined)
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  useEffect(() => { void loadOverview() }, [loadOverview])

  const openDocument = useCallback(async (file: string) => {
    setSelected(file)
    setDocLoading(true)
    try {
      const res = await fetch(`/novel/document?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(file)}`)
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setDoc(await res.json() as DocumentValue)
    } catch {
      setDoc(undefined)
    } finally {
      setDocLoading(false)
    }
  }, [sessionId])

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

  const statusLabel = (status: OverviewValue['chapters'][number]['status']): string =>
    status === 'draft' ? t('panel.status.draft')
      : status === 'revised' ? t('panel.status.revised')
        : t('panel.status.final')

  const rows: ListRow[] = tab === 'chapters'
    ? overview.chapters.map(row => ({
      file: `${CHAPTERS_DIR}/${row.chapter}`,
      label: row.chapter,
      meta: `${statusLabel(row.status)} · ${t('panel.words', { words: row.words })}`,
    }))
    : tab === 'outline'
      ? overview.outline ? [{ file: 'outline.md', label: 'outline.md' }] : []
      : tab === 'characters'
        ? overview.characters.map(file => ({ file: `${CHARACTERS_DIR}/${file}`, label: file }))
        : overview.trackingViews.map(file => ({ file, label: file }))

  return (
    <div className={css.view}>
      <div className={css.header}>
        <span className={css.summary}>{t('panel.summary', {
          chapters: overview.summary.chapterCount,
          words: overview.summary.totalWords,
          foreshadows: overview.summary.openForeshadowCount,
        })}</span>
        <button type='button' className={css.action} onClick={() => { void loadOverview() }}>{t('panel.refresh')}</button>
      </div>
      <div className={css.body}>
        <div className={css.list}>
          <div className={css.tabs}>
            {TAB_KEYS.map(key => (
              <button
                key={key}
                type='button'
                className={clsx(css.tab, tab === key && css.tabActive)}
                onClick={() => { setTab(key) }}
              >{t(TAB_LABEL_KEY[key])}</button>
            ))}
          </div>
          <div className={css.items}>
            {rows.map(row => (
              <button
                key={row.file}
                type='button'
                className={clsx(css.item, selected === row.file && css.itemActive)}
                onClick={() => { void openDocument(row.file) }}
              >
                <span>{row.label}</span>
                {row.meta !== undefined && <span className={css.itemMeta}>{row.meta}</span>}
              </button>
            ))}
            {rows.length === 0 && (
              <span className={css.listEmpty}>
                {tab === 'outline' ? t('panel.empty.outline')
                  : tab === 'characters' ? t('panel.empty.characters')
                    : t('panel.empty.tracking')}
              </span>
            )}
          </div>
        </div>
        <div className={css.pane}>
          {selected === undefined && <span className={css.listEmpty}>{t('panel.empty.pane')}</span>}
          {selected !== undefined && docLoading && <span className={css.listEmpty}>{t('panel.loading')}</span>}
          {selected !== undefined && !docLoading && doc === undefined && <span className={css.listEmpty}>{t('panel.error', { message: selected })}</span>}
          {selected !== undefined && !docLoading && doc !== undefined && (
            <>
              <div className={css.prose}>{doc.text}</div>
              {doc.truncated && <p className={css.truncated}>{t('panel.truncated')}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
