/** Descriptor each Creative workbench domain supplies to the workbench shell. */
import type { ComponentType, ReactNode } from 'react'
import type { PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchMode } from '../file-activity.js'
import type { CreativeLocaleKey, NS } from '../locales/index.ts'
import type { createWorkbenchStore, WorkbenchMemory } from '../workbench-store.ts'
import type { WorkspacePayload } from '../workspace-client.ts'

/** The Session-scoped workbench store hook and bound actions a domain reads and writes. */
export type WorkbenchStoreProps = PropsStore<ReturnType<typeof createWorkbenchStore>>

/** Bound workbench store actions. */
export type WorkbenchActions = WorkbenchStoreProps['actions']

interface DomainBase<Mode extends WorkbenchMode> {
  readonly mode: Mode
  /**
   * Top-level workspace directory names in file-tree order. Entries are on-disk directory
   * identifiers, not UI copy; unlisted groups sort after them.
   */
  readonly groupOrder: readonly string[]
  /**
   * Adjust domain-owned state when the shell reveals `path` inside this domain.
   * @param path - the workspace-relative path being revealed.
   * @param actions - bound workbench store actions.
   */
  readonly reveal?: (path: string, actions: WorkbenchActions) => void
}

/** A domain edited through the shared file tree and document editor. */
export interface EditorDomain<Mode extends WorkbenchMode = WorkbenchMode> extends DomainBase<Mode> {
  readonly surface: 'editor'
  /** Accessible label of the file-tree navigation. */
  readonly treeLabelKey: CreativeLocaleKey
  /** Editor body shown while no document is selected. */
  readonly Empty: ComponentType<{ readonly t: TranslateNS<typeof NS> }>
}

/** Props the shell passes to a studio domain once the workspace has loaded. */
export interface StudioProps extends WorkbenchStoreProps {
  readonly t: TranslateNS<typeof NS>
  readonly sessionId: string
  readonly workspace: WorkspacePayload
  /** An agent is writing below the domain's `activityRoot`. */
  readonly building: boolean
  readonly selected: string | undefined
  readonly hidden: boolean
  readonly workbenches: readonly WorkbenchMode[]
  readonly onWorkbench: (mode: WorkbenchMode) => void
  readonly onSelect: (path: string) => void
}

/** A domain rendered by its own studio instead of the shared editor. */
export interface StudioDomain<Mode extends WorkbenchMode = WorkbenchMode> extends DomainBase<Mode> {
  readonly surface: 'studio'
  /** Workspace-relative directory prefix whose agent writes mark the studio as building. */
  readonly activityRoot: string
  /** Placeholder copy while the workspace connection is pending. */
  readonly connectingKey: CreativeLocaleKey
  /** Frame for the connecting, error, and Session-unavailable placeholder. */
  readonly Placeholder: ComponentType<{ readonly children: ReactNode }>
  /** The studio; the shell mounts it on first open and hides it afterwards instead of unmounting. */
  readonly Studio: ComponentType<StudioProps>
  /**
   * Reset domain-owned state when the creator switches into the studio.
   * @param actions - bound workbench store actions.
   */
  readonly enter: (actions: WorkbenchActions) => void
  /**
   * Report whether the studio is showing a live preview that agent writes must not navigate away from.
   * @param memory - the current workbench memory.
   * @returns whether agent-follow navigation is suppressed.
   */
  readonly holdsAgentFollow: (memory: WorkbenchMemory) => boolean
}

/** One Creative workbench domain. */
export type WorkbenchDomain<Mode extends WorkbenchMode = WorkbenchMode> = EditorDomain<Mode> | StudioDomain<Mode>
