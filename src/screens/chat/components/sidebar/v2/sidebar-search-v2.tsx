'use client'

/**
 * sidebar-search-v2.tsx — search input for sessions panel.
 *
 * Phase 3b: magnifier icon prefix, correct placeholder, clear (×) button.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

export function SidebarSearchV2() {
  const storeQuery = useSessionsFilterStore((s) => s.query)
  const setQuery = useSessionsFilterStore((s) => s.setQuery)

  // Local state for debounce (200ms per plan)
  const [localQuery, setLocalQuery] = useState(storeQuery)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLocalQuery(storeQuery)
  }, [storeQuery])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setLocalQuery(val)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setQuery(val), 200)
    },
    [setQuery],
  )

  const handleClear = useCallback(() => {
    setLocalQuery('')
    setQuery('')
  }, [setQuery])

  return (
    <div
      className="px-3 py-2 shrink-0"
      style={{ borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))' }}
    >
      <div
        className="flex items-center gap-1.5 rounded px-2 py-1"
        style={{
          background: 'var(--theme-input, var(--theme-card))',
          border: '1px solid var(--theme-border)',
        }}
      >
        {/* Magnifier icon */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          style={{ color: 'var(--theme-muted)', flexShrink: 0 }}
        >
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>

        <input
          type="text"
          placeholder="search sessions, tools, content..."
          value={localQuery}
          onChange={handleChange}
          className="m-mono flex-1 min-w-0 outline-none bg-transparent"
          style={{ color: 'var(--theme-text)', fontSize: 11 }}
          aria-label="Search sessions"
          data-testid="sessions-search-input"
        />

        {/* Clear button */}
        {localQuery.length > 0 && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={handleClear}
            className="flex items-center justify-center rounded-full"
            style={{
              width: 14,
              height: 14,
              color: 'var(--theme-muted)',
              background: 'var(--theme-border)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 9,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
