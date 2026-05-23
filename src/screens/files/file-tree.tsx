import { cn } from '@/lib/utils'

export type FileEntry = {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  modifiedAt?: string
  children?: Array<FileEntry>
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'dist',
])

function countChildFiles(entry: FileEntry): number {
  if (!entry.children) return 0
  let n = 0
  for (const c of entry.children) {
    if (IGNORED_DIRS.has(c.name)) continue
    if (c.type === 'file') n += 1
  }
  return n
}

type FolderTreeNodeProps = {
  entry: FileEntry
  depth: number
  expanded: Set<string>
  forceExpanded?: boolean
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (entry: FileEntry) => void
  onDeleteRequest: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}

function FolderTreeNode({
  entry,
  depth,
  expanded,
  forceExpanded = false,
  selectedPath,
  onToggle,
  onSelect,
  onDeleteRequest,
  onContextMenu,
}: FolderTreeNodeProps) {
  const isExpanded = forceExpanded || expanded.has(entry.path)
  const isSelected = selectedPath === entry.path
  const paddingLeft = 12 + depth * 16
  const fileCount = countChildFiles(entry)

  const handleClick = () => {
    onSelect(entry)
    onToggle(entry.path)
  }

  const subfolders = (entry.children || []).filter(
    (c) => c.type === 'folder' && !IGNORED_DIRS.has(c.name),
  )

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry)}
        className={cn(
          'files-tree-row',
          isExpanded ? 'is-expanded' : '',
          isSelected ? 'is-active' : '',
        )}
        style={{ paddingLeft }}
      >
        <span className="chev">▶</span>
        <span className="icon is-folder" aria-hidden="true" />
        <span className="name">{entry.name}</span>
        {fileCount > 0 ? <span className="badge">{fileCount}</span> : null}
        <span
          role="button"
          tabIndex={0}
          className="row-delete"
          title="Delete folder"
          aria-label={`Delete ${entry.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onDeleteRequest(entry)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onDeleteRequest(entry)
          }}
        >
          🗑
        </span>
      </button>

      {isExpanded && subfolders.length > 0 ? (
        <div>
          {subfolders.map((child) => (
            <FolderTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              forceExpanded={forceExpanded}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
              onDeleteRequest={onDeleteRequest}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

type FileTreeProps = {
  entries: Array<FileEntry>
  expanded: Set<string>
  forceExpanded?: boolean
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (entry: FileEntry) => void
  onDeleteRequest: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}

export function FileTree({
  entries,
  expanded,
  forceExpanded,
  selectedPath,
  onToggle,
  onSelect,
  onDeleteRequest,
  onContextMenu,
}: FileTreeProps) {
  const folders = entries.filter(
    (e) => e.type === 'folder' && !IGNORED_DIRS.has(e.name),
  )
  return (
    <>
      {folders.map((entry) => (
        <FolderTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          expanded={expanded}
          forceExpanded={forceExpanded}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
          onDeleteRequest={onDeleteRequest}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  )
}

export { IGNORED_DIRS }
