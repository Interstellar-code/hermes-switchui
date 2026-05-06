'use client'

/**
 * sidebar-search-v2.tsx — search input for sessions panel.
 *
 * Phase 3a: input renders, debounce + filter store wiring in 3b.
 */

import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

export function SidebarSearchV2() {
  const query = useSessionsFilterStore((s) => s.query)
  const setQuery = useSessionsFilterStore((s) => s.setQuery)

  return (
    <div
      className="px-3 py-2 shrink-0"
      style={{ borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))' }}
    >
      <input
        type="search"
        placeholder="Search sessions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded px-2 py-1 text-xs outline-none"
        style={{
          background: 'var(--theme-input, var(--theme-card))',
          color: 'var(--theme-text)',
          border: '1px solid var(--theme-border)',
        }}
        aria-label="Search sessions"
      />
    </div>
  )
}
