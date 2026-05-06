'use client'

/**
 * sidebar-source-chips-v2.tsx — multi-select source filter chips.
 *
 * Wired to sessions-filter-store. Zero chips selected = all sources shown.
 * Phase 3a: chips render with toggle logic; counts added in 3b.
 */

import type { SessionSource } from '@/screens/chat/sessions-feed-types'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

const SOURCES: Array<{ id: SessionSource; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'task', label: 'Tasks' },
  { id: 'cron', label: 'Cron' },
  { id: 'mem', label: 'Memory' },
]

export function SidebarSourceChipsV2() {
  const sources = useSessionsFilterStore((s) => s.sources)
  const toggleSource = useSessionsFilterStore((s) => s.toggleSource)

  return (
    <div className="flex flex-wrap gap-1 px-3 py-2 shrink-0">
      {SOURCES.map(({ id, label }) => {
        const active = sources.includes(id)
        return (
          <button
            key={id}
            type="button"
            role="button"
            aria-pressed={active}
            onClick={() => toggleSource(id)}
            className="rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
            style={{
              background: active ? 'var(--theme-accent)' : 'var(--theme-card)',
              color: active ? 'var(--theme-bg, #020804)' : 'var(--theme-muted)',
              border: '1px solid',
              borderColor: active ? 'var(--theme-accent)' : 'var(--theme-border)',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
