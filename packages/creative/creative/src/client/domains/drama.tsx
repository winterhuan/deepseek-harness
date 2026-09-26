/** Drama domain: short-drama documents in the shared editor plus the episode production board. */
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import { useCallback, useEffect, useMemo } from 'react'
import {
  creatorDocumentPaths,
  episodeDirectoryForPath,
  isCreatorDocumentPath,
  parseEpisodeProduction,
  type DramaEpisodeProduction,
} from '../drama-production.js'
import type { DramaProductionViewProps } from '../drama-production-view.js'
import type { FileBuffer } from '../editor-buffer.ts'
import { productionBindingsForEpisode, productionRequestsForEpisode, type SettledProductionIntent } from '../production-intents.js'
import {
  type CanvasPoint, mediaTargetFromPath, productionJobView,
  type ProductionRequest, type ProductionMediaVersion, type ProductionSequenceItem,
} from '../production-runtime.js'
import { parseCreativePath } from '../../project-path.ts'
import { endpoint } from '../workbench-ui.js'
import type { WorkspacePayload } from '../workspace-client.ts'
import type { EditorDomain, WorkbenchStoreProps } from './types.ts'

/** The short-drama workbench domain. */
export const dramaDomain: EditorDomain<'drama'> = {
  mode: 'drama',
  surface: 'editor',
  groupOrder: ['项目', '输入', '项目开发', '设定集', '剧集', '审查', '创作者决策', '交付'],
  treeLabelKey: 'tree.drama.files',
  Empty: ({ t }) => <>{t('editor.empty.drama.prefix')} <code>{t('editor.empty.drama.command')}</code>{t('editor.empty.drama.suffix')}</>,
}

/** Episode documents a production `open_section` or `focus_target` result opens, in preference order. */
const PRODUCTION_DOCUMENTS = ['分镜.md', '图片提示词.md', '视觉设定.md', '剧本.md', '视频提示词.md']

/** Board props derived from the selected episode and persisted board state. */
export type DramaBoardProps = Pick<DramaProductionViewProps,
  | 'production' | 'section' | 'selectedId' | 'requests' | 'jobViews' | 'versions' | 'libraryVersions'
  | 'selections' | 'manualReferences' | 'sequence' | 'canvas' | 'zoom'
  | 'onSectionChange' | 'onSelect' | 'onRequestsChange' | 'onSelectionsChange' | 'onManualReferencesChange'
  | 'onSequenceChange' | 'onCanvasChange' | 'onZoomChange'
>

/** Production state of the selected drama document. */
export interface DramaProduction {
  /** The selected document is a creator document inside an episode, so the production editor mode applies. */
  readonly available: boolean
  /** Creator documents of the selected episode; the shell reads them so the board can parse them. */
  readonly documentPaths: readonly string[]
  /** Board props, or `undefined` until the episode documents parse. */
  readonly board: DramaBoardProps | undefined
}

/** Inputs of {@link useDramaProduction}. */
export interface DramaProductionOptions extends WorkbenchStoreProps {
  readonly sessionId: string
  readonly workspace: WorkspacePayload | undefined
  readonly selected: string | undefined
  readonly buffers: Readonly<Record<string, FileBuffer>>
  readonly productionIntents: readonly SettledProductionIntent[]
  readonly liveJobs: readonly JobView[]
  readonly jobsReady: boolean
  /**
   * Select `path` in the drama workbench and switch the editor to production mode.
   * @param path - the episode document to open.
   */
  readonly openProductionDocument: (path: string) => void
}

/**
 * Derive the production board for the selected episode and apply new production tool results.
 * @param options - the selection, workspace, loaded buffers, production intents, and store.
 * @returns the production availability, episode documents, and board props.
 */
export function useDramaProduction({
  sessionId, workspace, selected, buffers, productionIntents, liveJobs, jobsReady, useStore, actions, openProductionDocument,
}: DramaProductionOptions): DramaProduction {
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
  const episodeDirectory = episodeDirectoryForPath(selected)
  const available = selected !== undefined && isCreatorDocumentPath(selected) && episodeDirectory !== undefined
  const documentPaths = useMemo(
    () => episodeDirectory === undefined ? [] : creatorDocumentPaths(workspace?.files.filter(file => file.kind === 'text') ?? [], episodeDirectory),
    [episodeDirectory, workspace?.files],
  )
  const episodeDocuments = useMemo(() => Object.fromEntries(documentPaths.flatMap((path) => {
    const current = buffers[path]
    return current === undefined || current.missing === true ? [] : [[path, current.content] as const]
  })), [buffers, documentPaths])
  const episodeProduction: DramaEpisodeProduction | undefined = useMemo(
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
  const productionRequests = useMemo(() => episodeDirectory === undefined ? []
    : productionRequestsForEpisode(productionRequestsByEpisode[episodeDirectory] ?? [], productionIntents, episodeDirectory),
  [episodeDirectory, productionIntents, productionRequestsByEpisode])
  const productionJobViews = useMemo(() => episodeDirectory === undefined ? []
    : productionBindingsForEpisode(productionIntents, episodeDirectory).map(binding => productionJobView(binding, liveJobs, jobsReady)),
  [episodeDirectory, productionIntents, liveJobs, jobsReady])
  const setProductionSelectedId = useCallback((selectedId: string | undefined) => {
    if (episodeDirectory !== undefined) actions.setProductionSelectedIds(current => ({ ...current, [episodeDirectory]: selectedId }))
  }, [actions, episodeDirectory])
  const setProductionRequests = useCallback((requests: ProductionRequest[]) => {
    if (episodeDirectory !== undefined) actions.setProductionRequests(current => ({
      ...current, [episodeDirectory]: requests,
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

  useEffect(() => {
    if (workspace === undefined) return
    const pending = productionIntents.filter(({ seq }) => seq > productionIntentSeq)
    if (pending.length === 0) return
    for (const { intent } of pending) {
      if (intent.action === 'open_section' || intent.action === 'focus_target') {
        const documentPath = PRODUCTION_DOCUMENTS
          .map(name => `${intent.episode}/${name}`)
          .find(path => workspace.files.some(file => file.path === path))
        if (documentPath !== undefined) openProductionDocument(documentPath)
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
    actions.setProductionIntentSeq(pending.reduce((highest, { seq }) => Math.max(highest, seq), productionIntentSeq))
  }, [actions, openProductionDocument, productionIntentSeq, productionIntents, setProductionSection, workspace])

  const board = episodeDirectory === undefined || episodeProduction === undefined ? undefined : {
    production: episodeProduction,
    section: productionSection,
    selectedId: productionSelectedIds[episodeDirectory],
    requests: productionRequests,
    jobViews: productionJobViews,
    versions: productionVersions,
    libraryVersions: productionLibrary,
    selections: productionSelectionsByEpisode[episodeDirectory] ?? {},
    manualReferences: productionReferencesByEpisode[episodeDirectory] ?? {},
    sequence: productionSequenceByEpisode[episodeDirectory] ?? [],
    canvas: productionCanvasByEpisode[episodeDirectory] ?? {},
    zoom: productionZoomByEpisode[episodeDirectory] ?? .65,
    onSectionChange: setProductionSection,
    onSelect: setProductionSelectedId,
    onRequestsChange: setProductionRequests,
    onSelectionsChange: setProductionSelections,
    onManualReferencesChange: setProductionReferences,
    onSequenceChange: setProductionSequence,
    onCanvasChange: setProductionCanvas,
    onZoomChange: setProductionZoom,
  }
  return { available, documentPaths, board }
}
