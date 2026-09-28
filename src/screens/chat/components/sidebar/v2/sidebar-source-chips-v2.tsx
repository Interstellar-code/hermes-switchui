'use client'

/**
 * sidebar-source-chips-v2.tsx — multi-select source filter chips.
 *
 * Phase 3b: ALL chip, source icons, count badges, availability gating.
 * 8 chips: ALL, CHAT, RECOVERED, CRON, TASKS, API, CLI, A2A, TELEGRAM
 * Source chips are a blocklist: a selected chip HIDES that source. ALL clears
 * every hidden source. Empty selection = nothing hidden = everything shows.
 * Hidden chips: sources where available === false.
 */

import type { FilterAndDecorateResult } from '@/screens/chat/apply-filters-and-decorate'
import type {
  SessionSource,
  SessionSourceResult,
} from '@/screens/chat/sessions-feed-types'
import { SOURCE_COLORS } from '@/screens/chat/source-visuals'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

const SELECTED_FILTER_COLOR = 'var(--m-info, #5fcfff)'

// ── Source definitions ────────────────────────────────────────────────────────

const SOURCE_DEFS: Array<{
  id: SessionSource
  label: string
  icon: React.ReactNode
}> = [
  {
    id: 'chat',
    label: 'CHAT',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M2 3h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'recovered',
    label: 'RECOVERED',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M4 8a4 4 0 1 1 1.2 2.85"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M4 11V8h3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'task',
    label: 'TASK',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect
          x="2.5"
          y="3"
          width="11"
          height="10"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M5.5 7.5l1.5 1.5 3-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'cron',
    label: 'CRON',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 5v3.5l2.5 1.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'api',
    label: 'API',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M3 5h10M3 8h10M3 11h7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'tool',
    label: 'TOOLS',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M9.5 2.5a4 4 0 0 1-4 6.5L2 12.5a1.5 1.5 0 0 0 2.1 2.1L7.5 11a4 4 0 0 1 6.5-4l-2 2v1.5H13.5l2-2z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'cli',
    label: 'CLI',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <polyline
          points="2,5 6,8 2,11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <line
          x1="8"
          y1="11"
          x2="14"
          y2="11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'a2a',
    label: 'A2A',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="3" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="13" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
        <line
          x1="5"
          y1="8"
          x2="11"
          y2="8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'tg',
    label: 'TELEGRAM',
    icon: (
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M14 2L1 6.5l4.5 2L12 4l-5 6 5 3 2-11z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarSourceChipsV2Props {
  sourceResults?: Array<SessionSourceResult>
  sourceCounts?: FilterAndDecorateResult['sourceCounts']
  attention?: Partial<
    Record<SessionSource, { live: boolean; updated: boolean }>
  >
}

export function SidebarSourceChipsV2({
  sourceResults,
  sourceCounts,
  attention,
}: SidebarSourceChipsV2Props) {
  const hidden = useSessionsFilterStore((s) => s.sources)
  const toggleSource = useSessionsFilterStore((s) => s.toggleSource)
  const clearSources = useSessionsFilterStore((s) => s.clearSources)

  // Build availability map
  const availabilityMap: Partial<Record<SessionSource, boolean>> = {}
  if (sourceResults) {
    for (const r of sourceResults) {
      availabilityMap[r.src] = r.available
    }
  }

  const isAllActive = hidden.length === 0

  // Total count for ALL chip
  const totalCount = sourceCounts
    ? Object.values(sourceCounts).reduce<number>((a, b) => a + b, 0)
    : undefined
  const allAttention = Object.values(attention ?? {}).reduce(
    (result, value) => ({
      live: result.live || value.live,
      updated: result.updated || value.updated,
    }),
    { live: false, updated: false },
  )

  const handleAllClick = () => {
    // Un-hide every source. Only the source chips — the date window, search and
    // profile are separate controls and clearing them here surprises people.
    if (!isAllActive) clearSources()
  }

  return (
    <div
      className="flex flex-wrap gap-1 px-3 py-2 shrink-0"
      style={{
        borderBottom:
          '1px solid var(--theme-border-subtle, var(--theme-border))',
      }}
    >
      {/* ALL chip */}
      <Chip
        label="ALL"
        icon={
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M5 8h6M8 5v6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        }
        active={isAllActive}
        count={totalCount}
        accentColor="var(--m-green-400, var(--theme-accent))"
        live={allAttention.live}
        updated={allAttention.updated}
        onClick={handleAllClick}
      />

      {/* Per-source chips — hidden if not available */}
      {SOURCE_DEFS.map(({ id, label, icon }) => {
        const count = sourceCounts?.[id]
        // Hide a source only when it's both unavailable AND has no items.
        // Telegram items arrive via the chat query, so its dedicated feed
        // reports available:false even though tg cards exist — count is truth.
        if (
          sourceResults &&
          availabilityMap[id] === false &&
          !(count && count > 0)
        ) {
          return null
        }

        const isHidden = hidden.includes(id)

        return (
          <Chip
            key={id}
            label={label}
            icon={icon}
            active={isHidden}
            excluded={isHidden}
            count={count}
            accentColor={SOURCE_COLORS[id]}
            live={attention?.[id]?.live ?? false}
            updated={attention?.[id]?.updated ?? false}
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
  /** Active means "this source is hidden" — draw it struck out, not selected. */
  excluded?: boolean
  count?: number
  accentColor: string
  live?: boolean
  updated?: boolean
  onClick: () => void
  'data-testid'?: string
}

function Chip({
  label,
  icon,
  active,
  excluded = false,
  count,
  accentColor,
  live = false,
  updated = false,
  onClick,
  'data-testid': testId,
}: ChipProps) {
  // A hidden source draws no attention: its sessions are not in the list, so
  // pulsing at the user about them is noise they cannot act on.
  const hasAttention = (live || updated) && !excluded
  // Selection wins over attention for the chip's chrome: a live chip that is
  // also selected must still *look* selected, or clicking it reads as a no-op.
  // Attention keeps the glow and the pulse, which selection never draws.
  const visualColor = excluded
    ? 'var(--theme-muted)'
    : active
      ? SELECTED_FILTER_COLOR
      : hasAttention
        ? accentColor
        : 'var(--theme-muted)'
  return (
    <button
      type="button"
      role="button"
      aria-pressed={active}
      aria-label={
        excluded
          ? `${label} hidden`
          : live
            ? `${label} has active sessions`
            : updated
              ? `${label} has unread updates`
              : label
      }
      onClick={onClick}
      data-testid={testId}
      data-attention={hasAttention || undefined}
      className={`m-chip flex items-center gap-1 rounded-full px-2 py-0.5 transition-all${live && !excluded ? ' session-attention-pulse' : ''}`}
      style={{
        background: excluded
          ? 'transparent'
          : active
            ? `color-mix(in srgb, ${SELECTED_FILTER_COLOR} 18%, transparent)`
            : hasAttention
              ? `color-mix(in srgb, ${accentColor} 18%, transparent)`
              : 'var(--theme-card)',
        color: visualColor,
        opacity: excluded ? 0.5 : 1,
        textDecoration: excluded ? 'line-through' : 'none',
        border: `1px ${excluded ? 'dashed' : 'solid'} ${hasAttention || active ? visualColor : 'var(--theme-border)'}`,
        boxShadow: excluded
          ? 'none'
          : live
            ? `0 0 6px ${accentColor}66`
            : updated
              ? `0 0 4px ${accentColor}55`
              : 'none',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          color: visualColor,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
      {count != null && (
        <span
          className="m-mono rounded-full px-1"
          style={{
            background: active
              ? `color-mix(in srgb, ${SELECTED_FILTER_COLOR} 30%, transparent)`
              : hasAttention
                ? `color-mix(in srgb, ${accentColor} 30%, transparent)`
                : 'var(--theme-border)',
            color: visualColor,
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
