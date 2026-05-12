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

function IconSearch() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5" strokeLinecap="round"/>
      <path d="M10 10l3.5 3.5" strokeLinecap="round"/>
    </svg>
  )
}

export function SidebarTree({ groups, activeId, onSelect }: SidebarTreeProps) {
  const [query, setQuery] = useState('')

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

  return (
    <nav className="side" aria-label="Settings navigation">
      {/* Search */}
      <div className="search">
        <IconSearch />
        <input
          type="text"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter settings sections"
        />
      </div>

      {/* Groups */}
      {filtered.map((group) => (
        <div key={group.label}>
          <div className="grp">
            {group.label}
            <span className="ct">{group.items.length}</span>
          </div>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`item${activeId === item.id ? ' on' : ''}${item.dirty ? ' dirty' : ''}`}
              onClick={() => onSelect(item.id)}
              aria-current={activeId === item.id ? 'page' : undefined}
            >
              {/* icon placeholder — 18px column */}
              <span aria-hidden="true" />
              <span>{item.label}</span>
              {(item.badge !== undefined || item.dirty) && (
                <span className="badge">{item.dirty ? '●' : item.badge}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
