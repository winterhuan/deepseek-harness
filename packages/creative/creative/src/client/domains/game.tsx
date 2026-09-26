/** Game domain: the interactive-game studio with its live preview and design documents. */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FilePayload } from '../editor-buffer.ts'
import { WORKBENCH_LABEL_KEYS, type WorkbenchMode } from '../file-activity.js'
import type { NS } from '../locales/index.ts'
import { MarkdownPreview } from '../markdown-preview.js'
import { endpoint, handleTabKey } from '../workbench-ui.js'
import type { WorkbenchMemory } from '../workbench-store.ts'
import { json, type GameProject, type WorkspaceFile, type WorkspacePayload } from '../workspace-client.ts'
import type { StudioDomain, StudioProps } from './types.ts'

/** Workspace protocol literals the empty states render as `code`, not as copy. */
const NOVEL_TO_GAME_COMMAND = '/novel-to-game quick'
const NOVEL_TO_GAME_BUILD_PATH = 'game-adaptations/<project>/build/app/'

function isolatedPreviewUrl(path: string, version: string, revision: number): { readonly href: string; readonly isolated: boolean } {
  const url = new URL(path, globalThis.location.origin)
  if (url.hostname === '127.0.0.1') url.hostname = 'localhost'
  else if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  url.searchParams.set('build', version)
  url.searchParams.set('reload', String(revision))
  return { href: url.toString(), isolated: url.origin !== globalThis.location.origin }
}

/**
 * An iframe fires `load`, not `error`, when a navigation commits an HTTP error response, so the
 * frame's own events cannot tell a working preview from the route's JSON error body. Probe the
 * same URL out of band and report a non-OK or non-HTML answer as a real failure.
 */
function PreviewProbe({ href, onFailed }: { readonly href: string; readonly onFailed: () => void }) {
  // Hold the callback in a ref so an inline arrow from the caller cannot re-trigger the probe.
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

function GamePreview({ t, project, building }: {
  readonly t: TranslateNS<typeof NS>
  readonly project: GameProject
  readonly building: boolean
}) {
  const shellRef = useRef<HTMLDivElement>(null)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFullscreenFocus = useRef(false)
  const [focused, setFocused] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loadedVersion, setLoadedVersion] = useState(project.previewVersion)
  useEffect(() => {
    const document = shellRef.current?.ownerDocument
    if (document === undefined) return
    const restore = (): void => {
      if (document.fullscreenElement !== null || !restoreFullscreenFocus.current) return
      restoreFullscreenFocus.current = false
      fullscreenButtonRef.current?.focus()
    }
    document.addEventListener('fullscreenchange', restore)
    return () => { document.removeEventListener('fullscreenchange', restore) }
  }, [])
  if (!project.previewReady || project.previewUrl === undefined) return <div className="oh-game-preview-empty">
    <span aria-hidden>◫</span>
    <strong>{t('game.preview.empty.title')}</strong>
    <p>{t('game.preview.empty.prefix')} <code>{NOVEL_TO_GAME_COMMAND}</code>{t('game.preview.empty.mid')} <code>{NOVEL_TO_GAME_BUILD_PATH}</code>{t('game.preview.empty.suffix')}</p>
    <div className="oh-game-prompt-example"><span>{t('game.preview.example.label')}</span><q>{t('game.preview.example.prompt')}</q></div>
  </div>
  const preview = isolatedPreviewUrl(project.previewUrl, loadedVersion, revision)
  const pending = project.previewVersion !== loadedVersion
  /** Accept the newer build the creator just chose. */
  const reload = (): void => {
    setLoaded(false)
    setLoadError(false)
    setLoadedVersion(project.previewVersion)
    setRevision(value => value + 1)
  }
  /** Re-run the build the creator already accepted; never silently adopt a newer one. */
  const refresh = (): void => {
    setLoaded(false)
    setLoadError(false)
    setRevision(value => value + 1)
  }
  const runtimeState = loadError ? t('game.preview.state.error')
    : building ? t('game.preview.state.building')
      : pending ? t('game.preview.state.pending')
        : loaded ? (preview.isolated ? t('game.preview.state.loaded') : t('game.preview.state.unisolated'))
          : t('game.preview.state.loading')
  const fullscreen = (): void => {
    const shell = shellRef.current
    if (shell === null) return
    restoreFullscreenFocus.current = true
    void shell.requestFullscreen().catch(() => { restoreFullscreenFocus.current = false })
  }
  return <div ref={shellRef} className="oh-game-preview-shell" data-state={loadError ? 'error' : building ? 'building' : loaded ? 'ready' : 'loading'}>
    <div className="oh-game-preview-status">
      <span className="oh-game-runtime-state" role="status" aria-live="polite" title={runtimeState}><i aria-hidden /><em>{runtimeState}</em></span>
      <div>
        {pending && !building && <button type="button" onClick={reload}>{t('game.preview.loadNew')}</button>}
        <button className="oh-game-reload" type="button" onClick={refresh} aria-label={t('game.preview.reload')}><span aria-hidden>↻</span><b>{t('game.preview.refresh')}</b></button>
        <button ref={fullscreenButtonRef} type="button" onClick={fullscreen}>{t('game.preview.fullscreen')}</button>
      </div>
    </div>
    <PreviewProbe href={preview.href} onFailed={() => { setLoaded(false); setLoadError(true) }} />
    <iframe
      key={`${project.id}:${loadedVersion}:${String(revision)}`}
      src={preview.href}
      title={t('game.preview.frameTitle', { title: project.title })}
      sandbox={preview.isolated
        ? 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads'
        : 'allow-scripts allow-forms allow-modals allow-downloads'}
      allow="autoplay; fullscreen; gamepad"
      allowFullScreen
      referrerPolicy="no-referrer"
      onLoad={() => { setLoadError(false); setLoaded(true) }}
      onError={() => { setLoaded(false); setLoadError(true) }}
      onFocus={() => { setFocused(true) }}
      onBlur={() => { setFocused(false) }}
    />
    <div className="oh-game-focus-hint" data-focused={focused || undefined}>{focused ? t('game.preview.focus.active') : t('game.preview.focus.idle')}</div>
  </div>
}

function GameDesign({
  t,
  project,
  files,
  selected,
  sessionId,
  onSelect,
}: {
  readonly t: TranslateNS<typeof NS>
  readonly project: GameProject
  readonly files: readonly WorkspaceFile[]
  readonly selected: string | undefined
  readonly sessionId: string
  readonly onSelect: (path: string) => void
}) {
  const documents = useMemo(() => files.filter(file => file.path.startsWith(`${project.root}/`) && (
    /\.(?:md|txt|json|jsonl|html|css|[cm]?js|tsx?|jsx)$/iu.test(file.path)
  )), [files, project.root])
  const preferred = selected !== undefined && documents.some(file => file.path === selected)
    ? selected
    : documents.find(file => file.path === `${project.root}/PRODUCT_BRIEF.md`)?.path ?? documents[0]?.path
  const [path, setPath] = useState(preferred)
  const [content, setContent] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => { setPath(preferred) }, [preferred, project.id])
  useEffect(() => {
    if (path === undefined) { setContent(undefined); return }
    const controller = new AbortController()
    setContent(undefined)
    setError(undefined)
    void fetch(endpoint('file', sessionId, path), { signal: controller.signal })
      .then(response => json<FilePayload>(response))
      .then((file) => { setContent(file.content) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { controller.abort() }
  }, [path, sessionId])
  if (documents.length === 0 || path === undefined) return <div className="oh-game-design-empty">{t('game.design.empty')}</div>
  const markdown = path.toLocaleLowerCase().endsWith('.md')
  return <div className="oh-game-design">
    <label>{t('game.design.files')}<select value={path} onChange={(event) => {
      setPath(event.target.value)
      onSelect(event.target.value)
    }}>{documents.map(file =>
        <option value={file.path} key={file.path}>{file.path.slice(project.root.length + 1)}</option>,
      )}</select></label>
    {error !== undefined ? <div className="creative-error">{error}</div>
      : content === undefined ? <div className="oh-game-design-empty">{t('game.design.loading')}</div>
        : markdown ? <MarkdownPreview content={content} label={path} t={t} />
          : <pre className="oh-game-source" aria-label={t('game.design.source', { path })}>{content}</pre>}
  </div>
}

function GameStudio({
  t,
  sessionId,
  workspace,
  building,
  selected,
  gameTab,
  gameProjectId,
  hidden,
  onGameTab,
  onGameProject,
  workbenches,
  onWorkbench,
  onSelect,
}: {
  readonly t: TranslateNS<typeof NS>
  readonly sessionId: string
  readonly workspace: WorkspacePayload
  readonly building: boolean
  readonly selected: string | undefined
  readonly gameTab: WorkbenchMemory['gameTab']
  readonly gameProjectId: string | undefined
  readonly hidden: boolean
  readonly onGameTab: (tab: WorkbenchMemory['gameTab']) => void
  readonly onGameProject: (id: string) => void
  readonly workbenches: readonly WorkbenchMode[]
  readonly onWorkbench: (mode: WorkbenchMode) => void
  readonly onSelect: (path: string) => void
}) {
  const project = workspace.games.find(value => value.id === gameProjectId) ?? workspace.games[0]
  const studioRef = useRef<HTMLElement>(null)
  const tabsId = useId()
  useLayoutEffect(() => {
    const studio = studioRef.current
    if (studio === null) return
    const publishWidth = () => {
      studio.toggleAttribute('data-oh-game-narrow', studio.clientWidth <= 300)
    }
    publishWidth()
    const observer = new ResizeObserver(publishWidth)
    observer.observe(studio)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    if (project !== undefined && project.id !== gameProjectId) onGameProject(project.id)
  }, [gameProjectId, onGameProject, project])
  if (project === undefined) return <main ref={studioRef} className="oh-game-studio" hidden={hidden}><div className="oh-game-design-empty">{t('game.studio.loading')}</div></main>
  const tabKeys = ['preview', 'design'] as const
  return <main ref={studioRef} className="oh-game-studio" data-source={project.source} hidden={hidden}>
    <header className="oh-game-toolbar">
      <div className="creative-workbench-cluster">
        {workbenches.length > 1 && <div className="oh-game-mode-tabs" role="tablist" aria-label={t('workbench.tablist')}>
          {workbenches.map(mode => <button
            type="button"
            role="tab"
            key={mode}
            aria-selected={mode === 'game'}
            tabIndex={mode === 'game' ? 0 : -1}
            onKeyDown={(event) => { handleTabKey(event, workbenches, 'game', onWorkbench) }}
            onClick={() => { onWorkbench(mode) }}
          >{t(WORKBENCH_LABEL_KEYS[mode])}</button>)}
        </div>}

      </div>
      <label className="oh-game-project" title={t('game.project.switchHint')}><span>{t('game.project.label')}</span><select aria-label={t('game.project.selectAria')} value={project.id} onChange={(event) => { onGameProject(event.target.value) }}>
        {workspace.games.length > 0 && <optgroup label={t('game.project.mine')}>{workspace.games.map(item => <option value={item.id} key={item.id}>{t('game.project.mineOption', { title: item.title })}</option>)}</optgroup>}
      </select></label>
      <div className="oh-game-tabs" role="tablist" aria-label={t('game.tablist')}>
        {tabKeys.map(tab => <button
          key={tab}
          type="button"
          role="tab"
          tabIndex={gameTab === tab ? 0 : -1}
          aria-selected={gameTab === tab}
          id={`${tabsId}-${tab}-tab`}
          aria-controls={`${tabsId}-${tab}-panel`}
          onKeyDown={(event) => { handleTabKey(event, tabKeys, gameTab, onGameTab) }}
          onClick={() => { onGameTab(tab) }}
        >{tab === 'preview' ? t('game.tab.preview') : t('game.tab.files')}</button>)}
      </div>
    </header>
    <div className="oh-game-panels">
      <div className="oh-game-panel" role="tabpanel" id={`${tabsId}-preview-panel`} aria-labelledby={`${tabsId}-preview-tab`} hidden={gameTab !== 'preview'}>
        <GamePreview key={`${project.id}:${String(project.previewReady)}`} t={t} project={project} building={building} />
      </div>
      <div className="oh-game-panel" role="tabpanel" id={`${tabsId}-design-panel`} aria-labelledby={`${tabsId}-design-tab`} hidden={gameTab !== 'design'}>
        <GameDesign t={t} project={project} files={workspace.files} selected={selected} sessionId={sessionId} onSelect={onSelect} />
      </div>
    </div>
  </main>
}


function GameWorkbench({ useStore, actions, workspace, building, ...props }: StudioProps) {
  const gameTab = useStore(memory => memory.gameTab)
  const gameProjectId = useStore(memory => memory.gameProjectId)
  return <GameStudio
    {...props}
    workspace={workspace}
    building={building}
    gameTab={gameTab}
    gameProjectId={gameProjectId}
    onGameTab={actions.setGameTab}
    onGameProject={actions.setGameProjectId}
  />
}

/** The game workbench domain. */
export const gameDomain: StudioDomain<'game'> = {
  mode: 'game',
  surface: 'studio',
  groupOrder: ['game-adaptations'],
  activityRoot: 'game-adaptations/',
  connectingKey: 'game.connecting',
  Placeholder: ({ children }) => <main className="oh-game-studio"><div className="oh-game-design-empty">{children}</div></main>,
  Studio: GameWorkbench,
  enter: (actions) => { actions.setGameTab('preview') },
  reveal: (path, actions) => { if (!path.includes('/build/app/')) actions.setGameTab('design') },
  holdsAgentFollow: memory => memory.gameTab === 'preview',
}
