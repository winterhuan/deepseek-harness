// Game-studio panel view: the conversation.view entry of the game-studio mode.
// Fetches the workspace on mount and renders the playable preview,
// project browser, and QA panel.

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspacePayload } from './stores.js'
import { GamePreview } from './GamePreview.tsx'
import { NS, type GameStudioKey } from './locales.ts'
import css from './game-studio.module.css'

/** Full props of the game-studio view: session runtime seat plus the locale seat. */
export type GameStudioViewProps = PropsRuntime<'conversation.view'> & PropsLocale<typeof NS>

/** Tab keys shown in the studio toolbar. */
type StudioTab = 'preview' | 'files' | 'qa'

const TAB_KEYS: readonly StudioTab[] = ['preview', 'files', 'qa']

const TAB_LABEL_KEY: Record<StudioTab, GameStudioKey> = {
  preview: 'panel.tab.preview',
  files: 'panel.tab.files',
  qa: 'panel.tab.qa',
}

/**
 * The game-studio panel. Fetches the workspace on mount; renders the preview,
 * project browser, and QA status tabs.
 * @param props - the four-shares runtime + locale seat.
 * @returns the panel element.
 */
export function GameStudioView(props: GameStudioViewProps) {
  const { sessionId, t } = props
  const [workspace, setWorkspace] = useState<WorkspacePayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [projectId, setProjectId] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<StudioTab>('preview')
  const [selectedFile, setSelectedFile] = useState<string | undefined>(undefined)
  const [fileContent, setFileContent] = useState<string | undefined>(undefined)
  const [fileLoading, setFileLoading] = useState(false)

  const loadWorkspace = useCallback(async () => {
    setError(undefined)
    try {
      const res = await fetch(`/game-studio/workspace?sessionId=${encodeURIComponent(sessionId)}`)
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      setWorkspace(await res.json() as WorkspacePayload)
    } catch (err) {
      setWorkspace(undefined)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [sessionId])

  useEffect(() => { void loadWorkspace() }, [loadWorkspace])

  const project = useMemo(() => {
    if (workspace === undefined) return undefined
    if (projectId !== undefined) return workspace.games.find(game => game.id === projectId)
    return workspace.games[0]
  }, [projectId, workspace])

  useEffect(() => {
    if (project === undefined) return
    setFileContent(undefined)
    if (selectedFile !== undefined) {
      setFileLoading(true)
      fetch(`/game-studio/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(selectedFile)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
          const file = await res.json() as { content: string }
          setFileContent(file.content)
        })
        .catch((err: unknown) => { setFileContent(err instanceof Error ? err.message : String(err)) })
        .finally(() => { setFileLoading(false) })
    }
  }, [project, selectedFile, sessionId])

  if (error !== undefined) {
    return (
      <div className={css.view}>
        <div className={css.state}>
          <p className={css.statePrimary}>{t('error', { message: error })}</p>
          <button type='button' className={css.action} onClick={() => { void loadWorkspace() }}>{t('retry')}</button>
        </div>
      </div>
    )
  }

  if (workspace === undefined) {
    return <div className={css.view}><div className={css.state}><p>{t('preview.loading')}</p></div></div>
  }

  if (workspace.games.length === 0) {
    return (
      <div className={css.view}>
        <div className={css.state}>
          <p className={css.statePrimary}>{t('preview.empty.title')}</p>
          <p>{t('preview.empty.hint')}</p>
        </div>
      </div>
    )
  }

  const textFiles = workspace.files.filter(file => file.kind === 'text' && (project === undefined || file.path.startsWith(`${project.root}/`)))

  return (
    <div className={css.view}>
      <div className={css.header}>
        <span className={css.summary}>{workspace.games.length} {t('view.game')}</span>
        <label className={css.projectSelect}>
          <span>{t('project.label')}</span>
          <select value={project?.id ?? ''} onChange={(event) => { setProjectId(event.target.value) }}>
            {workspace.games.map(game => (
              <option value={game.id} key={game.id}>
                {game.source === 'example' ? t('project.example') : t('project.workspace')} · {game.title}
              </option>
            ))}
          </select>
        </label>
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
        <button type='button' className={css.action} onClick={() => { void loadWorkspace() }}>{t('retry')}</button>
      </div>
      <div className={css.body}>
        {tab === 'preview' && project !== undefined && <GamePreview project={project} t={t} />}
        {tab === 'files' && (
          <div className={css.fileBrowser}>
            <div className={css.fileList}>
              {textFiles.length === 0 && <p>{t('file.empty')}</p>}
              {textFiles.map(file => (
                <button
                  key={file.path}
                  type='button'
                  className={clsx(css.fileRow, selectedFile === file.path && css.fileRowActive)}
                  onClick={() => { setSelectedFile(file.path) }}
                >{file.path}</button>
              ))}
            </div>
            <div className={css.fileEditor}>
              {selectedFile === undefined && <p>{t('file.empty')}</p>}
              {selectedFile !== undefined && fileLoading && <p>{t('preview.loading')}</p>}
              {selectedFile !== undefined && !fileLoading && (
                <pre className={css.source} aria-label={selectedFile}>{fileContent ?? ''}</pre>
              )}
            </div>
          </div>
        )}
        {tab === 'qa' && project !== undefined && (
          <div className={css.qaPanel}>
            <h3>{project.title}</h3>
            <p>{t(`qa.status.${project.verification.status.toLowerCase() as 'pass' | 'fail' | 'notRun'}`)}</p>
            <ul className={css.qaChecks}>
              {Object.entries(project.verification.checks).map(([name, status]) => (
                <li key={name} className={css[status.toLowerCase()]}>
                  <span>{t(`qa.check.${name as 'launch'}`)}</span>
                  <span>{t(`qa.status.${status.toLowerCase() as 'pass' | 'fail' | 'notRun'}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
