import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { CreativeLocaleKey, NS } from './locales/index.ts'
import { productionCompleteness, type DramaDocumentTarget, type DramaEpisodeProduction, type DramaProductionSection } from './drama-production.js'
import { nativeBatchPrompt, nativeCompositionPrompt, nativeProductionPrompt } from './production-prompts.js'
import { createProductionRequest, queuedItemForRequest, reconcileSequence, referencesForTarget, reorderSequence, sequenceIssues, selectedVersionForTarget, type CanvasPoint, type ProductionRequest, type ProductionJobView, type ProductionMediaVersion, type ProductionQueueEntry, type ProductionSequenceItem } from './production-runtime.js'
import { ProductionRequestId, type ProductionBinding } from '../production-binding.ts'

interface Props {
  readonly t: TranslateNS<typeof NS>
  readonly production: DramaEpisodeProduction
  readonly queue: readonly ProductionQueueEntry[]
  readonly section: DramaProductionSection
  readonly selectedId: string | undefined
  readonly requests: readonly ProductionRequest[]
  readonly jobViews: readonly ProductionJobView[]
  readonly versions: readonly ProductionMediaVersion[]
  readonly libraryVersions: readonly ProductionMediaVersion[]
  readonly selections: Readonly<Record<string, string>>
  readonly manualReferences: Readonly<Record<string, readonly string[]>>
  readonly sequence: readonly ProductionSequenceItem[]
  readonly canvas: Readonly<Record<string, CanvasPoint>>
  readonly zoom: number
  readonly onSectionChange: (section: DramaProductionSection) => void
  readonly onSelect: (id: string | undefined) => void
  readonly onNavigate: (target: DramaDocumentTarget) => void
  readonly onRequestsChange: (requests: ProductionRequest[]) => void
  readonly onSelectionsChange: (selections: Record<string, string>) => void
  readonly onManualReferencesChange: (references: Record<string, string[]>) => void
  readonly onOpenMedia: (path: string) => void
  readonly onSequenceChange: (sequence: ProductionSequenceItem[]) => void
  readonly onCanvasChange: (canvas: Record<string, CanvasPoint>) => void
  readonly onZoomChange: (zoom: number) => void
  readonly onBeginSubmission: (prompt: string) => SessionRequestId
  readonly onDispatchPrompt: (prompt: string, requestId: SessionRequestId) => Promise<void>
  readonly onStopJob: (job: ProductionBinding['job']) => Promise<void>
  readonly onRemoveQueued: (itemId: ProductionQueueEntry['id']) => Promise<void>
  readonly onRefresh: () => void
}

const SECTION_KEYS: Readonly<Record<DramaProductionSection, CreativeLocaleKey>> = {
  shots: 'drama.section.shots', assets: 'drama.section.assets', tasks: 'drama.section.tasks', sequence: 'drama.section.sequence', canvas: 'drama.section.canvas',
} as const satisfies Record<DramaProductionSection, CreativeLocaleKey>
const SECTION_ORDER = Object.keys(SECTION_KEYS) as DramaProductionSection[]
const STATUS_KEYS = {
  running: 'drama.status.running', stopping: 'drama.status.stopping', completed: 'drama.status.completed', failed: 'drama.status.failed', killed: 'drama.status.killed', loading: 'drama.status.loading', unavailable: 'drama.status.unavailable',
} as const satisfies Record<ProductionJobView['status'], CreativeLocaleKey>
const ASSET_KIND_KEYS = {
  character: 'drama.assetKind.character', scene: 'drama.assetKind.scene', prop: 'drama.assetKind.prop', state: 'drama.assetKind.state', unknown: 'drama.assetKind.unknown',
} as const satisfies Record<keyof typeof ASSET_GLYPHS, CreativeLocaleKey>
const ASSET_GLYPHS = { character: '人', scene: '景', prop: '物', state: '状', unknown: '设' } as const
const JOB_KIND_KEYS = {
  image: 'drama.jobKind.image', video: 'drama.jobKind.video', composition: 'drama.jobKind.composition',
} as const satisfies Record<ProductionRequest['kind'], CreativeLocaleKey>

function handleSectionKey(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: DramaProductionSection,
  onChange: (section: DramaProductionSection) => void,
): void {
  const index = SECTION_ORDER.indexOf(current)
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? SECTION_ORDER.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % SECTION_ORDER.length
        : event.key === 'ArrowLeft' ? (index - 1 + SECTION_ORDER.length) % SECTION_ORDER.length
          : undefined
  if (next === undefined) return
  event.preventDefault()
  const section = SECTION_ORDER[next]
  if (section === undefined) return
  onChange(section)
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus()
}

export function DramaProductionView(props: Props) {
  const [notice, setNotice] = useState<string>()
  const protocolErrors = props.production.diagnostics.filter(item => item.severity === 'error').length
  const requestsRef = useRef(props.requests)
  const commitRequests = useCallback((next: ProductionRequest[]) => {
    requestsRef.current = next
    props.onRequestsChange(next)
  }, [props.onRequestsChange])
  useEffect(() => { requestsRef.current = props.requests }, [props.requests])

  useEffect(() => {
    const next = reconcileSequence(props.production.shots.map(shot => shot.id), props.sequence, props.versions, props.selections)
    if (JSON.stringify(next) !== JSON.stringify(props.sequence)) props.onSequenceChange(next)
  }, [props.production.shots, props.selections, props.sequence, props.versions])

  const submitRequest = async (request: ProductionRequest, prompt: string, notice: string) => {
    props.onSectionChange('tasks')
    let submitted = request
    try {
      const submissionId = props.onBeginSubmission(prompt)
      submitted = { ...request, submissionId }
      commitRequests([...requestsRef.current, submitted])
      await props.onDispatchPrompt(prompt, submissionId)
      setNotice(notice)
    } catch (error) {
      const failed = { ...submitted, submissionError: error instanceof Error ? error.message : String(error) }
      commitRequests([...requestsRef.current.filter(item => item.id !== request.id), failed])
    }
  }

  const createJob = async (targetId: string, kind: 'image' | 'video', prompt: string) => {
    if (prompt.trim() === '') { setNotice(props.t('drama.notice.noPrompt', { targetId })); return }
    const request = createProductionRequest({
      id: ProductionRequestId(randomUUID()), episode: props.production.episodeDirectory, targetId, kind, prompt,
    })
    const references = kind === 'video' ? referencesForTarget(targetId, props.production, props.versions, props.selections, props.libraryVersions, props.manualReferences) : []
    await submitRequest(request, nativeProductionPrompt(props.production, request, references), props.t('drama.notice.prepare', { targetId }))
  }

  const createBatch = async (kind: 'image' | 'video') => {
    const candidates = props.production.shots.flatMap((shot) => {
      const prompt = kind === 'image' ? shot.keyframePrompt : shot.motion?.prompt
      return prompt === undefined ? [] : [{ id: shot.id, prompt }]
    })
    if (candidates.length === 0) {
      setNotice(kind === 'image' ? props.t('drama.notice.noKeyframePrompt') : props.t('drama.notice.noVideoPrompt'))
      return
    }
    const batchTarget = kind === 'image' ? 'BATCH-KEYFRAMES' : 'BATCH-VIDEOS'
    const batchPrompt = candidates.map(item => `${item.id}\n${item.prompt}`).join('\n\n')
    const request = createProductionRequest({
      id: ProductionRequestId(randomUUID()), episode: props.production.episodeDirectory, targetId: batchTarget,
      kind, prompt: batchPrompt, expectedOutputs: candidates.length,
    })
    await submitRequest(request, nativeBatchPrompt(props.production, request, candidates), props.t('drama.notice.batch', { count: String(candidates.length) }))
  }

  const dispatchComposition = async (request: ProductionRequest) => {
    const versionById = new Map(props.versions.map(version => [version.id, version]))
    const ordered = props.sequence.flatMap((item) => {
      const version = item.versionId === undefined ? undefined : versionById.get(item.versionId)
      return version === undefined ? [] : [version.path ?? version.url]
    })
    await submitRequest(request, nativeCompositionPrompt(props.production, request, ordered), props.t('drama.notice.composition'))
  }

  const stopJob = async (job: ProductionBinding['job']) => {
    try {
      await props.onStopJob(job)
      setNotice(props.t('drama.notice.cancelRequested'))
    }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  }
  const removeQueuedRequest = async (request: ProductionRequest, itemId: ProductionQueueEntry['id']) => {
    try {
      await props.onRemoveQueued(itemId)
      commitRequests(requestsRef.current.map(item => item.id === request.id
        ? { ...item, withdrawn: true }
        : item))
      setNotice(props.t('drama.notice.removed', { targetId: request.targetId }))
    }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  }
  const composeSequence = () => {
    const issues = sequenceIssues(props.sequence, props.versions)
    if (issues.length > 0) { setNotice(issues[0]); return }
    const job = createProductionRequest({ id: ProductionRequestId(randomUUID()), episode: props.production.episodeDirectory, targetId: props.production.episodeDirectory, kind: 'composition', prompt: props.t('drama.composition.prompt') })
    void dispatchComposition(job)
  }

  return <div className="creative-production">
    <div className="creative-production-bar"><div className="creative-production-tabs" role="tablist" aria-label={props.t('drama.tablist')}>{SECTION_ORDER.map(item => <button type="button" role="tab" tabIndex={props.section === item ? 0 : -1} aria-selected={props.section === item} key={item} onKeyDown={(event) => { handleSectionKey(event, item, props.onSectionChange) }} onClick={() => { props.onSectionChange(item) }}>{props.t(SECTION_KEYS[item])}</button>)}</div><div className="creative-production-meta"><span className="creative-production-summary">{props.t('drama.summary', { shots: String(props.production.shots.length), assets: String(props.production.assets.length + props.production.visualAssets.length), tasks: String(props.requests.length) })}</span><button type="button" onClick={props.onRefresh}>{props.t('workbench.reload')}</button></div></div>
    {notice !== undefined && <div className="creative-production-notice" role="status"><span>{notice}</span><button type="button" aria-label={props.t('drama.notice.close')} onClick={() => { setNotice(undefined) }}>×</button></div>}
    {props.production.diagnostics.length > 0 && <details className="creative-production-diagnostics"><summary>{protocolErrors > 0 ? props.t('drama.diagnostics.errors', { count: String(protocolErrors) }) : props.t('drama.diagnostics.warnings', { count: String(props.production.diagnostics.length) })}</summary><ul>{props.production.diagnostics.slice(0, 8).map(item => <li data-severity={item.severity} key={`${item.path}:${String(item.offset)}:${item.code}`}><button type="button" onClick={() => { props.onNavigate({ path: item.path, offset: item.offset, id: item.targetId ?? item.code }) }}>{item.path.split('/').at(-1)}:{item.line}</button><span>{props.t(item.messageKey, item.params)}</span></li>)}</ul>{props.production.diagnostics.length > 8 && <p>{props.t('drama.diagnostics.more', { count: String(props.production.diagnostics.length - 8) })}</p>}</details>}
    {props.section === 'shots' && <ShotBoard {...props} onCreateJob={createJob} onBatch={createBatch} />}
    {props.section === 'assets' && <AssetBoard {...props} onCreateJob={createJob} />}
    {props.section === 'tasks' && <TaskBoard t={props.t} requests={props.requests} jobViews={props.jobViews} queue={props.queue} onStop={stopJob} onRemoveQueued={removeQueuedRequest} />}
    {props.section === 'sequence' && <SequenceBoard {...props} onCompose={composeSequence} />}
    {props.section === 'canvas' && <ProductionCanvas {...props} />}
  </div>
}

function ShotBoard(props: Props & { readonly onCreateJob: (targetId: string, kind: 'image' | 'video', prompt: string) => Promise<void>; readonly onBatch: (kind: 'image' | 'video') => Promise<void> }) {
  const selectedRef = useScrollIntoView(props.selectedId)
  if (props.production.shots.length === 0) return <section className="creative-shot-board"><MissingDocument t={props.t} document={`${props.production.episodeDirectory}/分镜.md`} documentPaths={props.production.documentPaths} whatKey="drama.what.shots" skill="/short-drama-storyboard" onNavigate={props.onNavigate} /></section>
  return <section className="creative-shot-board"><div className="creative-production-actions"><button type="button" onClick={() => { void props.onBatch('image') }}>{props.t('drama.batch.keyframes')}</button><button type="button" onClick={() => { void props.onBatch('video') }}>{props.t('drama.batch.videos')}</button></div><div className="creative-shot-grid">{props.production.shots.map((shot) => {
    const completeness = productionCompleteness(shot); const versions = props.versions.filter(version => version.targetId === shot.id); const selected = selectedVersionForTarget(shot.id, props.versions, props.selections, 'image') ?? selectedVersionForTarget(shot.id, props.versions, props.selections, 'video'); const duration = shot.durationSeconds === undefined ? '—' : `${String(shot.durationSeconds)}s`
    return <article className="creative-shot-card" role="button" tabIndex={0} aria-pressed={props.selectedId === shot.id} aria-label={props.t('drama.shot.selectAria', { id: shot.id, title: shot.title })} ref={props.selectedId === shot.id ? selectedRef : undefined} data-selected={props.selectedId === shot.id || undefined} key={shot.id} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelect(shot.id) } }} onClick={() => { props.onSelect(shot.id) }}>
      {selected === undefined ? <div className="creative-shot-placeholder"><strong>{shot.id.split('-').at(-1)}</strong><span>{props.t('drama.shot.awaitingKeyframe')}</span></div> : <MediaPreview version={selected} />}<header><button type="button" onClick={(event) => { event.stopPropagation(); props.onNavigate({ path: shot.path, offset: shot.offset, id: shot.id }) }}>{shot.id}</button><span>{duration}</span></header><h3>{shot.title}</h3>{shot.shotSpec !== undefined && <p>{shot.shotSpec}</p>}<dl><dt>{props.t('drama.shot.start')}</dt><dd>{shot.start ?? props.t('drama.shot.unset')}</dd><dt>{props.t('drama.shot.end')}</dt><dd>{shot.end ?? props.t('drama.shot.unset')}</dd></dl>
      <div className="creative-shot-status"><ReadinessBadge t={props.t} labelKey="drama.badge.keyframe" ready={completeness.keyframe} /><ReadinessBadge t={props.t} labelKey="drama.badge.motion" ready={completeness.motion} /><ReadinessBadge t={props.t} labelKey="drama.badge.reference" ready={completeness.references} /><span>{props.t('drama.shot.versions', { count: String(versions.length) })}</span></div><div className="creative-reference-links">{shot.source !== undefined && <ReferenceButton id={shot.source} production={props.production} onNavigate={props.onNavigate} />}{shot.references.map(id => <ReferenceButton id={id} production={props.production} onNavigate={props.onNavigate} key={id} />)}</div>
      <div className="creative-card-actions">{shot.keyframePrompt !== undefined && <button type="button" onClick={(event) => { event.stopPropagation(); void props.onCreateJob(shot.id, 'image', shot.keyframePrompt ?? '') }}>{props.t('drama.shot.prepareKeyframe')}</button>}{shot.motion?.prompt !== undefined && <button type="button" onClick={(event) => { event.stopPropagation(); void props.onCreateJob(shot.id, 'video', shot.motion?.prompt ?? '') }}>{props.t('drama.shot.prepareVideo')}</button>}</div>{versions.length > 1 && <VersionStrip t={props.t} targetId={shot.id} versions={versions} selections={props.selections} onSelectionsChange={props.onSelectionsChange} />}
    </article>
  })}</div></section>
}

function AssetBoard(props: Props & { readonly onCreateJob: (targetId: string, kind: 'image' | 'video', prompt: string) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'image' | 'video'>('all')
  const assets = [
    ...props.production.assets,
    ...props.production.visualAssets.filter(visual =>
      !props.production.assets.some(asset => asset.title === visual.title)),
  ]
  const needle = query.trim().toLocaleLowerCase()
  const library = props.libraryVersions.filter(version => (kind === 'all' || version.kind === kind) && (needle === '' || `${version.targetId} ${version.path ?? ''}`.toLocaleLowerCase().includes(needle)))
  const selectedRef = useScrollIntoView(props.selectedId)
  const referenceTarget = props.selectedId?.startsWith('SHOT-') === true ? props.selectedId : undefined
  const toggleReference = (versionId: string) => {
    if (referenceTarget === undefined) return
    const current = props.manualReferences[referenceTarget] ?? []
    const next = current.includes(versionId) ? current.filter(id => id !== versionId) : [...current, versionId]
    const mutable = Object.fromEntries(Object.entries(props.manualReferences).map(([target, ids]) => [target, [...ids]]))
    props.onManualReferencesChange({ ...mutable, [referenceTarget]: next })
  }
  if (assets.length === 0 && props.libraryVersions.length === 0) return <section className="creative-assets"><MissingDocument t={props.t} document={`${props.production.episodeDirectory}/图片提示词.md`} documentPaths={props.production.documentPaths} whatKey="drama.what.assets" skill="/short-drama-image-prompts" onNavigate={props.onNavigate} /></section>
  return <section className="creative-assets"><div className="creative-asset-grid">{assets.map((asset) => { const prompt = 'prompt' in asset ? asset.prompt : asset.description; const versions = props.versions.filter(version => version.targetId === asset.id); const selected = selectedVersionForTarget(asset.id, props.versions, props.selections, 'image'); return <article className="creative-asset-card" ref={props.selectedId === asset.id ? selectedRef : undefined} data-selected={props.selectedId === asset.id || undefined} key={asset.id}>{selected === undefined ? <div className="creative-asset-placeholder">{ASSET_GLYPHS[asset.kind]}</div> : <MediaPreview version={selected} />}<div><small>{props.t(ASSET_KIND_KEYS[asset.kind])}</small><h3>{asset.title}</h3><button type="button" onClick={() => { props.onNavigate({ path: asset.path, offset: asset.offset, id: asset.id }) }}>{asset.id}</button></div>{prompt !== undefined && <p className="creative-asset-description">{prompt}</p>}<div className="creative-card-actions">{prompt !== undefined && <button type="button" onClick={() => { void props.onCreateJob(asset.id, 'image', prompt) }}>{props.t('drama.asset.prepare')}</button>}</div>{versions.length > 0 && <VersionStrip t={props.t} targetId={asset.id} versions={versions} selections={props.selections} onSelectionsChange={props.onSelectionsChange} />}</article> })}</div><div className="creative-media-library"><header><div><strong>{props.t('drama.library.title')}</strong><span>{props.t('drama.library.count', { count: String(library.length), total: String(props.libraryVersions.length) })}</span></div><div><input aria-label={props.t('drama.library.searchAria')} value={query} placeholder={props.t('drama.library.searchPlaceholder')} onChange={(event) => { setQuery(event.target.value) }} /><select aria-label={props.t('drama.library.filterAria')} value={kind} onChange={(event) => { setKind(event.target.value as typeof kind) }}><option value="all">{props.t('drama.library.all')}</option><option value="image">{props.t('drama.library.image')}</option><option value="video">{props.t('drama.library.video')}</option></select></div></header>{referenceTarget === undefined && <p className="creative-projection-note">{props.t('drama.library.pickShotFirst')}</p>}<div className="creative-media-library-grid">{library.map((version) => { const selected = referenceTarget !== undefined && (props.manualReferences[referenceTarget] ?? []).includes(version.id); return <article key={version.id}><MediaPreview version={version} /><strong>{version.targetId}</strong><span title={version.path}>{version.path}</span><footer>{version.path !== undefined && <button type="button" onClick={() => { props.onOpenMedia(version.path ?? '') }}>{props.t('drama.library.openFile')}</button>}{referenceTarget !== undefined && version.kind === 'image' && <button type="button" aria-pressed={selected} aria-label={props.t('drama.library.referenceAria', { action: selected ? props.t('drama.library.referenceRemove') : props.t('drama.library.referenceAdd'), target: referenceTarget, id: version.targetId })} onClick={() => { toggleReference(version.id) }}>{selected ? props.t('drama.library.referenced') : props.t('drama.library.useAsReference')}</button>}</footer></article> })}</div></div></section>
}

function TaskBoard({ t, requests, jobViews, queue, onStop, onRemoveQueued }: {
  readonly t: TranslateNS<typeof NS>
  readonly requests: readonly ProductionRequest[]
  readonly jobViews: readonly ProductionJobView[]
  readonly queue: readonly ProductionQueueEntry[]
  readonly onStop: (job: ProductionBinding['job']) => Promise<void>
  readonly onRemoveQueued: (request: ProductionRequest, itemId: ProductionQueueEntry['id']) => Promise<void>
}) {
  return <section className="creative-task-board">
    <div className="creative-projection-note">{t('drama.tasks.note')}</div>
    {requests.length === 0 ? <div className="creative-production-empty">{t('drama.tasks.empty')}</div> : [...requests].reverse().map((request) => {
      const queued = queuedItemForRequest(request, queue)
      const jobs = jobViews.filter(job => job.binding.requestId === request.id && job.binding.episode === request.episode)
      const ended = jobs.filter(job => job.status === 'completed' || job.status === 'failed' || job.status === 'killed').length
      const preparation = request.legacy === true ? t('drama.status.historical')
        : request.submissionError !== undefined ? t('drama.status.submissionFailed')
          : request.withdrawn === true ? t('drama.status.withdrawn')
            : queued !== undefined ? t('drama.status.queued') : t('drama.status.awaitingConfirmation')
      return <article key={request.id} data-request-id={request.id}>
        <header>
          <strong title={request.targetId}>{request.targetId}</strong><span>{t(JOB_KIND_KEYS[request.kind])}</span>
          {jobs.length === 0 && <span>{preparation}</span>}
        </header>
        <details><summary>{t('drama.tasks.viewPrompt')}</summary><p>{request.prompt}</p></details>
        <small>{t('drama.tasks.planned', { expected: String(request.expectedOutputs) })}</small>
        {request.submissionError !== undefined && <div className="creative-error">{request.submissionError}</div>}
        {jobs.length > 0 && <p>{t('drama.tasks.registered', { ended: String(ended), registered: String(jobs.length) })}</p>}
        {jobs.map(job => <div className="creative-task-job" key={`${job.binding.job.jobId}:${String(job.binding.job.startedAt)}`} data-job-id={job.binding.job.jobId} data-status={job.status}>
          <strong>{job.binding.targetId}</strong><code>{job.binding.job.jobId}</code><span>{t(STATUS_KEYS[job.status])}</span>
          {job.detail !== undefined && <small>{job.detail}</small>}
          {job.status === 'running' && <button type="button" onClick={() => { void onStop(job.binding.job) }}>{t('drama.tasks.stopJob')}</button>}
        </div>)}
        <footer>{queued !== undefined && <button type="button" onClick={() => { void onRemoveQueued(request, queued.id) }}>{t('drama.tasks.removeFromQueue')}</button>}</footer>
      </article>
    })}
  </section>
}

function SequenceBoard(props: Props & { readonly onCompose: () => void }) {
  const issues = sequenceIssues(props.sequence, props.versions)
  const versionById = new Map(props.versions.map(version => [version.id, version]))
  const move = (index: number, delta: number) => {
    const source = props.sequence[index]
    const target = props.sequence[index + delta]
    if (source !== undefined && target !== undefined)
      props.onSequenceChange(reorderSequence(props.sequence, index, index + delta))
  }
  return <section className="creative-sequence">
    <div className="creative-sequence-summary">
      <strong>{props.t('drama.sequence.count', { count: String(props.sequence.length) })}</strong>
      <span>{props.sequence.length === 0 ? props.t('drama.sequence.none') : issues.length === 0 ? props.t('drama.sequence.ready') : props.t('drama.sequence.blocked', { count: String(issues.length) })}</span>
      <button type="button" disabled={issues.length > 0 || props.sequence.length < 2} onClick={props.onCompose}>{props.t('drama.sequence.compose')}</button>
    </div>
    {issues.length > 0 && <ul className="creative-sequence-issues">
      {issues.slice(0, 3).map(issue => <li key={issue}>{issue}</li>)}
      {issues.length > 3 && <li>{props.t('drama.sequence.moreBlocked', { count: String(issues.length - 3) })}</li>}
    </ul>}
    <ol>{props.sequence.map((item, index) => {
      const version = item.versionId === undefined ? undefined : versionById.get(item.versionId)
      return <li key={item.shotId}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        {version === undefined
          ? <div className="creative-sequence-missing">{props.t('drama.sequence.missingVideo')}</div>
          : <MediaPreview version={version} interactive={false} />}
        <strong>{item.shotId}</strong>
        <div>
          <button type="button" aria-label={props.t('drama.sequence.moveUp', { id: item.shotId })} disabled={index === 0} onClick={() => { move(index, -1) }}>↑</button>
          <button type="button" aria-label={props.t('drama.sequence.moveDown', { id: item.shotId })} disabled={index === props.sequence.length - 1} onClick={() => { move(index, 1) }}>↓</button>
        </div>
      </li>
    })}</ol>
  </section>
}

function ProductionCanvas(props: Props) {
  const nodes = useMemo(() => { const sourceAssets = [...props.production.assets, ...props.production.visualAssets]; const assets = sourceAssets.map((asset, index) => ({ id: asset.id, label: asset.title, type: 'asset', initial: { x: 80, y: 80 + index * 150 } })); const shots = props.production.shots.map((shot, index) => ({ id: shot.id, label: shot.title, type: 'shot', initial: { x: 640, y: 80 + index * 180 } })); return [...assets, ...shots] }, [props.production.assets, props.production.shots, props.production.visualAssets])
  const positions = Object.fromEntries(nodes.map(node => [node.id, props.canvas[node.id] ?? node.initial]))
  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => { event.currentTarget.setPointerCapture(event.pointerId); const origin = positions[id] ?? { x: 0, y: 0 }; const start = { x: event.clientX, y: event.clientY }; const move = (moveEvent: PointerEvent) => { props.onCanvasChange({ ...props.canvas, [id]: { x: origin.x + (moveEvent.clientX - start.x) / props.zoom, y: origin.y + (moveEvent.clientY - start.y) / props.zoom } }) }; const end = () => { globalThis.removeEventListener('pointermove', move); globalThis.removeEventListener('pointerup', end) }; globalThis.addEventListener('pointermove', move); globalThis.addEventListener('pointerup', end) }
  const moveNode = (id: string, x: number, y: number) => {
    const origin = positions[id] ?? { x: 0, y: 0 }
    props.onCanvasChange({ ...props.canvas, [id]: { x: origin.x + x, y: origin.y + y } })
  }
  const connections = props.production.shots.flatMap(shot => shot.references.map(reference => [reference, shot.id] as const))
  if (nodes.length === 0) return <section className="creative-canvas-shell" aria-label={props.t('drama.canvas.aria')}><MissingDocument t={props.t} document={`${props.production.episodeDirectory}/分镜.md`} documentPaths={props.production.documentPaths} whatKey="drama.what.relation" skill="/short-drama-storyboard" onNavigate={props.onNavigate} /></section>
  return <section className="creative-canvas-shell" aria-label={props.t('drama.canvas.aria')}><div className="creative-projection-note">{props.t('drama.canvas.note')}</div><div className="creative-canvas-controls"><button type="button" aria-label={props.t('drama.canvas.zoomOut')} onClick={() => { props.onZoomChange(Math.max(.5, props.zoom - .1)) }}>−</button><span>{Math.round(props.zoom * 100)}%</span><button type="button" aria-label={props.t('drama.canvas.zoomIn')} onClick={() => { props.onZoomChange(Math.min(1.8, props.zoom + .1)) }}>＋</button><button type="button" onClick={() => { props.onCanvasChange({}); props.onZoomChange(.65) }}>{props.t('drama.canvas.reset')}</button></div><div className="creative-canvas-viewport"><div className="creative-canvas" style={{ transform: `scale(${String(props.zoom)})` }}><svg aria-hidden="true">{connections.map(([from, to]) => { const a = positions[from]; const b = positions[to]; if (a === undefined || b === undefined) return null; return <path key={`${from}:${to}`} data-active={to === props.selectedId || undefined} d={`M ${String(a.x + 180)} ${String(a.y + 50)} C ${String(a.x + 360)} ${String(a.y + 50)}, ${String(b.x - 180)} ${String(b.y + 50)}, ${String(b.x)} ${String(b.y + 50)}`} /> })}</svg>{nodes.map(node => <article key={node.id} tabIndex={0} aria-label={`${props.t(node.type === 'asset' ? 'drama.canvas.asset' : 'drama.canvas.shot')} ${node.label}`} data-node-type={node.type} data-selected={node.id === props.selectedId || undefined} style={{ left: positions[node.id]?.x, top: positions[node.id]?.y }} onKeyDown={(event) => { const step = event.shiftKey ? 40 : 10; const delta: readonly [number, number] | undefined = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowUp' ? [0, -step] : event.key === 'ArrowDown' ? [0, step] : undefined; if (delta !== undefined) { event.preventDefault(); moveNode(node.id, delta[0], delta[1]) } }} onPointerDown={(event) => { startDrag(event, node.id) }} onDoubleClick={() => { const target = props.production.targets.get(node.id); if (target !== undefined) props.onNavigate(target) }}><small>{props.t(node.type === 'asset' ? 'drama.canvas.asset' : 'drama.canvas.shot')}</small><strong>{node.label}</strong><span>{node.id}</span></article>)}</div></div></section>
}

/** Scroll the card an Agent focus_target selected into view; without it the tab switches but the card stays off-screen. */
function useScrollIntoView(selectedId: string | undefined) {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }) }, [selectedId])
  return ref
}

function ReadinessBadge({ t, labelKey, ready }: {
  readonly t: TranslateNS<typeof NS>
  readonly labelKey: CreativeLocaleKey
  readonly ready: boolean
}) {
  const label = t(labelKey)
  return <span data-ready={ready} aria-label={`${label}${ready ? t('drama.badge.ready') : t('drama.badge.pending')}`}><i aria-hidden="true">{ready ? '✓' : '—'}</i>{label}</span>
}

function MissingDocument({ t, document, documentPaths, whatKey, skill, onNavigate }: {
  readonly t: TranslateNS<typeof NS>
  readonly document: string
  readonly documentPaths: readonly string[]
  readonly whatKey: CreativeLocaleKey
  readonly skill: string
  readonly onNavigate: (target: DramaDocumentTarget) => void
}) {
  const present = documentPaths.includes(document)
  return <div className="creative-production-empty">
    <strong>{t('drama.missing.title', { what: t(whatKey) })}</strong>
    <p>{present
      ? t('drama.missing.present', { document })
      : t('drama.missing.absent', { document, skill })}</p>
    {present && <button type="button" onClick={() => { onNavigate({ path: document, offset: 0, id: document }) }}>{t('drama.missing.open', { name: document.split('/').at(-1) ?? document })}</button>}
  </div>
}

function ReferenceButton({ id, production, onNavigate }: { readonly id: string; readonly production: DramaEpisodeProduction; readonly onNavigate: (target: DramaDocumentTarget) => void }) { const target = production.targets.get(id); return <button type="button" disabled={target === undefined} onClick={(event) => { event.stopPropagation(); if (target !== undefined) onNavigate(target) }}>{id}</button> }
function MediaPreview({ version, interactive = true }: { readonly version: ProductionMediaVersion; readonly interactive?: boolean }) { return version.kind === 'image' ? <img className="creative-media-preview" src={version.url} alt={version.targetId} loading="lazy" /> : <video className="creative-media-preview" src={version.url} controls={interactive} muted={!interactive} preload="metadata" /> }
function VersionStrip({ t, targetId, versions, selections, onSelectionsChange }: { readonly t: TranslateNS<typeof NS>; readonly targetId: string; readonly versions: readonly ProductionMediaVersion[]; readonly selections: Readonly<Record<string, string>>; readonly onSelectionsChange: (value: Record<string, string>) => void }) { const selected = selectedVersionForTarget(targetId, versions, selections)?.id; return <div className="creative-version-strip" aria-label={t('drama.version.aria', { targetId })}>{versions.map((version, index) => <button type="button" aria-pressed={version.id === selected} aria-label={t('drama.version.selectAria', { targetId, index: String(index + 1) })} data-selected={version.id === selected || undefined} key={version.id} onClick={(event) => { event.stopPropagation(); onSelectionsChange({ ...selections, [targetId]: version.id }) }}><MediaPreview version={version} interactive={false} /><span>{t('drama.version.short', { index: String(index + 1) })}</span></button>)}</div> }
