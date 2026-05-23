import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatBytes, formatDate } from '@/lib/format'
import { getExt } from '@/lib/path-utils'
import type { FileEntry } from './file-tree'
import { IGNORED_DIRS } from './file-tree'

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
    const filtered = entries.filter((e) => !IGNORED_DIRS.has(e.name))
    const sorted = [...filtered].sort((a, b) => {
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

  return (
    <div className="files-folder-listing">
      <table>
        <thead>
          <tr>
            <th
              className="col-name sortable"
              onClick={() => toggleSort('name')}
            >
              Name{arrow('name')}
            </th>
            <th
              className="col-size sortable"
              onClick={() => toggleSort('size')}
            >
              Size{arrow('size')}
            </th>
            <th
              className="col-mod sortable"
              onClick={() => toggleSort('modified')}
            >
              Modified{arrow('modified')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const iconClass = getIconClass(entry)
            return (
              <tr
                key={entry.path}
                className="files-folder-row"
                onClick={() => onSelect(entry)}
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
