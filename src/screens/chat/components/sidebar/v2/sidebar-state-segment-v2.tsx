'use client'

/**
 * sidebar-state-segment-v2.tsx — session state filter segment + sort row.
 *
 * Phase 3b: STATE label, 6 options (All/Live/Idle/Complete/Error/Archived),
 * sort selector on the right.
 */

import type { SessionFeedSort, SessionState } from '@/screens/chat/sessions-feed-types'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

const STATES: Array<{ id: SessionState | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'idle', label: 'Idle' },
  { id: 'complete', label: 'Done' },
  { id: 'error', label: 'Err' },
  { id: 'archived', label: 'Arc' },
]

const SORT_LABELS: Record<SessionFeedSort, string> = {
  recent: '↕ recent',
  tokens: '↕ tokens',
  source: '↕ source',
}

export function SidebarStateSegmentV2() {
  const state = useSessionsFilterStore((s) => s.state)
  const setState = useSessionsFilterStore((s) => s.setState)
  const sort = useSessionsFilterStore((s) => s.sort)
  const setSort = useSessionsFilterStore((s) => s.setSort)

  const handleSortCycle = () => {
    const order: Array<SessionFeedSort> = ['recent', 'tokens', 'source']
    const next = order[(order.indexOf(sort) + 1) % order.length]
    setSort(next)
  }

  return (
    <div
      className="shrink-0"
      style={{ borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))' }}
    >
      {/* State label + sort row */}
      <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5">
        <span
          className="m-label select-none"
          style={{ color: 'var(--theme-muted)' }}
        >
          STATE
        </span>

        <button
          type="button"
          onClick={handleSortCycle}
          className="m-mono"
          style={{
            color: 'var(--theme-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 9,
          }}
          aria-label={`Sort: ${sort}`}
        >
          {SORT_LABELS[sort]}
        </button>
      </div>

      {/* Segment buttons */}
      <div
        className="flex px-2 pb-1.5 gap-0.5"
        role="group"
        aria-label="Filter by session state"
      >
        {STATES.map(({ id, label }) => {
          const active = state === id
          return (
            <button
              key={id}
              type="button"
              role="button"
              aria-pressed={active}
              onClick={() => { setState(id) }}
              className="m-mono flex-1 rounded py-0.5 transition-colors"
              style={{
                background: active
                  ? 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 20%, transparent)'
                  : 'transparent',
                color: active ? 'var(--m-green-400, var(--theme-accent))' : 'var(--theme-muted)',
                border: '1px solid',
                borderColor: active
                  ? 'var(--m-green-500, var(--theme-accent))'
                  : 'transparent',
                cursor: 'pointer',
                fontSize: 9,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
