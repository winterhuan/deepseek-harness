/** One workspace file the tree groups under a creative root. */
export interface FileTreeInput {
  readonly path: string
  readonly bytes: number
}

/** One leaf node of the file tree. */
export interface FileTreeFile {
  readonly kind: 'file'
  readonly name: string
  readonly path: string
  readonly bytes: number
}

/** One directory node; `fileCount` aggregates the whole subtree. */
export interface FileTreeDirectory {
  readonly kind: 'directory'
  readonly name: string
  readonly path: string
  readonly fileCount: number
  readonly children: readonly FileTreeNode[]
}

/** One node of the assembled file tree. */
export type FileTreeNode = FileTreeFile | FileTreeDirectory

interface MutableDirectory {
  readonly name: string
  readonly path: string
  readonly directories: Map<string, MutableDirectory>
  readonly files: FileTreeFile[]
}

function directory(name: string, path: string): MutableDirectory {
  return { name, path, directories: new Map(), files: [] }
}

function compareNames(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true })
}

function freezeDirectory(value: MutableDirectory): FileTreeDirectory {
  const directories = [...value.directories.values()].map(freezeDirectory).sort(compareNames)
  const files = [...value.files].sort(compareNames)
  return {
    kind: 'directory',
    name: value.name,
    path: value.path,
    fileCount: files.length + directories.reduce((sum, child) => sum + child.fileCount, 0),
    children: [...directories, ...files],
  }
}

/**
 * Assemble a flat workspace listing into a sorted directory tree under one
 * creative root group.
 * @param files - workspace files to nest.
 * @param group - the root directory the listing belongs to.
 * @returns directory-then-file children in zh-Hans numeric order.
 */
export function buildFileTree(files: readonly FileTreeInput[], group: string): readonly FileTreeNode[] {
  const root = directory(group, group)
  for (const file of files) {
    const relative = file.path.startsWith(`${group}/`) ? file.path.slice(group.length + 1) : file.path
    const segments = relative.split('/').filter(segment => segment !== '')
    const name = segments.pop()
    if (name === undefined) continue
    let parent = root
    for (const segment of segments) {
      const path = `${parent.path}/${segment}`
      const child = parent.directories.get(segment) ?? directory(segment, path)
      parent.directories.set(segment, child)
      parent = child
    }
    parent.files.push({ kind: 'file', name, path: file.path, bytes: file.bytes })
  }
  return freezeDirectory(root).children
}
