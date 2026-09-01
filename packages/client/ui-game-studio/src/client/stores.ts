import { defineStore } from '@deepseek-ai/dsh-client-store'

/** A game project summary returned by the workspace API. */
export interface GameProject {
  readonly id: string
  readonly root: string
  readonly title: string
  readonly source: 'workspace' | 'example'
  readonly previewReady: boolean
  readonly previewUrl?: string | undefined
  readonly previewVersion: string
  readonly verification: {
    readonly status: 'NOT_RUN' | 'FAIL' | 'PASS'
    readonly checks: Readonly<Record<string, 'NOT_RUN' | 'FAIL' | 'PASS'>>
  }
}

/** Workspace payload shape from the game-studio host API. */
export interface WorkspacePayload {
  readonly cwd: string
  readonly files: readonly WorkspaceFile[]
  readonly games: readonly GameProject[]
  readonly mode: 'dsh-session'
}

/** One workspace file entry. */
export interface WorkspaceFile {
  readonly path: string
  readonly bytes: number
  readonly version: string
  readonly kind: 'text' | 'media'
  readonly mimeType?: string | undefined
}

/** Game-studio panel store shape. */
export interface GameStudioState {
  /** Currently selected project id. */
  projectId: string | undefined
  /** Selected tab in the studio. */
  tab: 'preview' | 'files' | 'qa'
  /** Force-refresh token for the preview iframe. */
  previewRevision: number
  /** Currently loaded preview version; newer builds wait for user action. */
  loadedPreviewVersion: string | undefined
  /** Path of the currently selected file in the project browser. */
  selectedFile: string | undefined
}

/** Create the game-studio panel store. */
export function createGameStudioStore() {
  return defineStore({
    init: (): GameStudioState => ({
      projectId: undefined,
      tab: 'preview',
      previewRevision: 0,
      loadedPreviewVersion: undefined,
      selectedFile: undefined,
    }),
    actions: {
      setProjectId: (draft, projectId: string | undefined) => {
        draft.projectId = projectId
      },
      setTab: (draft, tab: GameStudioState['tab']) => {
        draft.tab = tab
      },
      bumpPreviewRevision: (draft) => {
        draft.previewRevision += 1
      },
      setLoadedPreviewVersion: (draft, version: string | undefined) => {
        draft.loadedPreviewVersion = version
      },
      setSelectedFile: (draft, path: string | undefined) => {
        draft.selectedFile = path
      },
    },
  })
}
