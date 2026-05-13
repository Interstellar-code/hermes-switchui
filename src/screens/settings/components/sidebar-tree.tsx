/**
 * sidebar-tree.tsx — Left rail navigation for the Settings screen.
 */

import { useState } from 'react'

export type SidebarItem = {
  id: string
  label: string
  badge?: string
  dirty?: boolean
  icon?: string
}

export type SidebarGroup = {
  label: string
  items: Array<SidebarItem>
}

type SidebarTreeProps = {
  groups: Array<SidebarGroup>
  activeId: string
  onSelect: (id: string) => void
}

export function SidebarTree({ groups, activeId, onSelect }: SidebarTreeProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const filtered = query.trim()
    ? groups
        .map((g) => ({
          ...g,
          items: g.items.filter((it) =>
            it.label.toLowerCase().includes(query.toLowerCase()),
          ),
        }))
        .filter((g) => g.items.length > 0)
    : groups

  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0)

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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter settings sections"
        />
      </div>

      <div className="sk-filter-body">
        {filtered.map((group) => (
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
                >
                  <span>{item.label}</span>
                  {item.dirty && <span className="item-ct">●</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* collapsed rail */}
      <div className="sk-rail">
        <span className="rail-label">Settings</span>
        <span className="rail-badge">{totalCount}</span>
      </div>
    </nav>
  )
}
