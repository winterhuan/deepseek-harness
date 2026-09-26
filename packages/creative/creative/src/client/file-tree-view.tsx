/** Recursive file tree the Creative editor workbenches render in their sidebar. */
import type { CSSProperties } from 'react'
import type { FileTreeNode } from './file-tree.js'

/**
 * Render file-tree nodes as file buttons and collapsible folders.
 * @param props - nodes at one depth, expansion and selection state, and navigation callbacks.
 * @returns the rendered nodes.
 */
export function FileTreeNodes({
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
