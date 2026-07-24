import { useEffect, useMemo, useState } from 'react'
import { FIcon, KIND_COLOR, SvgIco, fileKindKey } from './files-icons'
import { Highlight, fuzzy } from './files-search'
import type { FileEntry } from './file-tree'
import { formatBytes, formatRelativeIso } from '@/lib/format'

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

/**
 * Timestamp shown in the Modified column: a file's own mtime, or for folders
 * the newest immediate child's mtime (design: FolderView `modOf`).
 */
function modifiedIso(entry: FileEntry): string | undefined {
  if (entry.type === 'file') return entry.modifiedAt
  let newest: string | undefined
  for (const child of entry.children ?? []) {
    if (!child.modifiedAt) continue
    if (!newest || Date.parse(child.modifiedAt) > Date.parse(newest)) {
      newest = child.modifiedAt
    }
  }
  return newest
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
  const [nameQuery, setNameQuery] = useState('')
  const [nameSearchOpen, setNameSearchOpen] = useState(false)

  // Name-column search local to this grid, OR'd with the screen-level `query`.
  const activeQuery = (nameQuery.trim() || query || '').trim()

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
      if (activeQuery && !fuzzy(activeQuery, e.name)) return false
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
  }, [entries, sortKey, sortDir, activeQuery, typeFilter])

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
    const filtering = Boolean(activeQuery) || typeFilter !== 'all'
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
            <th className="col-serial">Sl. No.</th>
            <th className="col-name" aria-sort={ariaSortFor('name')}>
              <div className="col-name-head">
                <button
                  type="button"
                  className="files-folder-sort"
                  onClick={() => toggleSort('name')}
                >
                  Name{arrow('name')}
                </button>
                <button
                  type="button"
                  className={`files-folder-name-toggle${nameQuery ? ' is-active' : ''}`}
                  onClick={() =>
                    setNameSearchOpen((open) => {
                      if (open) setNameQuery('')
                      return !open
                    })
                  }
                  aria-label="Search files by name"
                  aria-expanded={nameSearchOpen}
                >
                  <SvgIco name="search" size={13} />
                </button>
                {nameSearchOpen ? (
                  <input
                    type="text"
                    className="files-folder-name-search"
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setNameQuery('')
                        setNameSearchOpen(false)
                      }
                    }}
                    onBlur={() => {
                      if (!nameQuery) setNameSearchOpen(false)
                    }}
                    placeholder="Search name…"
                    aria-label="Search files by name"
                    autoFocus
                  />
                ) : null}
              </div>
            </th>
            {renderSortHeader('size', 'Size', 'col-size')}
            {renderSortHeader('modified', 'Modified', 'col-mod')}
          </tr>
        </thead>
        <tbody>
          {rows.map((entry, index) => {
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
                <td className="col-serial">{index + 1}</td>
                <td className="col-name">
                  <span
                    className="icon"
                    style={color ? { color } : undefined}
                    aria-hidden="true"
                  >
                    <FIcon file={entry} size={14} />
                  </span>
                  <span className="name">
                    {activeQuery ? (
                      <Highlight
                        text={entry.name}
                        ranges={fuzzy(activeQuery, entry.name)?.ranges}
                      />
                    ) : (
                      entry.name
                    )}
                  </span>
                  {entry.type === 'folder' ? (
                    <span className="files-folder-count">
                      {entry.children?.length ?? 0}
                    </span>
                  ) : null}
                </td>
                <td className="col-size">
                  {entry.type === 'file' && entry.size !== undefined
                    ? formatBytes(entry.size)
                    : '—'}
                </td>
                <td className="col-mod">{formatRelativeIso(modifiedIso(entry))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export type { SortKey as FolderSortKey }
