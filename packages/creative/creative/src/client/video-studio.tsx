import { useEffect, useId, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { WORKBENCH_LABEL_KEYS, type WorkbenchMode } from './file-activity.js'
import { type CreativeLocaleKey, NS } from './locales/index.ts'
import { endpoint, handleTabKey } from './workbench-ui.js'

export interface VideoPreviewAsset {
  readonly role: 'source' | 'edited' | 'final'
  readonly label: string
  readonly path: string
  readonly bytes: number
  readonly version: string
  readonly mimeType: string
}

export interface VideoArtifactSummary {
  readonly label: string
  readonly path: string
  readonly version: string
  readonly kind: 'plan' | 'script' | 'subtitle' | 'quality' | 'manifest'
}

export interface VideoProject {
  readonly id: string
  readonly root: string
  readonly title: string
  readonly state: 'not-started' | 'working' | 'waiting' | 'ready'
  readonly stage: string
  readonly stageLabel: string
  readonly nextArtifact?: string | undefined
  readonly previews: readonly VideoPreviewAsset[]
  readonly artifacts: readonly VideoArtifactSummary[]
}

interface FilePayload { readonly content: string }
interface VideoPreflight {
  readonly python: { readonly ok: boolean; readonly version?: string }
  readonly ffmpeg: { readonly ok: boolean; readonly subtitles: boolean }
  readonly ffprobe: { readonly ok: boolean }
  readonly credentials: { readonly mimo: boolean; readonly fish: boolean; readonly ttsProvider: string }
}

/** Locale key per pipeline stage code; unknown upstream stage codes fall back to the host label. */
const STAGE_KEYS: Readonly<Record<string, CreativeLocaleKey>> = {
  'awaiting-import': 'video.stage.awaiting-import',
  'ready-to-start': 'video.stage.ready-to-start',
  'complete': 'video.stage.complete',
  'assemble': 'video.stage.assemble',
  'voiceover': 'video.stage.voiceover',
  'narration': 'video.stage.narration',
  'cut': 'video.stage.cut',
  'clip-plan': 'video.stage.clip-plan',
}

/** Locale key per preview role; roles are a closed host union. */
const PREVIEW_ROLE_KEYS: Readonly<Record<VideoPreviewAsset['role'], CreativeLocaleKey>> = {
  source: 'video.preview.role.source',
  edited: 'video.preview.role.edited',
  final: 'video.preview.role.final',
}

/** Locale key per known artifact filename; unknown files fall back to the host label. */
const ARTIFACT_LABEL_KEYS: Readonly<Record<string, CreativeLocaleKey>> = {
  'recap_run_manifest.json': 'video.artifact.recap_run_manifest.json',
  'recap_phase.json': 'video.artifact.recap_phase.json',
  'agent_narration_brief.md': 'video.artifact.agent_narration_brief.md',
  'recap_story_plan.json': 'video.artifact.recap_story_plan.json',
  'visual_audio_board.json': 'video.artifact.visual_audio_board.json',
  'clip_plan.json': 'video.artifact.clip_plan.json',
  'clip_plan_validated.json': 'video.artifact.clip_plan_validated.json',
  'narration.json': 'video.artifact.narration.json',
  'narration_review.md': 'video.artifact.narration_review.md',
  'timeline.json': 'video.artifact.timeline.json',
  'assembly_manifest.json': 'video.artifact.assembly_manifest.json',
  'assembly_qc.json': 'video.artifact.assembly_qc.json',
  'final_qc.json': 'video.artifact.final_qc.json',
  'final_qc.md': 'video.artifact.final_qc.md',
  'delivery_qc.json': 'video.artifact.delivery_qc.json',
  'subtitles.srt': 'video.artifact.subtitles.srt',
  'subtitles.ass': 'video.artifact.subtitles.ass',
}

const ARTIFACT_KIND_KEYS: Readonly<Record<VideoArtifactSummary['kind'], CreativeLocaleKey>> = {
  plan: 'video.artifactKind.plan',
  script: 'video.artifactKind.script',
  subtitle: 'video.artifactKind.subtitle',
  quality: 'video.artifactKind.quality',
  manifest: 'video.artifactKind.manifest',
}

type StudioProps = { readonly t: TranslateNS<typeof NS> }

function preferredPreview(project: VideoProject): VideoPreviewAsset | undefined {
  return project.previews.find(item => item.role === 'final')
    ?? project.previews.find(item => item.role === 'edited')
    ?? project.previews.find(item => item.role === 'source')
}

function readableBytes(bytes: number): string {
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_024 * 1_024 * 1_024) return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
  return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(2)} GB`
}

function ActionIcon({ name }: { readonly name: 'reload' | 'fullscreen' | 'external' }) {
  const paths = {
    reload: <><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></>,
    fullscreen: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>,
    external: <><path d="M14 3h7v7M21 3l-9 9"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  }
  return <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function preferredArtifact(project: VideoProject): VideoArtifactSummary | undefined {
  return project.artifacts.find(item => item.path.endsWith('final_qc.json'))
    ?? project.artifacts.find(item => item.path.endsWith('assembly_qc.json'))
    ?? project.artifacts.find(item => item.kind === 'quality')
    ?? project.artifacts.at(-1)
}

function artifactLabel(t: TranslateNS<typeof NS>, artifact: VideoArtifactSummary): string {
  const name = artifact.path.split('/').at(-1) ?? ''
  const key = ARTIFACT_LABEL_KEYS[name]
  return key === undefined ? artifact.label : t(key)
}

function stageLabel(t: TranslateNS<typeof NS>, project: VideoProject): string {
  const key = STAGE_KEYS[project.stage]
  return key === undefined ? project.stageLabel : t(key)
}

function VideoPreview({
  t,
  project,
  sessionId,
  running,
}: StudioProps & {
  readonly project: VideoProject
  readonly sessionId: string
  readonly running: boolean
}) {
  const shellRef = useRef<HTMLDivElement>(null)
  const initial = preferredPreview(project)
  const [role, setRole] = useState<VideoPreviewAsset['role'] | undefined>(initial?.role)
  const selected = project.previews.find(item => item.role === role) ?? preferredPreview(project)
  const [loaded, setLoaded] = useState(initial)
  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (loaded !== undefined || selected === undefined) return
    setLoaded(selected)
    setRole(selected.role)
  }, [loaded, selected])
  if (selected === undefined || loaded === undefined) return <div className="oh-video-preview-empty">
    <span aria-hidden>▶</span>
    <strong>{t('video.preview.empty.title')}</strong>
    <p>{t('video.preview.empty.a')} <code>{t('video.preview.empty.codePath')}</code>{t('video.preview.empty.b')} <code>{t('video.preview.empty.command')}</code>{t('video.preview.empty.c')}</p>
    <div className="oh-video-prompt-example"><span>{t('video.preview.example.label')}</span><q>{t('video.preview.example.prompt')}</q></div>
  </div>
  const pending = selected.path !== loaded.path || selected.version !== loaded.version
  const load = (asset: VideoPreviewAsset): void => {
    setRole(asset.role)
    setLoaded(asset)
    setReady(false)
    setError(false)
    setRevision(value => value + 1)
  }
  const runtimeState = error ? t('video.preview.state.error')
    : running ? t('video.preview.state.building')
      : pending ? t('video.preview.state.pending')
        : ready ? t('video.preview.state.loaded', { label: t(PREVIEW_ROLE_KEYS[loaded.role]), size: readableBytes(loaded.bytes) })
          : t('video.preview.state.loading')
  const mediaUrl = `${endpoint('media', sessionId, loaded.path)}&version=${encodeURIComponent(loaded.version)}&reload=${String(revision)}`
  return <div ref={shellRef} className="oh-video-preview-shell" data-state={error ? 'error' : running ? 'building' : ready ? 'ready' : 'loading'}>
    <div className="oh-video-stagebar">
      <div className="oh-video-version-tabs" role="tablist" aria-label={t('video.preview.versionTabs')}>
        {project.previews.map(asset => <button
          type="button"
          role="tab"
          key={asset.role}
          aria-selected={asset.role === selected.role}
          tabIndex={asset.role === selected.role ? 0 : -1}
          onKeyDown={(event) => { handleTabKey(event, project.previews.map(item => item.role), selected.role, (next) => {
            const asset = project.previews.find(item => item.role === next)
            if (asset !== undefined) load(asset)
          }) }}
          onClick={() => { load(asset) }}
        >{t(PREVIEW_ROLE_KEYS[asset.role])}</button>)}
      </div>
      <span className="oh-video-runtime-state" role="status" aria-live="polite"><i aria-hidden /><em>{runtimeState}</em></span>
      <div className="oh-video-preview-actions">
        {pending && <button type="button" onClick={() => { load(selected) }}>{t('video.preview.loadNew')}</button>}
        <button type="button" title={t('video.preview.reload')} aria-label={t('video.preview.reloadAria')} onClick={() => { load(loaded) }}><ActionIcon name="reload" /></button>
        <button type="button" title={t('video.preview.fullscreen')} aria-label={t('video.preview.fullscreenAria')} onClick={() => { void shellRef.current?.requestFullscreen() }}><ActionIcon name="fullscreen" /></button>
        <a href={mediaUrl} target="_blank" rel="noreferrer" title={t('video.preview.external')} aria-label={t('video.preview.externalAria')}><ActionIcon name="external" /></a>
      </div>
    </div>
    <div className="oh-video-player-stage">
      <video
        key={`${loaded.path}:${loaded.version}:${String(revision)}`}
        src={mediaUrl}
        controls
        preload="metadata"
        playsInline
        onLoadedMetadata={() => { setReady(true); setError(false) }}
        onError={() => { setError(true); setReady(false) }}
      />
    </div>
  </div>
}

function VideoArtifacts({ t, project, sessionId }: StudioProps & { readonly project: VideoProject; readonly sessionId: string }) {
  const [selected, setSelected] = useState(preferredArtifact(project)?.path)
  const [content, setContent] = useState<string>()
  const [error, setError] = useState<string>()
  const [preflight, setPreflight] = useState<VideoPreflight | 'failed'>()
  useEffect(() => { setSelected(preferredArtifact(project)?.path) }, [project.id])
  const selectedArtifact = project.artifacts.find(item => item.path === selected)
  const preferredPath = preferredArtifact(project)?.path
  useEffect(() => {
    if (selectedArtifact === undefined) setSelected(preferredPath)
  }, [preferredPath, selectedArtifact])
  useEffect(() => {
    if (selected === undefined) { setContent(undefined); return }
    const controller = new AbortController()
    setContent(undefined)
    setError(undefined)
    void fetch(endpoint('file', sessionId, selected), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as FilePayload & { readonly error?: string }
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${String(response.status)}`)
        if (!controller.signal.aborted) setContent(payload.content)
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { controller.abort() }
  }, [selected, selectedArtifact?.version, sessionId])
  return <div className="oh-video-artifacts">
    <aside aria-label={t('video.artifacts.aside')}>
      <div className="oh-video-artifacts-heading"><strong>{t('video.artifacts.heading')}</strong><span>{project.artifacts.length}</span></div>
      <div className="oh-video-environment">
        <strong>{t('video.artifacts.environment')}</strong>
        {typeof preflight === 'object' ? <>
          <span data-ready={preflight.python.ok || undefined}>{t('video.preflight.python')} {preflight.python.version ?? t('video.preflight.missing')}</span>
          <span data-ready={(preflight.ffmpeg.ok && preflight.ffmpeg.subtitles) || undefined}>{t('video.preflight.ffmpeg')} {preflight.ffmpeg.subtitles ? t('video.preflight.libass') : t('video.preflight.missingFilter')}</span>
          <span data-ready={preflight.ffprobe.ok || undefined}>{t('video.preflight.ffprobe')} {preflight.ffprobe.ok ? t('video.preflight.ok') : t('video.preflight.missing')}</span>
          <span data-ready={preflight.credentials.mimo || undefined}>{t('video.preflight.mimoKey')} {preflight.credentials.mimo ? t('video.preflight.configured') : t('video.preflight.notConfigured')}</span>
          {preflight.credentials.ttsProvider === 'fish'
            && <span data-ready={preflight.credentials.fish || undefined}>{t('video.preflight.fishKey')} {preflight.credentials.fish ? t('video.preflight.configured') : t('video.preflight.notConfigured')}</span>}
          <em>{t('video.preflight.note.a')} <code>{t('video.preflight.doctor')}</code> {t('video.preflight.note.b')}</em>
        </> : <button type="button" onClick={() => {
          void fetch(endpoint('video-preflight', sessionId)).then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
            setPreflight(await response.json() as VideoPreflight)
          }).catch(() => { setPreflight('failed') })
        }}>{preflight === 'failed' ? t('video.preflight.retry') : t('video.preflight.run')}</button>}
      </div>
      <nav>
        {project.artifacts.length === 0 && <p>{t('video.artifacts.emptyHint')}</p>}
        {project.artifacts.map(artifact => <button
          type="button"
          key={artifact.path}
          aria-current={artifact.path === selected ? 'page' : undefined}
          onClick={() => { setSelected(artifact.path) }}
        ><span>{artifactLabel(t, artifact)}</span><small>{artifact.path.split('/').at(-1)}</small></button>)}
      </nav>
    </aside>
    <section>
      {selectedArtifact !== undefined && <header className="oh-video-artifact-header">
        <div><strong>{artifactLabel(t, selectedArtifact)}</strong><span>{selectedArtifact.path.split('/').at(-1)}</span></div>
        <em>{t(ARTIFACT_KIND_KEYS[selectedArtifact.kind])}</em>
      </header>}
      <div className="oh-video-artifact-content">{project.artifacts.length === 0 ? <div className="oh-video-artifacts-empty">{t('video.artifacts.empty')}</div>
        : error !== undefined ? <div className="creative-error">{error}</div>
          : content === undefined ? <div className="oh-video-artifacts-empty">{t('video.artifacts.loading')}</div>
            : <pre>{content}</pre>}</div>
    </section>
  </div>
}

export function VideoStudio({
  t,
  sessionId,
  projects,
  running,
  projectId,
  tab,
  hidden,
  workbenches,
  onProject,
  onTab,
  onWorkbench,
}: StudioProps & {
  readonly sessionId: string
  readonly projects: readonly VideoProject[]
  readonly running: boolean
  readonly projectId: string | undefined
  readonly tab: 'preview' | 'artifacts'
  readonly hidden: boolean
  readonly workbenches: readonly WorkbenchMode[]
  readonly onProject: (id: string) => void
  readonly onTab: (tab: 'preview' | 'artifacts') => void
  readonly onWorkbench: (mode: WorkbenchMode) => void
}) {
  const project = projects.find(item => item.id === projectId) ?? projects[0]
  const tabsId = useId()
  useEffect(() => { if (project !== undefined && project.id !== projectId) onProject(project.id) }, [onProject, project, projectId])
  const studioTabOrder = ['preview', 'artifacts'] as const
  return <main className="oh-video-studio" hidden={hidden}>
    <header className="oh-video-toolbar">
      <div className="creative-workbench-cluster">
        <div className="oh-video-mode-tabs" role="tablist" aria-label={t('workbench.tablist')}>{workbenches.map(mode => <button
          type="button" role="tab" key={mode} aria-selected={mode === 'video'} tabIndex={mode === 'video' ? 0 : -1}
          onKeyDown={(event) => { handleTabKey(event, workbenches, 'video', onWorkbench) }} onClick={() => { onWorkbench(mode) }}
        >{t(WORKBENCH_LABEL_KEYS[mode])}</button>)}</div>
      </div>
      <label className="oh-video-project"><span>{t('video.project.label')}</span><select aria-label={t('video.project.label')} value={project?.id ?? ''} disabled={project === undefined} onChange={(event) => { onProject(event.target.value) }}>
        {projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      {project !== undefined && <span className="oh-video-stage" data-state={project.state}><i aria-hidden />{stageLabel(t, project)}</span>}
      <div className="oh-video-tabs" role="tablist" aria-label={t('video.tablist')}>{studioTabOrder.map(item => <button
        type="button" role="tab" key={item} id={`${tabsId}-${item}-tab`} aria-controls={`${tabsId}-${item}-panel`}
        aria-selected={tab === item} tabIndex={tab === item ? 0 : -1}
        onKeyDown={(event) => { handleTabKey(event, studioTabOrder, tab, onTab) }} onClick={() => { onTab(item) }}
      >{item === 'preview' ? t('video.tab.preview') : t('video.tab.artifacts')}</button>)}</div>
    </header>
    {project === undefined ? <div className="oh-video-preview-empty"><span aria-hidden>▶</span><strong>{t('video.empty.title')}</strong><p>{t('video.empty.a')} <code>{t('video.empty.codePath')}</code>{t('video.empty.b')}</p></div> : <div className="oh-video-panels">
      <div role="tabpanel" id={`${tabsId}-preview-panel`} aria-labelledby={`${tabsId}-preview-tab`} hidden={tab !== 'preview'}><VideoPreview key={project.id} t={t} project={project} sessionId={sessionId} running={running} /></div>
      <div role="tabpanel" id={`${tabsId}-artifacts-panel`} aria-labelledby={`${tabsId}-artifacts-tab`} hidden={tab !== 'artifacts'}><VideoArtifacts t={t} project={project} sessionId={sessionId} /></div>
    </div>}
  </main>
}
