import { useEffect, useMemo, useState } from 'react'
import type { FileEntry } from './file-tree'
import { formatBytes, formatDate } from '@/lib/format'
import { FIcon, KIND_COLOR, fileKindKey } from './files-icons'
import { Highlight, fuzzy } from './files-search'

type SortKey = 'name' | 'size' | 'modified' | 'type'
type SortDir = 'asc' | 'desc'

type FolderListingProps = {
  entries: Array<FileEntry>
  folderPath: string
  query?: string
  typeFilter?: string
  externalSort?: SortKey | null
  onSelect: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}

export function FolderListing({
  entries,
  folderPath,
  query,
  typeFilter = 'all',
  externalSort,
  onSelect,
  onContextMenu,
}: FolderListingProps) {
  const [sortKey, setSortKey] = useState<SortKey>('modified')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Screen-level sort dropdown drives the grid too; header clicks still
  // override afterwards.
  useEffect(() => {
    if (!externalSort) return
    setSortKey(externalSort)
    setSortDir(externalSort === 'modified' ? 'desc' : 'asc')
  }, [externalSort])

  const rows = useMemo(() => {
    const filtered = entries.filter((e) => {
      if (
        e.type === 'file' &&
        typeFilter !== 'all' &&
        fileKindKey(e.name) !== typeFilter
      ) {
        return false
      }
      if (query && !fuzzy(query, e.name)) return false
      return true
    })
    const sorted = filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortKey === 'size') {
        cmp = (a.size ?? 0) - (b.size ?? 0)
      } else if (sortKey === 'type') {
        cmp =
          (a.type === 'file' ? fileKindKey(a.name) : '').localeCompare(
            b.type === 'file' ? fileKindKey(b.name) : '',
          ) || a.name.localeCompare(b.name)
      } else {
        const am = a.modifiedAt ? Date.parse(a.modifiedAt) : 0
        const bm = b.modifiedAt ? Date.parse(b.modifiedAt) : 0
        cmp = am - bm
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [entries, sortKey, sortDir, query, typeFilter])

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
    const filtering = Boolean(query) || typeFilter !== 'all'
    return (
      <div className="files-empty-state">
        <div>
          <div className="files-empty-glyph">📁</div>
          <div className="files-empty-copy">
            {filtering ? 'No matches' : 'Empty folder'}
          </div>
          <div className="files-empty-subcopy">
            {filtering
              ? 'No items match the current search or type filter.'
              : `${folderPath || 'workspace root'} has no items.`}
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
            const color =
              entry.type === 'file'
                ? KIND_COLOR[fileKindKey(entry.name)]
                : undefined
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
                    className="icon"
                    style={color ? { color } : undefined}
                    aria-hidden="true"
                  >
                    <FIcon file={entry} size={14} />
                  </span>
                  <span className="name">
                    {query ? (
                      <Highlight
                        text={entry.name}
                        ranges={fuzzy(query, entry.name)?.ranges}
                      />
                    ) : (
                      entry.name
                    )}
                  </span>
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

export type { SortKey as FolderSortKey }
