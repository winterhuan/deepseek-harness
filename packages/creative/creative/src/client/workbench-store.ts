/** Persistent Creative drafts and production preparation, scoped by Session. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { DramaProductionSection } from './drama-production.ts'
import type { WorkbenchMode } from './file-activity.ts'
import type { CanvasPoint, ProductionRequest, ProductionSequenceItem } from './production-runtime.ts'
import { restoreBuffers, type FileBuffer } from './editor-buffer.ts'

/** Drafts and user selections retained when a Sidebar tab is unmounted. */
export interface WorkbenchMemory {
  buffers: Record<string, FileBuffer>
  editorMode: 'preview' | 'source' | 'production'
  expanded: Record<string, boolean>
  selected: string | undefined
  workbench: WorkbenchMode
  gameTab: 'preview' | 'design'
  gameProjectId: string | undefined
  videoTab: 'preview' | 'artifacts'
  videoProjectId: string | undefined
  productionSection: DramaProductionSection
  productionSelectedIds: Record<string, string | undefined>
  productionRequests: Record<string, ProductionRequest[]>
  productionSelections: Record<string, Record<string, string>>
  productionReferences: Record<string, Record<string, string[]>>
  productionSequence: Record<string, ProductionSequenceItem[]>
  productionCanvas: Record<string, Record<string, CanvasPoint>>
  productionZoom: Record<string, number>
  /**
   * Highest Session sequence whose production result the workbench already
   * applied. Results above it are new navigation work; everything at or below
   * it was consumed once and must not replay after a tab remount.
   */
  productionIntentSeq: number
}

/**
 * The shape one rehydrated `creative.workbench.v2` value may still carry.
 *
 * Persistence replaces the whole state, so a value written before the sequence
 * cursor existed rehydrates without that field — and possibly with the retired
 * consumed call-id ledger the cursor replaces.
 */
export interface PersistedWorkbenchMemory extends WorkbenchMemory {
  /** Retired consumed-result ledger; migrated into the cursor on first use. */
  productionIntentCalls?: Record<string, boolean>
}

type Update<T> = T | ((current: T) => T)

type WorkbenchActions = {
  restoreBuffers: (draft: WorkbenchMemory) => void
  /** Forget the retired consumed call-id ledger once it seeded the cursor. */
  retireProductionIntentCalls: (draft: WorkbenchMemory) => void
} & {
  [Key in keyof WorkbenchMemory as `set${Capitalize<Key>}`]: (draft: WorkbenchMemory, update: Update<WorkbenchMemory[Key]>) => void
}

function applyUpdate<T>(current: T, update: Update<T>): T {
  return typeof update === 'function' ? (update as (value: T) => T)(current) : update
}

/**
 * Create Session-scoped editor and preparation state without live execution status.
 * @returns the slot-owned persistent store declaration.
 */
export function createWorkbenchStore(): EngineStoreHandle<WorkbenchMemory, WorkbenchActions> {
  const declaration = defineStore({
    persist: 'creative.workbench.v2',
    init: (): WorkbenchMemory => ({
      buffers: {},
      editorMode: 'preview',
      expanded: {},
      selected: undefined,
      workbench: 'story',
      gameTab: 'preview',
      gameProjectId: undefined,
      videoTab: 'preview',
      videoProjectId: undefined,
      productionSection: 'shots',
      productionSelectedIds: {},
      productionRequests: {},
      productionSelections: {},
      productionReferences: {},
      productionSequence: {},
      productionCanvas: {},
      productionZoom: {},
      productionIntentSeq: 0,
    }),
    actions: {
      restoreBuffers: (draft) => {
        draft.buffers = restoreBuffers(draft.buffers)
      },
      setBuffers: (draft, update: Update<Record<string, FileBuffer>>) => {
        draft.buffers = applyUpdate(draft.buffers, update)
      },
      setEditorMode: (draft, update: Update<WorkbenchMemory['editorMode']>) => {
        draft.editorMode = applyUpdate(draft.editorMode, update)
      },
      setExpanded: (draft, update: Update<Record<string, boolean>>) => {
        draft.expanded = applyUpdate(draft.expanded, update)
      },
      setSelected: (draft, update: Update<string | undefined>) => {
        draft.selected = applyUpdate(draft.selected, update)
      },
      setWorkbench: (draft, update: Update<WorkbenchMode>) => {
        draft.workbench = applyUpdate(draft.workbench, update)
      },
      setGameTab: (draft, update: Update<WorkbenchMemory['gameTab']>) => {
        draft.gameTab = applyUpdate(draft.gameTab, update)
      },
      setGameProjectId: (draft, update: Update<string | undefined>) => {
        draft.gameProjectId = applyUpdate(draft.gameProjectId, update)
      },
      setVideoTab: (draft, update: Update<WorkbenchMemory['videoTab']>) => {
        draft.videoTab = applyUpdate(draft.videoTab, update)
      },
      setVideoProjectId: (draft, update: Update<string | undefined>) => {
        draft.videoProjectId = applyUpdate(draft.videoProjectId, update)
      },
      setProductionSection: (draft, update: Update<DramaProductionSection>) => {
        draft.productionSection = applyUpdate(draft.productionSection, update)
      },
      setProductionSelectedIds: (draft, update: Update<Record<string, string | undefined>>) => {
        draft.productionSelectedIds = applyUpdate(draft.productionSelectedIds, update)
      },
      setProductionRequests: (draft, update: Update<Record<string, ProductionRequest[]>>) => {
        draft.productionRequests = applyUpdate(draft.productionRequests, update)
      },
      setProductionSelections: (draft, update: Update<Record<string, Record<string, string>>>) => {
        draft.productionSelections = applyUpdate(draft.productionSelections, update)
      },
      setProductionReferences: (draft, update: Update<Record<string, Record<string, string[]>>>) => {
        draft.productionReferences = applyUpdate(draft.productionReferences, update)
      },
      setProductionSequence: (draft, update: Update<Record<string, ProductionSequenceItem[]>>) => {
        draft.productionSequence = applyUpdate(draft.productionSequence, update)
      },
      setProductionCanvas: (draft, update: Update<Record<string, Record<string, CanvasPoint>>>) => {
        draft.productionCanvas = applyUpdate(draft.productionCanvas, update)
      },
      setProductionZoom: (draft, update: Update<Record<string, number>>) => {
        draft.productionZoom = applyUpdate(draft.productionZoom, update)
      },
      setProductionIntentSeq: (draft, update: Update<number>) => {
        draft.productionIntentSeq = applyUpdate(draft.productionIntentSeq, update)
      },
      retireProductionIntentCalls: (draft) => {
        // Stop persisting the retired ledger once it has seeded the cursor.
        delete (draft as PersistedWorkbenchMemory).productionIntentCalls
      },
    },
  })
  return {
    ...declaration,
    create(scopeKey?: string) {
      const instance = declaration.create(scopeKey)
      instance.actions.restoreBuffers()
      return instance
    },
  }
}
