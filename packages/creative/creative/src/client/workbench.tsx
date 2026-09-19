import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { ISessions, SessionJobsBaseline, SubmissionHandle } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PartialAssistant, RunningToolCall } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarRightTabNavigation, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  creativeRelativePath,
  fileMutations,
  latestSettledMutation,
  mutatingCallIds,
  preferredWorkbenchFile,
  previewMutation,
  runningRootCalls,
  streamingAssistant,
  WORKBENCH_LABEL_KEYS,
  workbenchModeForPath,
  type WorkbenchMode,
} from './file-activity.js'
import { buildFileTree, type FileTreeNode } from './file-tree.js'
import { en, NS, zh, type CreativeLocaleKey } from './locales/index.ts'
import { JsonlPreview } from './jsonl-preview.js'
import { MarkdownPreview } from './markdown-preview.js'
import {
  creatorDocumentPaths,
  episodeDirectoryForPath,
  isCreatorDocumentPath,
  parseEpisodeProduction,
  type DramaDocumentTarget,
} from './drama-production.js'
import { DramaProductionView } from './drama-production-view.js'
import {
  type CanvasPoint, mediaTargetFromPath, productionJobView, productionQueueFromInbox,
  type ProductionRequest, type ProductionMediaVersion, type ProductionQueueEntry, type ProductionSequenceItem,
} from './production-runtime.js'
import { consumedIntentSeq, productionBindingsForEpisode, productionRequestsForEpisode, type SettledProductionIntent } from './production-intents.js'
import { registerProductionProjection } from './production-projection.ts'
import type { ProductionBinding } from '../production-binding.ts'
import { CREATIVE_PRODUCTION_TOOL_NAME } from '../production-intent.js'
import { creativeMediaMimeType, isCreativeTextPath, parseCreativePath } from '../project-path.ts'
import { VideoStudio } from './video-studio.js'
import { endpoint, handleTabKey } from './workbench-ui.js'
import { SessionUnavailableNotice } from './session-notice.js'
import { createSaveState, needsFileRead, receiveFile, reconcileBuffers, type FileBuffer, type FilePayload } from './editor-buffer.ts'
import { createWorkbenchStore, type PersistedWorkbenchMemory, type WorkbenchMemory } from './workbench-store.ts'
import { json, useWorkspace, WorkspaceRequestError, type GameProject, type WorkspaceFile, type WorkspacePayload } from './workspace-client.ts'
import './plugin.css'

export { createWorkbenchStore } from './workbench-store.ts'

export const name = 'creative'
export const inject = ['slots', 'sessions', 'conversation', 'uiConversation', 'locale', 'sidebarRight', 'sidebarRightTabs']

const WORKBENCH_KIND = 'creative'
const WORKBENCH_ID = '@deepseek-ai/dsh-creative'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Creative workbench copy. */
    'creative': CreativeLocaleKey
  }

}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** A file navigation addressed to one Creative Session. */
    creative: { readonly creativeFile: { readonly sessionId: SessionId; readonly path: string } }
  }
}



const GROUP_ORDER: Readonly<Record<WorkbenchMode, readonly string[]>> = {
  story: ['正文', '大纲', '设定', '追踪', '对标', '参考资料'],
  drama: ['项目', '输入', '项目开发', '设定集', '剧集', '审查', '创作者决策', '交付'],
  game: ['game-adaptations'],
  video: ['video-recaps'],
}

const WORKBENCH_MODES = ['story', 'drama', 'game', 'video'] as const
const EDITOR_MODES = ['preview', 'source', 'production'] as const

/** Workspace protocol literals the empty states render as `code`, not as copy. */
const NOVEL_TO_GAME_COMMAND = '/novel-to-game quick'
const NOVEL_TO_GAME_BUILD_PATH = 'game-adaptations/<project>/build/app/'
const NOVEL_TO_GAME_EXAMPLE_PATH = 'novel-to-game/examples/jin-ping-mei'
function groupForPath(path: string, t: TranslateNS<typeof NS>): string {
  return path === 'short-drama.json' ? t('tree.group.project') : path.split('/', 1)[0] ?? t('tree.group.other')
}


function FileTreeNodes({
  nodes,
  depth,
  expanded,
  selected,
  activityPath,
  onToggle,
  onSelect,
}: {
  readonly nodes: readonly FileTreeNode[]
  readonly depth: number
  readonly expanded: Readonly<Record<string, boolean>>
  readonly selected: string | undefined
  readonly activityPath: string | undefined
  readonly onToggle: (path: string, open: boolean) => void
  readonly onSelect: (path: string) => void
}) {
  return <>{nodes.map((node) => {
    if (node.kind === 'file') return <button
      type="button"
      key={node.path}
      style={{ '--creative-indent': `${String(depth * 14)}px` } as CSSProperties}
      title={node.path}
      aria-label={node.path}
      data-file-path={node.path}
      data-agent-target={node.path === activityPath || undefined}
      aria-current={node.path === selected ? 'page' : undefined}
      onClick={() => { onSelect(node.path) }}
    >{node.name}</button>
    const open = selected?.startsWith(`${node.path}/`) === true || expanded[node.path] === true
    return <details className="creative-file-folder" key={node.path} open={open} onToggle={(event) => { onToggle(node.path, event.currentTarget.open) }}>
      <summary style={{ '--creative-indent': `${String(depth * 14)}px` } as CSSProperties} title={node.path}>{node.name}<span>{node.fileCount}</span></summary>
      <FileTreeNodes
        nodes={node.children}
        depth={depth + 1}
        expanded={expanded}
        selected={selected}
        activityPath={activityPath}
        onToggle={onToggle}
        onSelect={onSelect}
      />
    </details>
  })}</>
}


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
    if (path === undefined || project.source === 'example') { setContent(undefined); return }
    const controller = new AbortController()
    setContent(undefined)
    setError(undefined)
    void fetch(endpoint('file', sessionId, path), { signal: controller.signal })
      .then(response => json<FilePayload>(response))
      .then((file) => { setContent(file.content) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { controller.abort() }
  }, [path, project.source, sessionId])
  if (project.source === 'example') return <div className="oh-game-design-empty">
    <strong>{t('game.design.example.title')}</strong>
    <p>{t('game.design.example.body')}</p>
    <code>{NOVEL_TO_GAME_EXAMPLE_PATH}</code>
  </div>
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
        {workspace.games.some(item => item.source === 'workspace') && <optgroup label={t('game.project.mine')}>{workspace.games.filter(item => item.source === 'workspace').map(item => <option value={item.id} key={item.id}>{t('game.project.mineOption', { title: item.title })}</option>)}</optgroup>}
        {workspace.games.some(item => item.source === 'example') && <optgroup label={t('game.project.bundled')}>{workspace.games.filter(item => item.source === 'example').map(item => <option value={item.id} key={item.id}>{t('game.project.bundledOption', { title: item.title })}</option>)}</optgroup>}
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
        >{tab === 'preview' ? t('game.tab.preview') : project.source === 'example' ? t('game.tab.guide') : t('game.tab.files')}</button>)}
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

function CreativeWorkbench({
  t,
  sessionId,
  runningCalls,
  partial,
  settledMutation,
  productionQueue,
  productionIntents,
  liveJobs,
  jobsReady,
  beginProductionSubmission,
  sendProductionPrompt,
  stopProductionJob,
  removeQueuedProduction,
  workspace,
  error,
  sessionUnavailable,
  workspaceLoading,
  reload,
  open,
  navigation,
  tabId,
  consumeFileNavigation,
  savingPaths,
  beginFileSave,
  endFileSave,
  useStore,
  actions,
}: {
  readonly t: TranslateNS<typeof NS>
  readonly sessionId: string
  readonly runningCalls: readonly RunningToolCall[]
  readonly partial: PartialAssistant | null
  readonly settledMutation: string | undefined
  readonly productionQueue: readonly ProductionQueueEntry[]
  readonly productionIntents: readonly SettledProductionIntent[]
  readonly liveJobs: readonly SessionJob[]
  readonly jobsReady: boolean
  readonly workspace: WorkspacePayload | undefined
  readonly error: string | undefined
  readonly sessionUnavailable: boolean
  readonly workspaceLoading: boolean
  readonly reload: () => void
  readonly open: boolean
  readonly navigation: SidebarRightTabNavigation
  readonly tabId: TabId
  readonly savingPaths: ReadonlySet<string>
} & Pick<WorkbenchSlotProps, 'useStore' | 'actions' | 'beginProductionSubmission' | 'sendProductionPrompt' | 'stopProductionJob' | 'removeQueuedProduction' | 'consumeFileNavigation' | 'beginFileSave' | 'endFileSave'>) {
  const activities = useMemo(
    () => fileMutations(runningCalls, partial),
    [partial, runningCalls],
  )
  const normalizedActivities = useMemo(() => activities.flatMap((activity) => {
    const path = creativeRelativePath(activity.path, workspace?.cwd)
    return path === undefined ? [] : [{ activity, path }]
  }), [activities, workspace?.cwd])
  const primaryActivity = normalizedActivities.at(-1)
  const activityPaths = useMemo(() => new Set(normalizedActivities.map(value => value.path)), [normalizedActivities])
  const activity = primaryActivity?.activity
  const activityPath = primaryActivity?.path
  const workbench = useStore(memory => memory.workbench)
  const setWorkbench = actions.setWorkbench
  const gameTab = useStore(memory => memory.gameTab)
  const setGameTab = actions.setGameTab
  const gameProjectId = useStore(memory => memory.gameProjectId)
  const setGameProjectId = actions.setGameProjectId
  const videoTab = useStore(memory => memory.videoTab)
  const setVideoTab = actions.setVideoTab
  const videoProjectId = useStore(memory => memory.videoProjectId)
  const setVideoProjectId = actions.setVideoProjectId
  const selected = useStore(memory => memory.selected)
  const setSelected = actions.setSelected
  const buffers = useStore(memory => memory.buffers)
  const setBuffers = actions.setBuffers
  const buffersRef = useRef<Record<string, FileBuffer>>({})
  const expanded = useStore(memory => memory.expanded)
  const setExpanded = actions.setExpanded
  const productionSection = useStore(memory => memory.productionSection)
  const setProductionSection = actions.setProductionSection
  const productionSelectedIds = useStore(memory => memory.productionSelectedIds)
  const productionRequestsByEpisode = useStore(memory => memory.productionRequests)
  const productionSelectionsByEpisode = useStore(memory => memory.productionSelections)
  const productionReferencesByEpisode = useStore(memory => memory.productionReferences)
  const productionSequenceByEpisode = useStore(memory => memory.productionSequence)
  const productionCanvasByEpisode = useStore(memory => memory.productionCanvas)
  const productionZoomByEpisode = useStore(memory => memory.productionZoom)
  const productionIntentSeq = useStore(memory => memory.productionIntentSeq)
  // Stop persisting the retired consumed call-id ledger once it seeded the cursor.
  const persistedIntentCalls = useStore(memory => (memory as PersistedWorkbenchMemory).productionIntentCalls)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [contentLayout, setContentLayout] = useState('wide')
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return
    const observer = new ResizeObserver(() => {
      setContentLayout(surface.clientWidth < 620 ? 'compact' : surface.clientWidth < 900 ? 'medium' : 'wide')
    })
    observer.observe(surface)
    return () => { observer.disconnect() }
  }, [])
  const navRef = useRef<HTMLElement>(null)
  const activityBases = useRef(new Map<string, { readonly path: string; readonly base: string }>())
  const previousSignals = useRef<ReadonlySet<string>>(new Set())
  const previousSettledMutation = useRef(settledMutation)
  const buffer = selected === undefined ? undefined : buffers[selected]
  const selectedFile = workspace?.files.find(file => file.path === selected)
  const selectedMedia = selectedFile?.kind === 'media'
  const dirty = buffer?.source === 'human' && buffer.content !== buffer.saved
  const saving = selected !== undefined && savingPaths.has(selected)
  const fileError = buffer?.error
  const conflict = buffer?.conflict
  const selectedLower = selected?.toLocaleLowerCase()
  const markdown = selectedLower?.endsWith('.md') === true
  const jsonl = selectedLower?.endsWith('.jsonl') === true
  const structured = jsonl || selectedLower?.endsWith('.json') === true
  const previewable = markdown || jsonl
  const episodeDirectory = episodeDirectoryForPath(selected)
  const productionAvailable = selected !== undefined && isCreatorDocumentPath(selected) && episodeDirectory !== undefined
  const editorModes = productionAvailable ? EDITOR_MODES : EDITOR_MODES.filter(mode => mode !== 'production')
  const episodeDocumentPaths = useMemo(
    () => episodeDirectory === undefined ? [] : creatorDocumentPaths(workspace?.files.filter(file => file.kind === 'text') ?? [], episodeDirectory),
    [episodeDirectory, workspace?.files],
  )
  const episodeDocuments = useMemo(() => Object.fromEntries(episodeDocumentPaths.flatMap((path) => {
    const current = buffers[path]
    return current === undefined || current.missing === true ? [] : [[path, current.content] as const]
  })), [buffers, episodeDocumentPaths])
  const episodeProduction = useMemo(
    () => episodeDirectory === undefined ? undefined : parseEpisodeProduction(episodeDocuments, episodeDirectory),
    [episodeDirectory, episodeDocuments],
  )
  const productionLibrary = useMemo(() => (workspace?.files ?? []).flatMap((file): ProductionMediaVersion[] => {
    if (file.kind !== 'media' || file.mimeType?.startsWith('audio/') === true) return []
    const parsed = parseCreativePath(file.path)
    const selectedProject = parseCreativePath(episodeDirectory)
    if (parsed?.domain !== 'drama' || parsed.projectRoot !== selectedProject?.projectRoot) return []
    const targetId = file.path.toLocaleUpperCase().match(/(?:SHOT|IMG|MOTION|VISUAL)-[A-Z0-9-]+/u)?.[0] ?? file.path.split('/').at(-2) ?? 'PROJECT-MEDIA'
    return [{
      id: `workspace:${file.path}:${file.version}`,
      targetId,
      kind: file.mimeType?.startsWith('image/') === true ? 'image' : 'video',
      url: endpoint('media', sessionId, file.path),
      path: file.path,
    }]
  }), [episodeDirectory, sessionId, workspace?.files])
  const productionVersions = useMemo(() => {
    if (episodeProduction === undefined) return []
    const knownTargets = [
      ...episodeProduction.shots.map(shot => shot.id),
      ...episodeProduction.assets.map(asset => asset.id),
      ...episodeProduction.visualAssets.map(asset => asset.id),
      ...episodeProduction.motions.map(motion => motion.id),
    ].sort((left, right) => right.length - left.length)
    const motionTargets = new Map(episodeProduction.motions.flatMap(motion =>
      motion.shotId === undefined ? [] : [[motion.id, motion.shotId] as const],
    ))
    const fromWorkspace = productionLibrary.flatMap((version) => {
      if (version.path === undefined || parseCreativePath(version.path)?.episodePath !== episodeProduction.episodeDirectory) return []
      const matched = mediaTargetFromPath(version.path, knownTargets)
      const composition = /(?:^|\/)成片-[^/]+\.mp4$/iu.test(version.path)
      if (matched === undefined && !composition) return []
      const targetId = matched === undefined ? episodeProduction.episodeDirectory : motionTargets.get(matched) ?? matched
      return [{ ...version, targetId }]
    })
    const byId = new Map<string, ProductionMediaVersion>()
    for (const version of fromWorkspace) byId.set(version.id, version)
    return [...byId.values()]
  }, [episodeProduction, productionLibrary])
  const productionSelectedId = episodeDirectory === undefined ? undefined : productionSelectedIds[episodeDirectory]
  const productionRequests = useMemo(() => episodeDirectory === undefined ? []
    : productionRequestsForEpisode(productionRequestsByEpisode[episodeDirectory] ?? [], productionIntents, episodeDirectory),
  [episodeDirectory, productionIntents, productionRequestsByEpisode])
  const productionJobViews = useMemo(() => episodeDirectory === undefined ? []
    : productionBindingsForEpisode(productionIntents, episodeDirectory).map(binding => productionJobView(binding, liveJobs, jobsReady)),
  [episodeDirectory, productionIntents, liveJobs, jobsReady])
  const productionSelections = episodeDirectory === undefined ? {} : productionSelectionsByEpisode[episodeDirectory] ?? {}
  const productionReferences = episodeDirectory === undefined ? {} : productionReferencesByEpisode[episodeDirectory] ?? {}
  const productionSequence = episodeDirectory === undefined ? [] : productionSequenceByEpisode[episodeDirectory] ?? []
  const productionCanvas = episodeDirectory === undefined ? {} : productionCanvasByEpisode[episodeDirectory] ?? {}
  const productionZoom = episodeDirectory === undefined ? .65 : productionZoomByEpisode[episodeDirectory] ?? .65
  const setProductionSelectedId = useCallback((selectedId: string | undefined) => {
    if (episodeDirectory !== undefined) actions.setProductionSelectedIds(current => ({ ...current, [episodeDirectory]: selectedId }))
  }, [actions, episodeDirectory])
  const setProductionRequests = useCallback((requests: ProductionRequest[]) => {
    if (episodeDirectory !== undefined) actions.setProductionRequests(current => ({
      ...current, [episodeDirectory]: requests.filter(request => request.legacy !== true),
    }))
  }, [actions, episodeDirectory])
  const setProductionSelections = useCallback((selections: Record<string, string>) => {
    if (episodeDirectory !== undefined) actions.setProductionSelections(current => ({ ...current, [episodeDirectory]: selections }))
  }, [actions, episodeDirectory])
  const setProductionReferences = useCallback((references: Record<string, string[]>) => {
    if (episodeDirectory !== undefined) actions.setProductionReferences(current => ({ ...current, [episodeDirectory]: references }))
  }, [actions, episodeDirectory])
  const setProductionSequence = useCallback((sequence: ProductionSequenceItem[]) => {
    if (episodeDirectory !== undefined) actions.setProductionSequence(current => ({ ...current, [episodeDirectory]: sequence }))
  }, [actions, episodeDirectory])
  const setProductionCanvas = useCallback((canvas: Record<string, CanvasPoint>) => {
    if (episodeDirectory !== undefined) actions.setProductionCanvas(current => ({ ...current, [episodeDirectory]: canvas }))
  }, [actions, episodeDirectory])
  const setProductionZoom = useCallback((zoom: number) => {
    if (episodeDirectory !== undefined) actions.setProductionZoom(current => ({ ...current, [episodeDirectory]: zoom }))
  }, [actions, episodeDirectory])
  const editorMode = useStore(memory => memory.editorMode)
  const setEditorMode = actions.setEditorMode
  const modeSelection = useRef(selected)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editorPositions = useRef(
    new Map<string, { readonly scrollTop: number; readonly selectionStart: number; readonly selectionEnd: number }>(),
  )
  const editorReady = buffer !== undefined && buffer.missing !== true
  const workspaceKind = workbench === 'game' || workbench === 'video' ? undefined : workbench
  const gameBuilding = normalizedActivities.some(({ path }) => path.startsWith('game-adaptations/'))
  const videoBuilding = normalizedActivities.some(({ path }) => path.startsWith('video-recaps/'))

  useEffect(() => { buffersRef.current = buffers }, [buffers])

  const rememberEditorPosition = useCallback((): void => {
    const element = textareaRef.current
    if (element === null || selected === undefined || element.getAttribute('aria-label') !== selected) return
    editorPositions.current.set(selected, {
      scrollTop: element.scrollTop,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
    })
  }, [selected])

  useLayoutEffect(() => {
    if (editorMode !== 'source' || selected === undefined || !editorReady) return
    const element = textareaRef.current
    const position = editorPositions.current.get(selected)
    if (element === null || position === undefined) return
    const end = Math.min(position.selectionEnd, element.value.length)
    element.setSelectionRange(Math.min(position.selectionStart, end), end)
    element.scrollTop = position.scrollTop
  }, [editorMode, editorReady, selected])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (!Object.values(buffersRef.current).some(value => value.source === 'human' && value.content !== value.saved)) return
      event.preventDefault()
    }
    globalThis.addEventListener('beforeunload', warn)
    return () => { globalThis.removeEventListener('beforeunload', warn) }
  }, [])

  const expandPath = useCallback((path: string): void => {
    const segments = path.split('/')
    const ancestors = [groupForPath(path, t)]
    for (let index = 1; index < segments.length - 1; index += 1) ancestors.push(segments.slice(0, index + 1).join('/'))
    setExpanded((current) => {
      const next = { ...current }
      for (const ancestor of ancestors) next[ancestor] = true
      return next
    })
  }, [t])

  const revealPath = useCallback((path: string): void => {
    rememberEditorPosition()
    const nextWorkbench = workbenchModeForPath(path) ?? 'story'
    setWorkbench(nextWorkbench)
    if (nextWorkbench === 'game' && !path.includes('/build/app/')) setGameTab('design')
    setSelected(path)
    expandPath(path)
  }, [expandPath, rememberEditorPosition])

  useEffect(() => {
    if (workspace === undefined) return
    const applied = consumedIntentSeq(productionIntents, productionIntentSeq, persistedIntentCalls)
    // One-time migration: the retired ledger seeds the cursor and is retired, so
    // the store stops growing a boolean per production call.
    if (persistedIntentCalls !== undefined) {
      if (applied !== productionIntentSeq) actions.setProductionIntentSeq(applied)
      actions.retireProductionIntentCalls()
      return
    }
    const pending = productionIntents.filter(({ seq }) => seq > applied)
    if (pending.length === 0) return
    for (const { intent } of pending) {
      if (intent.action === 'open_section' || intent.action === 'focus_target') {
        const documentPath = ['分镜.md', '图片提示词.md', '视觉设定.md', '剧本.md', '视频提示词.md']
          .map(name => `${intent.episode}/${name}`)
          .find(path => workspace.files.some(file => file.path === path))
        if (documentPath !== undefined) {
          setWorkbench('drama')
          setSelected(documentPath)
          expandPath(documentPath)
          globalThis.setTimeout(() => { setEditorMode('production') }, 0)
        }
      }
      if (intent.action === 'open_section') setProductionSection(intent.section ?? 'shots')
      else if (intent.action === 'focus_target') {
        actions.setProductionSelectedIds(current => ({ ...current, [intent.episode]: intent.targetId }))
        setProductionSection(intent.section ?? (intent.targetId?.startsWith('SHOT-') === true ? 'shots' : 'assets'))
      } else if (intent.action === 'set_sequence') {
        actions.setProductionSequence(current => ({
          ...current,
          [intent.episode]: (intent.shotIds ?? []).map(shotId => ({ shotId })),
        }))
      }
    }
    // Every result above the cursor is consumed, including `track_job` results
    // whose only work was contributing their durable request and binding data.
    actions.setProductionIntentSeq(pending.reduce((highest, { seq }) => Math.max(highest, seq), applied))
  }, [
    actions, expandPath, persistedIntentCalls, productionIntentSeq, productionIntents, setEditorMode,
    setProductionSection, setSelected, setWorkbench, workspace,
  ])

  useEffect(() => {
    const params = navigation.params
    if (params === undefined || !('creativeFile' in params) || params.creativeFile.sessionId !== sessionId
      || workspace === undefined || !open || !consumeFileNavigation(tabId, navigation.revision)) return
    revealPath(params.creativeFile.path)
  }, [consumeFileNavigation, navigation, open, revealPath, sessionId, tabId, workspace])

  const openedGame = useRef(false)
  if (open && workbench === 'game') openedGame.current = true
  const gameStudioMounted = openedGame.current
  const openedVideo = useRef(false)
  if (open && workbench === 'video') openedVideo.current = true
  const videoStudioMounted = openedVideo.current

  const followAgentPath = useCallback((path: string): void => {
    expandPath(path)
    const current = selected === undefined ? undefined : buffersRef.current[selected]
    const preserveFocusedDraft = path !== selected
      && current?.source === 'human'
      && current.content !== current.saved
      && surfaceRef.current?.ownerDocument.activeElement === textareaRef.current
    if (preserveFocusedDraft) return
    // The editor textarea is not mounted in the Game Studio, so the draft guard above can never
    // fire there. Never preempt a running game: agent writes may expand the tree, not navigate.
    if ((workbench === 'game' && gameTab === 'preview') || (workbench === 'video' && videoTab === 'preview')) return
    revealPath(path)
  }, [expandPath, gameTab, revealPath, selected, videoTab, workbench])

  useEffect(() => {
    if (activityPath !== undefined && activityPath === selected && !selectedMedia) setEditorMode('source')
  }, [activityPath, selected, selectedMedia])

  useEffect(() => {
    if (modeSelection.current === selected) return
    modeSelection.current = selected
    setEditorMode(selected !== undefined && activityPaths.has(selected) ? 'source' : selectedMedia || previewable ? 'preview' : 'source')
  }, [activityPaths, previewable, selected, selectedMedia])

  useEffect(() => {
    if (workspaceLoading) return
    if (activityPath !== undefined) return
    if (selected !== undefined && (
      (workspace?.files.some(file => file.path === selected) ?? false)
      || buffers[selected] !== undefined
    ) && workbenchModeForPath(selected) === workbench) return
    setSelected(workspace === undefined ? undefined : preferredWorkbenchFile(workspace.files, workbench))
  }, [activityPath, buffers, selected, workbench, workspace, workspaceLoading])

  useEffect(() => {
    if (workspace === undefined || workspaceLoading) return
    const paths = new Set([...workspace.files.map(file => file.path), ...activityPaths])
    setBuffers(current => reconcileBuffers(current, paths, workspace.truncated, t('editor.removedNotice')))
  }, [activityPaths, t, workspace, workspaceLoading])

  const readTargets = new Set(productionAvailable ? episodeDocumentPaths : [])
  if (selected !== undefined && !selectedMedia) readTargets.add(selected)
  const readKey = JSON.stringify((workspace?.files ?? []).flatMap(file =>
    file.kind === 'text' && readTargets.has(file.path) && !activityPaths.has(file.path)
      && needsFileRead(buffers[file.path], file.version) ? [[file.path, file.version]] : [],
  ))

  useEffect(() => {
    const requests = JSON.parse(readKey) as Array<[string, string]>
    if (requests.length === 0) return
    const controller = new AbortController()
    void Promise.all(requests.map(async ([path]) => {
      try {
        const file = await json<FilePayload>(await fetch(endpoint('file', sessionId, path), { signal: controller.signal }))
        return { path, file }
      } catch (reason) {
        return { path, error: reason instanceof Error ? reason.message : String(reason) }
      }
    })).then((results) => {
      if (controller.signal.aborted) return
      setBuffers((current) => {
        const next = { ...current }
        for (const result of results) {
          const existing = current[result.path]
          if (result.file !== undefined) {
            next[result.path] = receiveFile(existing, result.file, t('editor.conflict.diskDraft', { path: result.path }))
          } else if (existing !== undefined) {
            next[result.path] = { ...existing, error: result.error }
          }
        }
        return next
      })
    })
    return () => { controller.abort() }
  }, [readKey, sessionId, t, workspace?.files])

  useEffect(() => {
    if (normalizedActivities.length === 0) return
    for (const { path } of normalizedActivities) expandPath(path)
    if (activityPath !== undefined) followAgentPath(activityPath)
    setBuffers((current) => {
      let next = current
      for (const { activity: currentActivity, path } of normalizedActivities) {
        const existing = next[path]
        if (existing?.source === 'human' && existing.content !== existing.saved) {
          next = {
            ...next,
            [path]: {
              ...existing,
              conflict: { message: t('editor.conflict.agentLock', { path }) },
            },
          }
          continue
        }
        let basis = activityBases.current.get(currentActivity.callId)
        if (basis === undefined || basis.path !== path) {
          basis = { path, base: existing?.content ?? '' }
          activityBases.current.set(currentActivity.callId, basis)
        }
        const preview = previewMutation(currentActivity, basis.base)
        if (preview === undefined || (existing?.source === 'agent' && existing.content === preview)) continue
        next = {
          ...next,
          [path]: {
            content: preview,
            saved: existing?.saved ?? '',
            source: 'agent',
            version: existing?.version ?? '',
          },
        }
      }
      return next
    })
  }, [activityPath, expandPath, followAgentPath, normalizedActivities])

  useEffect(() => {
    const signals = new Set(mutatingCallIds(runningCalls))
    for (const { activity: currentActivity } of normalizedActivities) signals.add(currentActivity.callId.split(':', 1)[0] ?? currentActivity.callId)
    const settled = [...previousSignals.current].some(callId => !signals.has(callId))
    for (const callId of activityBases.current.keys()) {
      if (!signals.has(callId.split(':', 1)[0] ?? callId)) activityBases.current.delete(callId)
    }
    previousSignals.current = signals
    if (!settled) return
    reload()
  }, [normalizedActivities, reload, runningCalls])

  useEffect(() => {
    if (settledMutation === undefined || settledMutation === previousSettledMutation.current) return
    // The signal carries an absolute path, so creativeRelativePath cannot resolve it until the
    // workspace (and its cwd) has loaded. Consuming the signal first would burn it: the effect
    // re-runs when cwd arrives, but the guard above then short-circuits and the agent's file is
    // never selected. Wait for cwd instead of dropping the follow.
    if (workspace?.cwd === undefined) return
    previousSettledMutation.current = settledMutation
    const path = creativeRelativePath(settledMutation.slice(settledMutation.indexOf('\0') + 1), workspace.cwd)
    if (path !== undefined) followAgentPath(path)
    reload()
  }, [followAgentPath, reload, settledMutation, workspace?.cwd])

  useEffect(() => {
    if (selected === undefined) return
    for (const button of navRef.current?.querySelectorAll<HTMLButtonElement>('button[data-file-path]') ?? []) {
      if (button.dataset.filePath === selected) {
        button.scrollIntoView({ block: 'nearest' })
        break
      }
    }
  }, [selected])

  const savePath = useCallback(async (path: string) => {
    const submitted = buffersRef.current[path]
    if (submitted === undefined || submitted.missing === true || submitted.content === submitted.saved || !beginFileSave(path)) return
    setBuffers((current) => {
      const existing = current[path]
      return existing === undefined ? current : { ...current, [path]: { ...existing, error: undefined } }
    })
    try {
      const file = await json<FilePayload>(await fetch(endpoint('file', sessionId, path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: submitted.content, baseVersion: submitted.version }),
      }))
      setBuffers((current) => {
        const latest = current[path]
        if (latest === undefined) return current
        const unchanged = latest.content === submitted.content
        return {
          ...current,
          [path]: {
            content: unchanged ? file.content : latest.content,
            saved: file.content,
            source: unchanged ? 'disk' : 'human',
            version: file.version,
          },
        }
      })
      reload()
    } catch (reason) {
      if (reason instanceof WorkspaceRequestError && reason.status === 412) {
        try {
          const theirs = await json<FilePayload>(await fetch(endpoint('file', sessionId, path)))
          setBuffers((current) => {
            const latest = current[path]
            if (latest === undefined) return current
            return {
              ...current,
              [path]: {
                ...latest,
                conflict: {
                  message: t('editor.conflict.choose', { path }),
                  theirs: theirs.content,
                  theirsVersion: theirs.version,
                },
              },
            }
          })
        } catch (refreshError) {
          setBuffers((current) => {
            const existing = current[path]
            return existing === undefined ? current : {
              ...current,
              [path]: { ...existing, error: refreshError instanceof Error ? refreshError.message : String(refreshError) },
            }
          })
        }
      } else {
        setBuffers((current) => {
          const existing = current[path]
          return existing === undefined ? current : {
            ...current,
            [path]: { ...existing, error: reason instanceof Error ? reason.message : String(reason) },
          }
        })
      }
    } finally {
      endFileSave(path)
    }
  }, [beginFileSave, endFileSave, reload, sessionId])

  useEffect(() => {
    if (!open) return
    const saveShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 's') return
      event.preventDefault()
      if (selected !== undefined) void savePath(selected)
    }
    globalThis.addEventListener('keydown', saveShortcut)
    return () => { globalThis.removeEventListener('keydown', saveShortcut) }
  }, [open, savePath, selected])

  const groups = useMemo(() => {
    const value = new Map<string, WorkspaceFile[]>()
    const all = [...(workspace?.files ?? [])].filter(file => workbenchModeForPath(file.path) === workbench)
    if (activityPath !== undefined && !all.some(file => file.path === activityPath)) all.push({ path: activityPath, bytes: 0, version: '', kind: 'text' })
    all.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'))
    for (const file of all) {
      const directory = groupForPath(file.path, t)
      const files = value.get(directory) ?? []
      files.push(file)
      value.set(directory, files)
    }
    const order = GROUP_ORDER[workbench]
    return [...value.entries()].sort(([left], [right]) => {
      const leftIndex = order.indexOf(left)
      const rightIndex = order.indexOf(right)
      return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
        || left.localeCompare(right, 'zh-Hans-CN')
    })
  }, [activityPath, workbench, workspace])

  const selectWorkbench = (next: WorkbenchMode): void => {
    setWorkbench(next)
    if (next === 'game' || next === 'video') {
      if (next === 'game') setGameTab('preview')
      else setVideoTab('preview')
      setSelected(undefined)
      return
    }
    const target = workspace === undefined ? undefined : preferredWorkbenchFile(workspace.files, next)
    if (target === undefined) setSelected(undefined)
    else revealPath(target)
  }
  const selectEditorMode = (next: WorkbenchMemory['editorMode']): void => {
    if (next === 'preview') rememberEditorPosition()
    setEditorMode(next)
  }
  const navigateProductionTarget = (target: DramaDocumentTarget): void => {
    const content = buffersRef.current[target.path]?.content ?? ''
    const before = content.slice(0, target.offset)
    const approximateScrollTop = Math.max(0, before.split(/\r?\n/u).length * 28 - 96)
    editorPositions.current.set(target.path, {
      scrollTop: approximateScrollTop,
      selectionStart: target.offset,
      selectionEnd: target.offset,
    })
    modeSelection.current = target.path
    revealPath(target.path)
    setEditorMode('source')
  }
  const selectedLabel = selected ?? t('workbench.selectPrompt', { mode: t(WORKBENCH_LABEL_KEYS[workbench]) })
  const selectedBasename = selected?.split('/').at(-1) ?? selectedLabel
  const selectedGroup = selected === undefined ? undefined : groupForPath(selected, t)
  const toggleGroup = (key: string, open: boolean): void => {
    setExpanded(current => ({ ...current, [key]: open }))
  }
  const resolveConflict = (keepLocal: boolean): void => {
    if (selected === undefined || conflict?.theirs === undefined || conflict.theirsVersion === undefined) return
    const theirs = conflict.theirs
    const theirsVersion = conflict.theirsVersion
    setBuffers((current) => {
      const existing = current[selected]
      if (existing === undefined) return current
      return {
        ...current,
        [selected]: keepLocal
          ? { ...existing, saved: theirs, version: theirsVersion, source: 'human', conflict: undefined }
          : { content: theirs, saved: theirs, source: 'disk', version: theirsVersion },
      }
    })
  }

  return <div ref={surfaceRef} className="creative-workspace" data-workbench={workbench} data-layout={contentLayout}>
    {workbench === 'game' && workspace === undefined && <main className="oh-game-studio"><div className="oh-game-design-empty">{sessionUnavailable ? <SessionUnavailableNotice t={t} /> : (error ?? t('game.connecting'))}</div></main>}
    {workspace !== undefined && gameStudioMounted && <GameStudio
      t={t}
      sessionId={sessionId}
      workspace={workspace}
      building={gameBuilding}
      selected={selected}
      gameTab={gameTab}
      gameProjectId={gameProjectId}
      hidden={workbench !== 'game'}
      onGameTab={setGameTab}
      onGameProject={setGameProjectId}
      workbenches={WORKBENCH_MODES}
      onWorkbench={selectWorkbench}
      onSelect={revealPath}
    />}
    {workbench === 'video' && workspace === undefined && <main className="oh-video-studio"><div className="oh-video-preview-empty">{sessionUnavailable ? <SessionUnavailableNotice t={t} /> : (error ?? t('video.connecting'))}</div></main>}
    {workspace !== undefined && videoStudioMounted && <VideoStudio
      t={t}
      sessionId={sessionId}
      projects={workspace.videos}
      running={videoBuilding}
      projectId={videoProjectId}
      tab={videoTab}
      hidden={workbench !== 'video'}
      workbenches={WORKBENCH_MODES}
      onProject={setVideoProjectId}
      onTab={setVideoTab}
      onWorkbench={selectWorkbench}
    />}
    {workbench !== 'game' && workbench !== 'video' && <>
      <aside className="creative-tree">
        <div className="creative-brand">
          <span className="creative-brand-cluster"><strong>✦ <span>{t('workbench.brand')}</span></strong>{workspaceKind !== undefined && <span className="creative-kind">{t(WORKBENCH_LABEL_KEYS[workspaceKind])}</span>}</span>
          <span className="creative-brand-actions">
            <button type="button" onClick={reload} title={t('workbench.reload')} aria-label={t('workbench.reloadFiles')}>↻</button>
          </span>
        </div>
        {workspace !== undefined && <div className="creative-mode-tabs" role="tablist" aria-label={t('workbench.tablist')}>
          {WORKBENCH_MODES.map(mode => <button
            type="button"
            role="tab"
            key={mode}
            tabIndex={workbench === mode ? 0 : -1}
            aria-selected={workbench === mode}
            onKeyDown={(event) => { handleTabKey(event, WORKBENCH_MODES, workbench, selectWorkbench) }}
            onClick={() => { selectWorkbench(mode) }}
          >{t(WORKBENCH_LABEL_KEYS[mode])}</button>)}
        </div>}
        {sessionUnavailable ? <SessionUnavailableNotice t={t} /> : error !== undefined && <div className="creative-error">{error}</div>}
        {workspace?.projects.find(project => project.root === parseCreativePath(selected)?.projectRoot)?.metadataErrors.map(message => <div className="creative-warning" key={message}>{message}</div>)}
        {workspace?.truncated === true && <div className="creative-warning">{t('tree.truncated')}</div>}
        <nav ref={navRef} aria-label={workbench === 'story' ? t('tree.story.files') : t('tree.drama.files')}>
          {groups.map(([directory, files]) => {
            const groupOpen = selectedGroup === directory || expanded[directory] === true
            return <details className="creative-file-group" key={directory} open={groupOpen} onToggle={(event) => { toggleGroup(directory, event.currentTarget.open) }}>
              <summary>{directory}<span>{files.length}</span></summary>
              <FileTreeNodes
                nodes={buildFileTree(files, directory)}
                depth={1}
                expanded={expanded}
                selected={selected}
                activityPath={activityPath}
                onToggle={toggleGroup}
                onSelect={revealPath}
              />
            </details>
          })}
        </nav>
      </aside>
      <main className="creative-editor">
        <header>
          <span className="creative-editor-path" title={selected}><span>{selectedLabel}</span><strong>{selectedBasename}</strong></span>
          <div className="creative-editor-actions">
            {(previewable || productionAvailable) && !selectedMedia && <div className="creative-editor-tabs" role="tablist" aria-label={productionAvailable ? t('editor.viewMode.drama') : markdown ? t('editor.viewMode.markdown') : t('editor.viewMode.jsonl')}>
              {editorModes.map(mode => <button
                type="button"
                role="tab"
                key={mode}
                tabIndex={editorMode === mode ? 0 : -1}
                aria-selected={editorMode === mode}
                onKeyDown={(event) => { handleTabKey(event, editorModes, editorMode, selectEditorMode) }}
                onClick={() => { selectEditorMode(mode) }}
              >{mode === 'preview' ? t('editor.mode.preview') : mode === 'source' ? t('editor.mode.source') : t('editor.mode.production')}</button>)}
            </div>}
            {(dirty || saving) && selected !== undefined && <button className="creative-save" type="button" disabled={saving || buffer?.missing === true} onClick={() => { void savePath(selected) }}>
              {saving ? t('editor.saving') : t('editor.save')}
            </button>}
          </div>
        </header>
        {activity !== undefined && activityPath !== undefined && activityPath === selected && <div className="creative-stream" data-stage={activity.stage} role="status" aria-live="polite">● {activity.stage === 'running' ? t('editor.stream.applying') : t('editor.stream.generating')}</div>}
        {conflict !== undefined && <div className="creative-conflict" role="alert">
          <span>{conflict.message}</span>
          {conflict.theirs !== undefined && conflict.theirsVersion !== undefined && selected !== undefined && <div>
            <button type="button" onClick={() => { resolveConflict(false) }}>{t('editor.conflict.loadDisk')}</button>
            <button type="button" onClick={() => { resolveConflict(true) }}>{t('editor.conflict.keepDraft')}</button>
          </div>}
        </div>}
        {fileError !== undefined && <div className="creative-error">{fileError}</div>}
        {selected === undefined
          ? <div className="creative-empty">{workbench === 'story'
            ? <>{t('editor.empty.story.prefix')} <code>{t('editor.empty.story.command')}</code>{t('editor.empty.story.suffix')}</>
            : <>{t('editor.empty.drama.prefix')} <code>{t('editor.empty.drama.command')}</code>{t('editor.empty.drama.suffix')}</>}</div>
          : selectedMedia
            ? <div className="creative-media-document">{selectedFile.mimeType?.startsWith('image/') === true
              ? <img src={endpoint('media', sessionId, selectedFile.path)} alt={selectedFile.path} />
              : selectedFile.mimeType?.startsWith('audio/') === true
                ? <audio src={endpoint('media', sessionId, selectedFile.path)} controls />
                : <video src={endpoint('media', sessionId, selectedFile.path)} controls preload="metadata" />}</div>
            : buffer === undefined
              ? <div className="creative-empty">{t('editor.loading', { path: selected })}</div>
              : buffer.missing === true
                ? <div className="creative-empty">{t('editor.removed.body')}<button type="button" onClick={() => {
                  setBuffers((current) => {
                    const { [selected]: _, ...next } = current
                    return next
                  })
                  setSelected(workspace === undefined ? undefined : preferredWorkbenchFile(workspace.files, workbench))
                }}>{t('editor.discardDraft')}</button></div>
                : editorMode === 'production' && productionAvailable && episodeProduction !== undefined
                  ? <DramaProductionView
                    t={t}
                    production={episodeProduction}
                    queue={productionQueue}
                    section={productionSection}
                    selectedId={productionSelectedId}
                    requests={productionRequests}
                    jobViews={productionJobViews}
                    versions={productionVersions}
                    libraryVersions={productionLibrary}
                    selections={productionSelections}
                    manualReferences={productionReferences}
                    sequence={productionSequence}
                    canvas={productionCanvas}
                    zoom={productionZoom}
                    onSectionChange={setProductionSection}
                    onSelect={setProductionSelectedId}
                    onNavigate={navigateProductionTarget}
                    onRequestsChange={setProductionRequests}
                    onSelectionsChange={setProductionSelections}
                    onManualReferencesChange={setProductionReferences}
                    onOpenMedia={(path) => { revealPath(path) }}
                    onSequenceChange={setProductionSequence}
                    onCanvasChange={setProductionCanvas}
                    onZoomChange={setProductionZoom}
                    onBeginSubmission={beginProductionSubmission}
                    onDispatchPrompt={sendProductionPrompt}
                    onStopJob={stopProductionJob}
                    onRemoveQueued={removeQueuedProduction}
                    onRefresh={reload}
                  />
                  : previewable && editorMode === 'preview'
                    ? markdown
                      ? <MarkdownPreview content={buffer.content} label={selected} t={t} />
                      : <JsonlPreview content={buffer.content} label={selected} t={t} />
                    : <textarea
                      ref={textareaRef}
                      value={buffer.content}
                      data-format={structured ? 'structured' : 'prose'}
                      onBlur={rememberEditorPosition}
                      onScroll={rememberEditorPosition}
                      onSelect={rememberEditorPosition}
                      onChange={(event) => {
                        const content = event.target.value
                        setBuffers(current => ({
                          ...current,
                          [selected]: {
                            content,
                            saved: current[selected]?.saved ?? '',
                            source: 'human',
                            version: current[selected]?.version ?? '',
                            conflict: current[selected]?.conflict,
                          },
                        }))
                      }}
                      spellCheck={!structured}
                      aria-label={selected}
                    />}
      </main>
    </>}
  </div>
}

interface ProductionConversationFace {
  readonly hooks: {
    readonly saves: ObservableSnapshot<ReadonlySet<string>>
    readonly production: ObservableSnapshot<readonly SettledProductionIntent[] | undefined>
    readonly jobsBaseline: ObservableSnapshot<SessionJobsBaseline>
  }
  readonly consumeFileNavigation: (tabId: TabId, revision: number) => boolean
  readonly beginFileSave: (path: string) => boolean
  readonly endFileSave: (path: string) => void
  readonly beginProductionSubmission: (prompt: string) => SessionRequestId
  readonly sendProductionPrompt: (prompt: string, requestId: SessionRequestId) => Promise<void>
  readonly stopProductionJob: (job: ProductionBinding['job']) => Promise<void>
  readonly removeQueuedProduction: (itemId: ProductionQueueEntry['id']) => Promise<void>
}

type WorkbenchSlotProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsStore<ReturnType<typeof createWorkbenchStore>> & InjectFace<ProductionConversationFace> & PropsLocale<typeof NS>

function CreativeWorkspace({
  t, sessionId, useSessions, useChat, useProjection, useStore, actions,
  useTabInfo, useSaves, useProduction, useJobsBaseline, consumeFileNavigation, beginFileSave, endFileSave,
  beginProductionSubmission, sendProductionPrompt, stopProductionJob, removeQueuedProduction,
}: WorkbenchSlotProps) {
  const { tab } = useTabInfo()
  // Active tool roots come from the formal Chat node store, not the compatibility
  // running-call slice: one root lifecycle drives both surfaces.
  const chatNodes = useChat(snapshot => snapshot.nodes.values())
  const runningCalls = useMemo(() => runningRootCalls(chatNodes), [chatNodes])
  const partial = useChat(snapshot => streamingAssistant(snapshot.timeline))
  const settledMutation = useChat(snapshot => latestSettledMutation(snapshot))
  // The retired Host queue stream was folded from this same Inbox value, so the
  // board reads the projection directly and keeps reconciling submissions.
  const inbox = useProjection('inbox') as unknown as InboxState | undefined
  const productionQueue = useMemo(() => productionQueueFromInbox(inbox), [inbox])
  const jobState = useSessions(snapshot => snapshot)
  // Separate control-stream observation: job identity is classified against the
  // baseline only once it is ready, so reconnect windows stay "loading".
  const jobsBaselineReady = useJobsBaseline(snapshot => snapshot.ready)
  const productionIntents = useProduction(snapshot => snapshot)
  const savingPaths = useSaves(snapshot => snapshot)
  const { workspace, error, sessionUnavailable, loading: workspaceLoading, reload } = useWorkspace(sessionId)
  return <CreativeWorkbench
    sessionId={sessionId}
    runningCalls={runningCalls}
    partial={partial}
    settledMutation={settledMutation}
    productionQueue={productionQueue}
    productionIntents={productionIntents ?? []}
    liveJobs={jobState.jobsBySession[sessionId] ?? []}
    jobsReady={jobsBaselineReady}
    workspace={workspace}
    error={error}
    sessionUnavailable={sessionUnavailable}
    workspaceLoading={workspaceLoading}
    reload={reload}
    open={tab.visible}
    navigation={tab.navigation}
    tabId={tab.id}
    consumeFileNavigation={consumeFileNavigation}
    savingPaths={savingPaths}
    beginFileSave={beginFileSave}
    endFileSave={endFileSave}
    beginProductionSubmission={beginProductionSubmission}
    sendProductionPrompt={sendProductionPrompt}
    stopProductionJob={stopProductionJob}
    removeQueuedProduction={removeQueuedProduction}
    useStore={useStore}
    actions={actions}
    t={t}
  />
}

function argsOf(block: ToolCallViewProps['block']): Record<string, unknown> {
  const raw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? '{}'
  try {
    const value = JSON.parse(raw) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

function resultOf(block: ToolCallViewProps['block']): string | undefined {
  if (!('kind' in block)) return undefined
  return block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2)).join('\n')
}

type RoleToolViewProps = ToolCallViewProps & PropsLocale<typeof NS>

function RoleToolView({ block, inspect, t }: RoleToolViewProps) {
  const args = argsOf(block)
  const role = typeof args.role === 'string' ? args.role : 'story-role'
  const output = resultOf(block)
  const state = !('kind' in block) ? 'running' : block.isError ? 'error' : 'done'
  return <details className="creative-role" data-state={state}>
    <summary><span>✦ {t('role.view.title')}</span><strong>{role}</strong><em>{state === 'running' ? t('role.state.running') : state === 'error' ? t('role.state.error') : t('role.state.done')}</em></summary>
    {output !== undefined && <pre>{output}</pre>}
    {inspect !== undefined && <button type="button" onClick={inspect}>{t('role.inspect')}</button>}
  </details>
}

type ProductionToolViewProps = ToolCallViewProps & PropsLocale<typeof NS>

function ProductionToolView({ block, inspect, t }: ProductionToolViewProps) {
  const args = argsOf(block)
  const action = typeof args.action === 'string' ? args.action : 'production'
  const episode = typeof args.episode === 'string' ? args.episode : t('production.fallbackEpisode')
  const state = !('kind' in block) ? 'running' : block.isError ? 'error' : 'done'
  return <details className="creative-role" data-state={state}>
    <summary><span>▦ {t('production.view.title')}</span><strong>{episode} · {action}</strong><em>{state === 'running' ? t('production.state.running') : state === 'error' ? t('production.state.error') : t('production.state.applied')}</em></summary>
    {resultOf(block) !== undefined && <pre>{resultOf(block)}</pre>}
    {inspect !== undefined && <button type="button" onClick={inspect}>{t('role.inspect')}</button>}
  </details>
}

/**
 * Register the Creative Sidebar tab, file navigation, and production tool views.
 * @param context - Client services for the Sidebar, Session projections, and slots.
 */
export function apply(context: ClientContext): void {
  context.effect(() => context.locale.register(NS, { zh, en }), 'creative: dictionaries')
  const translate = context.locale.bind(NS)
  context.effect(() => context.sidebarRightTabs.register({
    id: WORKBENCH_ID,
    kind: WORKBENCH_KIND,
    title: () => translate('workbench.title'),
    guide: [{
      id: 'workbench',
      order: 20,
      title: () => translate('workbench.title'),
      description: () => translate('workbench.description'),
    }],
  }), 'creative: Sidebar tab type')
  registerProductionProjection(context)
  context.slots.inject('sidebar.right.pane.tab', function* () {
    yield context.on('conversation/open-file', async (sessionId, path, next) => {
      const cwd = context.sessions.list.getSnapshot().byId[sessionId]?.cwd
      const parsed = parseCreativePath(path, cwd)
      if (parsed === undefined || (!isCreativeTextPath(parsed) && creativeMediaMimeType(parsed.path) === undefined)) return next()
      context.sidebarRight.openTab(WORKBENCH_KIND, { params: { creativeFile: { sessionId, path: parsed.path } } })
    })
    yield context.slots.register({
      name: 'sidebar.right.pane.tab',
      key: WORKBENCH_ID,
      locale: NS,
      store: createWorkbenchStore,
      inject: (sessionId): ProductionConversationFace => {
        const saves = createSaveState()
        const navigationRevisions = new Map<TabId, number>()
        const sessionBinding = (): NonNullable<ReturnType<ISessions['binding']>> => {
          const binding = context.sessions.binding(sessionId)
          if (binding === undefined) throw new Error('DSH 会话当前不可用。')
          return binding
        }
        // This Session-scoped operation owns every complete submission handle it
        // mints: the view may read `requestId` to persist its card before
        // dispatch, but only the owner can retire the local echo with
        // `abandon()` when the prompt never settles.
        const submissions = new Map<SessionRequestId, SubmissionHandle>()
        return {
          hooks: {
            saves: saves.active,
            production: context.uiConversation.binding(sessionBinding()).target('creative-production'),
            // Baseline readiness is a control-stream observation the workbench
            // shares with every other job consumer, not per-tab state.
            jobsBaseline: context.sessions.jobsBaseline,
          },
          beginFileSave: saves.begin,
          endFileSave: saves.end,
          consumeFileNavigation: (tabId, revision) => {
            if (navigationRevisions.get(tabId) === revision) return false
            navigationRevisions.set(tabId, revision)
            return true
          },
          beginProductionSubmission: (prompt) => {
            const handle = sessionBinding().session.beginSubmission({ text: prompt, attachments: [], mode: 'queue' })
            submissions.set(handle.requestId, handle)
            return handle.requestId
          },
          sendProductionPrompt: async (prompt, requestId) => {
            // The view may read the identity to persist its card before dispatch,
            // but only this owner retires the local echo when the prompt cannot
            // reach settlement.
            const handle = submissions.get(requestId)
            let settled = false
            try {
              const session = sessionBinding().session
              const result = await session.prompt([{ type: 'text', text: prompt }], 'queue', undefined, requestId)
              // A prompt that answered settled its own identified echo: a rejected
              // outcome retires the local submission through prompt() itself.
              settled = true
              if (!result.ok) throw new Error(result.error.message)
            } catch (failure) {
              // Session lookup, serialization, transport, or another exception
              // kept the prompt from settling, so nothing else retired the echo.
              if (!settled) handle?.abandon()
              throw failure
            } finally {
              submissions.delete(requestId)
            }
          },
          stopProductionJob: async (job) => {
            await json(await fetch(endpoint('job/stop', sessionId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job) }))
          },
          removeQueuedProduction: async (itemId) => {
            const result = await sessionBinding().session.updateQueue(itemId, { kind: 'remove' })
            if (!result.ok) throw new Error(result.error.message)
          },
        }
      },
    }, CreativeWorkspace)
  })
  context.slots.inject('tool.call.toolview', () => context.slots.register({
    name: 'tool.call.toolview',
    key: 'creative_role',
    locale: NS,
  }, RoleToolView))
  context.slots.inject('tool.call.toolview', () => context.slots.register({
    name: 'tool.call.toolview',
    key: CREATIVE_PRODUCTION_TOOL_NAME,
    locale: NS,
  }, ProductionToolView))
}
