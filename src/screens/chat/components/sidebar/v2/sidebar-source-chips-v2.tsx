'use client'

/**
 * sidebar-source-chips-v2.tsx — multi-select source filter chips.
 *
 * Phase 3b: ALL chip, source icons, count badges, availability gating.
 * 7 chips: ALL, CHAT, CRON, TASKS, TOOLS, TELEGRAM, MEMORY
 * ALL chip clears sources. Other chips toggle in/out.
 * Hidden chips: sources where available === false.
 */

import type { FilterAndDecorateResult } from '@/screens/chat/apply-filters-and-decorate'
import type { SessionSource, SessionSourceResult } from '@/screens/chat/sessions-feed-types'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

// ── Source definitions ────────────────────────────────────────────────────────

const SOURCE_DEFS: Array<{ id: SessionSource; label: string; icon: React.ReactNode }> = [
  {
    id: 'chat',
    label: 'CHAT',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2 3h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'cron',
    label: 'CRON',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'task',
    label: 'TASKS',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'tool',
    label: 'TOOLS',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M9.5 2.5a4 4 0 0 1-4 6.5L2 12.5a1.5 1.5 0 0 0 2.1 2.1L7.5 11a4 4 0 0 1 6.5-4l-2 2v1.5H13.5l2-2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'tg',
    label: 'TELEGRAM',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M14 2L1 6.5l4.5 2L12 4l-5 6 5 3 2-11z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'mem',
    label: 'MEMORY',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <ellipse cx="8" cy="5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M2 5v6c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M2 8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
]

// ── Rail / accent colors per source ───────────────────────────────────────────

const SOURCE_COLORS: Record<SessionSource, string> = {
  chat: 'var(--m-green-400, #00ff41)',
  cron: '#d6ff5f',
  task: '#5fcfff',
  tool: '#b98aff',
  tg: '#ff5fa2',
  mem: '#7dff9a',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarSourceChipsV2Props {
  sourceResults?: Array<SessionSourceResult>
  sourceCounts?: FilterAndDecorateResult['sourceCounts']
}

export function SidebarSourceChipsV2({
  sourceResults,
  sourceCounts,
}: SidebarSourceChipsV2Props) {
  const sources = useSessionsFilterStore((s) => s.sources)
  const toggleSource = useSessionsFilterStore((s) => s.toggleSource)
  const reset = useSessionsFilterStore((s) => s.reset)

  // Build availability map
  const availabilityMap: Partial<Record<SessionSource, boolean>> = {}
  if (sourceResults) {
    for (const r of sourceResults) {
      availabilityMap[r.src] = r.available
    }
  }

  const isAllActive = sources.length === 0

  // Total count for ALL chip
  const totalCount = sourceCounts
    ? Object.values(sourceCounts).reduce<number>((a, b) => a + b, 0)
    : undefined

  const handleAllClick = () => {
    // Clear all sources (= show all)
    if (!isAllActive) {
      reset()
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1 px-3 py-2 shrink-0"
      style={{ borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))' }}
    >
      {/* ALL chip */}
      <Chip
        label="ALL"
        icon={
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        }
        active={isAllActive}
        count={totalCount}
        accentColor="var(--m-green-400, var(--theme-accent))"
        onClick={handleAllClick}
      />

      {/* Per-source chips — hidden if not available */}
      {SOURCE_DEFS.map(({ id, label, icon }) => {
        // If sourceResults provided, hide unavailable sources
        if (sourceResults && availabilityMap[id] === false) return null

        const active = sources.includes(id)
        const count = sourceCounts?.[id]

        return (
          <Chip
            key={id}
            label={label}
            icon={icon}
            active={active}
            count={count}
            accentColor={SOURCE_COLORS[id]}
            onClick={() => toggleSource(id)}
            data-testid={`chip-${id}`}
          />
        )
      })}
    </div>
  )
}

// ── Chip ─────────────────────────────────────────────────────────────────────

interface ChipProps {
  label: string
  icon: React.ReactNode
  active: boolean
  count?: number
  accentColor: string
  onClick: () => void
  'data-testid'?: string
}

function Chip({ label, icon, active, count, accentColor, onClick, 'data-testid': testId }: ChipProps) {
  return (
    <button
      type="button"
      role="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all"
      style={{
        background: active ? `color-mix(in srgb, ${accentColor} 18%, transparent)` : 'var(--theme-card)',
        color: active ? accentColor : 'var(--theme-muted)',
        border: `1px solid ${active ? accentColor : 'var(--theme-border)'}`,
        boxShadow: active ? `0 0 6px ${accentColor}66` : 'none',
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.06em',
        cursor: 'pointer',
      }}
    >
      <span style={{ color: active ? accentColor : 'var(--theme-muted)', display: 'flex', alignItems: 'center' }}>
        {icon}
      </span>
      <span>{label}</span>
      {count != null && (
        <span
          className="rounded-full px-1"
          style={{
            background: active ? `color-mix(in srgb, ${accentColor} 30%, transparent)` : 'var(--theme-border)',
            color: active ? accentColor : 'var(--theme-muted)',
            fontSize: 9,
            lineHeight: '14px',
            minWidth: 14,
            textAlign: 'center',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}
