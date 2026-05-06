'use client'

/**
 * sidebar-state-segment-v2.tsx — session state filter segment control.
 *
 * States: all | live | idle | complete | error | archived
 * Phase 3a: segment renders + toggles; full filtering in 3b.
 */

import type { SessionState } from '@/screens/chat/sessions-feed-types'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

const STATES: Array<{ id: SessionState | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'idle', label: 'Idle' },
  { id: 'complete', label: 'Done' },
  { id: 'error', label: 'Err' },
]

export function SidebarStateSegmentV2() {
  const state = useSessionsFilterStore((s) => s.state)
  const setState = useSessionsFilterStore((s) => s.setState)

  return (
    <div
      className="flex px-3 py-1.5 gap-0.5 shrink-0"
      role="group"
      aria-label="Filter by session state"
      style={{ borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))' }}
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
            className="flex-1 rounded py-0.5 text-xs font-medium transition-colors"
            style={{
              background: active ? 'var(--theme-accent-subtle, var(--theme-card))' : 'transparent',
              color: active ? 'var(--theme-accent)' : 'var(--theme-muted)',
              border: '1px solid',
              borderColor: active ? 'var(--theme-accent-border, var(--theme-border))' : 'transparent',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
