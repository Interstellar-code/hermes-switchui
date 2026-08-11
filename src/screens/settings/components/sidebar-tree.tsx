/**
 * sidebar-tree.tsx — Left rail navigation for the Settings screen.
 *
 * The search box used to filter the 27 section *labels* and nothing else, so
 * "docker", "tirith", "retention" and "port" — all real, editable settings —
 * matched nothing at all. When `searchResults` is supplied it renders matching
 * *settings* grouped under the section that owns them; without it the component
 * behaves exactly as it did, which is what keeps it usable from a test or any
 * caller that has no index to give it.
 */

import { useState } from 'react'
import type { SectionOwnership } from '../lib/section-registry'
import type { SectionHits } from '../lib/search-index'

export type SidebarItem = {
  id: string
  label: string
  badge?: string
  dirty?: boolean
  icon?: string
  /**
   * Optional. Surfaced as `data-ownership` + a title hint so a section whose
   * controls write the gateway directly is distinguishable from one the save
   * bar applies to. Omitting it renders exactly as before.
   */
  ownership?: SectionOwnership
}

export type SidebarGroup = {
  label: string
  items: Array<SidebarItem>
}

type SidebarTreeProps = {
  groups: Array<SidebarGroup>
  activeId: string
  onSelect: (id: string) => void
  /**
   * Controlled search text. Omit to keep the box's own state — the component
   * is uncontrolled by default so nothing existing has to change.
   */
  query?: string
  onQueryChange?: (query: string) => void
  /**
   * Real search results for the current query. When present (and the query is
   * non-empty) they replace the label filter entirely.
   */
  searchResults?: Array<SectionHits>
  /** Clicking a matched setting. Falls back to `onSelect` when omitted. */
  onSelectSetting?: (sectionId: string, key: string) => void
}

export function SidebarTree({
  groups,
  activeId,
  onSelect,
  query,
  onQueryChange,
  searchResults,
  onSelectSetting,
}: SidebarTreeProps) {
  const [ownQuery, setOwnQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const text = query ?? ownQuery
  const setText = onQueryChange ?? setOwnQuery
  const trimmed = text.trim()

  const filtered = trimmed
    ? groups
        .map((g) => ({
          ...g,
          items: g.items.filter((it) =>
            it.label.toLowerCase().includes(trimmed.toLowerCase()),
          ),
        }))
        .filter((g) => g.items.length > 0)
    : groups

  const searching = trimmed.length > 0 && searchResults !== undefined
  const hitCount = searching
    ? searchResults.reduce((n, s) => n + s.hits.length + s.overflow, 0)
    : 0

  const totalCount = searching
    ? hitCount
    : groups.reduce((sum, g) => sum + g.items.length, 0)

  const dirtyById = new Map(
    groups.flatMap((g) => g.items.map((it) => [it.id, it.dirty ?? false])),
  )

  return (
    <nav
      className={`side sk-filter${collapsed ? ' collapsed' : ''}`}
      aria-label="Settings navigation"
    >
      <div className="sk-filter-hdr">
        <h2>Settings</h2>
        <span className="ct">{totalCount}</span>
        <button
          type="button"
          className="collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand filters' : 'Collapse filters'}
          aria-label={collapsed ? 'Expand filters' : 'Collapse filters'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>
      </div>
      <div className="sk-filter-search">
        <input
          type="text"
          placeholder="Search settings…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search settings"
        />
      </div>

      <div className="sk-filter-body">
        {searching ? (
          <>
            {searchResults.length === 0 && (
              <div
                className="sec-label"
                style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}
              >
                No setting matches
              </div>
            )}
            {searchResults.map((section) => (
              <div key={section.sectionId} className="sk-filter-section">
                <div className="sec-label">{section.group}</div>
                <div className="sk-filter-list">
                  <button
                    type="button"
                    className={`sk-filter-item${activeId === section.sectionId ? ' active' : ''}${dirtyById.get(section.sectionId) ? ' dirty' : ''}`}
                    onClick={() => onSelect(section.sectionId)}
                    aria-current={activeId === section.sectionId ? 'page' : undefined}
                  >
                    <span>{section.sectionLabel}</span>
                    {section.hits.length > 0 && (
                      <span className="item-ct">
                        {section.hits.length + section.overflow}
                      </span>
                    )}
                  </button>
                  {section.hits.map((hit) => (
                    <button
                      key={hit.key}
                      type="button"
                      className="sk-filter-item sk-filter-hit"
                      title={hit.description || hit.key}
                      onClick={() =>
                        onSelectSetting
                          ? onSelectSetting(hit.sectionId, hit.key)
                          : onSelect(hit.sectionId)
                      }
                      style={{ paddingLeft: '22px' }}
                    >
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <span>{hit.label}</span>
                        <span
                          style={{
                            display: 'block',
                            fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                            fontSize: '10px',
                            color: 'var(--m-text-faint, var(--theme-muted))',
                          }}
                        >
                          {hit.key}
                        </span>
                      </span>
                    </button>
                  ))}
                  {section.overflow > 0 && (
                    <div
                      style={{
                        padding: '2px 22px 6px',
                        fontSize: '10px',
                        color: 'var(--m-text-faint, var(--theme-muted))',
                      }}
                    >
                      +{section.overflow} more
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        ) : (
          filtered.map((group) => (
            <div key={group.label} className="sk-filter-section">
              <div className="sec-label">{group.label}</div>
              <div className="sk-filter-list">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`sk-filter-item${activeId === item.id ? ' active' : ''}${item.dirty ? ' dirty' : ''}`}
                    onClick={() => onSelect(item.id)}
                    aria-current={activeId === item.id ? 'page' : undefined}
                    data-ownership={item.ownership}
                    title={
                      item.ownership === 'self-saving'
                        ? `${item.label} — saves its own changes`
                        : undefined
                    }
                  >
                    <span>{item.label}</span>
                    {item.dirty && <span className="item-ct">●</span>}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* collapsed rail */}
      <div className="sk-rail">
        <span className="rail-label">Settings</span>
        <span className="rail-badge">{totalCount}</span>
      </div>
    </nav>
  )
}
