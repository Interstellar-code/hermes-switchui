import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatBytes, formatDate } from '@/lib/format'
import { getExt } from '@/lib/path-utils'
import type { FileEntry } from './file-tree'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

function getIconClass(entry: FileEntry): string {
  if (entry.type === 'folder') return 'folder'
  const ext = getExt(entry.name)
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (ext === 'json') return 'json'
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return 'code'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'file'
}

type SortKey = 'name' | 'size' | 'modified'
type SortDir = 'asc' | 'desc'

type FolderListingProps = {
  entries: Array<FileEntry>
  folderPath: string
  onSelect: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}

export function FolderListing({
  entries,
  folderPath,
  onSelect,
  onContextMenu,
}: FolderListingProps) {
  const [sortKey, setSortKey] = useState<SortKey>('modified')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const rows = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortKey === 'size') {
        cmp = (a.size ?? 0) - (b.size ?? 0)
      } else {
        const am = a.modifiedAt ? Date.parse(a.modifiedAt) : 0
        const bm = b.modifiedAt ? Date.parse(b.modifiedAt) : 0
        cmp = am - bm
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [entries, sortKey, sortDir])

  const ariaSortFor = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (key !== sortKey) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const arrow = (key: SortKey) => {
    if (key !== sortKey) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  if (rows.length === 0) {
    return (
      <div className="files-empty-state">
        <div>
          <div className="files-empty-glyph">📁</div>
          <div className="files-empty-copy">Empty folder</div>
          <div className="files-empty-subcopy">
            {folderPath || 'workspace root'} has no items.
          </div>
        </div>
      </div>
    )
  }

  const renderSortHeader = (key: SortKey, label: string, className: string) => (
    <th className={className} aria-sort={ariaSortFor(key)}>
      <button
        type="button"
        className="files-folder-sort"
        onClick={() => toggleSort(key)}
      >
        {label}
        {arrow(key)}
      </button>
    </th>
  )

  const handleRowKey = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    entry: FileEntry,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(entry)
  }

  return (
    <div className="files-folder-listing">
      <table>
        <thead>
          <tr>
            {renderSortHeader('name', 'Name', 'col-name')}
            {renderSortHeader('size', 'Size', 'col-size')}
            {renderSortHeader('modified', 'Modified', 'col-mod')}
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const iconClass = getIconClass(entry)
            return (
              <tr
                key={entry.path}
                className="files-folder-row"
                tabIndex={0}
                onClick={() => onSelect(entry)}
                onKeyDown={(e) => handleRowKey(e, entry)}
                onContextMenu={(e) => onContextMenu(e, entry)}
              >
                <td className="col-name">
                  <span
                    className={cn('icon', `is-${iconClass}`)}
                    aria-hidden="true"
                  />
                  <span className="name">{entry.name}</span>
                </td>
                <td className="col-size">
                  {entry.type === 'file' && entry.size !== undefined
                    ? formatBytes(entry.size)
                    : '—'}
                </td>
                <td className="col-mod">
                  {entry.modifiedAt ? formatDate(entry.modifiedAt) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
