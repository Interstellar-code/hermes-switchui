'use client'

/**
 * sidebar-date-popover-v2.tsx — date range popover for the sessions sidebar.
 *
 * Phase 3c: calendar icon in header triggers this. Local state for preset +
 * from/to; Apply writes to sessions-filter-store; Clear resets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

// ── Presets ───────────────────────────────────────────────────────────────────

type Preset = 'today' | '24h' | '7d' | '30d' | '90d' | 'all'

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
]

function presetToRange(preset: Preset): { from: string | null; to: string | null } {
  const now = new Date()
  const toISO = (d: Date) => d.toISOString().slice(0, 10)
  const today = toISO(now)

  if (preset === 'all') return { from: null, to: null }
  if (preset === 'today') return { from: today, to: today }

  const daysAgo = preset === '24h' ? 1 : preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const from = new Date(now)
  from.setDate(from.getDate() - daysAgo)
  return { from: toISO(from), to: today }
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function buildCalendarDays(year: number, month: number): Array<{ iso: string; day: number; thisMonth: boolean }> {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()
  const cells: Array<{ iso: string; day: number; thisMonth: boolean }> = []

  // Leading days from prev month
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i
    const iso = `${year}-${String(month === 0 ? 12 : month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    cells.push({ iso, day: d, thisMonth: false })
  }
  // This month
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    cells.push({ iso, day: d, thisMonth: true })
  }
  // Trailing days to fill 6 rows
  const trailing = 42 - cells.length
  for (let d = 1; d <= trailing; d++) {
    const nextMonth = month === 11 ? 1 : month + 2
    const nextYear = month === 11 ? year + 1 : year
    const iso = `${nextYear}-${String(nextMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    cells.push({ iso, day: d, thisMonth: false })
  }
  return cells
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarDatePopoverV2Props {
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SidebarDatePopoverV2({ onClose }: SidebarDatePopoverV2Props) {
  const setDateRange = useSessionsFilterStore((s) => s.setDateRange)
  const storedDateRange = useSessionsFilterStore((s) => s.dateRange)

  const [preset, setPreset] = useState<Preset | null>(null)
  const [from, setFrom] = useState<string | null>(storedDateRange.from)
  const [to, setTo] = useState<string | null>(storedDateRange.to)

  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on click-outside
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  // Close on ESC
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  const handlePreset = useCallback((p: Preset) => {
    setPreset(p)
    const range = presetToRange(p)
    setFrom(range.from)
    setTo(range.to)
  }, [])

  const handleApply = useCallback(() => {
    setDateRange(from, to)
    onClose()
  }, [from, to, setDateRange, onClose])

  const handleClear = useCallback(() => {
    setPreset(null)
    setFrom(null)
    setTo(null)
    setDateRange(null, null)
    onClose()
  }, [setDateRange, onClose])

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }, [viewMonth])

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }, [viewMonth])

  const days = useMemo(() => buildCalendarDays(viewYear, viewMonth), [viewYear, viewMonth])

  const accent = 'var(--m-green-400, var(--theme-accent))'
  const accentBg = 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 18%, transparent)'

  function dayStyle(iso: string, thisMonth: boolean): React.CSSProperties {
    const isFrom = iso === from
    const isTo = iso === to
    const inRange = from && to && iso > from && iso < to
    if (isFrom || isTo) {
      return {
        background: accentBg,
        color: accent,
        border: `1px solid ${accent}`,
        boxShadow: `0 0 4px ${accent}88`,
        borderRadius: 4,
        fontWeight: 700,
      }
    }
    if (inRange) {
      return {
        background: 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 10%, transparent)',
        color: accent,
        opacity: 0.8,
        borderRadius: 4,
      }
    }
    return {
      color: thisMonth ? 'var(--theme-text)' : 'var(--theme-muted)',
      opacity: thisMonth ? 1 : 0.3,
    }
  }

  function handleDayClick(iso: string, thisMonth: boolean) {
    if (!thisMonth) return
    setPreset(null)
    if (!from || (from && to)) {
      setFrom(iso)
      setTo(null)
    } else {
      if (iso < from) { setTo(from); setFrom(iso) }
      else setTo(iso)
    }
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Date filter"
      style={{
        position: 'absolute',
        top: 40,
        right: 8,
        zIndex: 100,
        width: 272,
        background: 'var(--theme-card, #0d1117)',
        border: '1px solid var(--theme-border)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* RANGE label */}
      <span style={{
        fontSize: 9,
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.12em',
        color: 'var(--theme-muted)',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}>
        RANGE
      </span>

      {/* Preset grid 2×3 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {PRESETS.map(({ id, label }) => {
          const active = preset === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => handlePreset(id)}
              style={{
                padding: '4px 8px',
                fontSize: 10,
                fontFamily: 'var(--font-mono, monospace)',
                letterSpacing: '0.06em',
                borderRadius: 4,
                border: `1px solid ${active ? accent : 'var(--theme-border)'}`,
                background: active ? accentBg : 'transparent',
                color: active ? accent : 'var(--theme-muted)',
                boxShadow: active ? `0 0 6px ${accent}66` : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" onClick={prevMonth} style={navBtnStyle} aria-label="Previous month">‹</button>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--theme-text)' }}>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button type="button" onClick={nextMonth} style={navBtnStyle} aria-label="Next month">›</button>
      </div>

      {/* Day grid */}
      <div>
        {/* DOW header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
          {DOW.map((d, i) => (
            <span key={i} style={{
              textAlign: 'center',
              fontSize: 9,
              color: 'var(--theme-muted)',
              fontFamily: 'var(--font-mono, monospace)',
              padding: '2px 0',
            }}>{d}</span>
          ))}
        </div>
        {/* Days */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
          {days.map(({ iso, day, thisMonth }) => (
            <button
              key={iso}
              type="button"
              onClick={() => handleDayClick(iso, thisMonth)}
              style={{
                textAlign: 'center',
                fontSize: 10,
                padding: '3px 0',
                cursor: thisMonth ? 'pointer' : 'default',
                border: '1px solid transparent',
                background: 'transparent',
                fontFamily: 'var(--font-mono, monospace)',
                transition: 'all 0.1s',
                ...dayStyle(iso, thisMonth),
              }}
              aria-label={iso}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 4, borderTop: '1px solid var(--theme-border)' }}>
        <button type="button" onClick={handleClear} style={footerBtnStyle('muted')}>
          Clear
        </button>
        <button type="button" onClick={handleApply} style={footerBtnStyle('accent')}>
          Apply
        </button>
      </div>
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--theme-muted)',
  fontSize: 14,
  lineHeight: 1,
  padding: '2px 6px',
}

function footerBtnStyle(variant: 'muted' | 'accent'): React.CSSProperties {
  const isAccent = variant === 'accent'
  return {
    fontSize: 10,
    fontFamily: 'var(--font-mono, monospace)',
    letterSpacing: '0.06em',
    padding: '4px 12px',
    borderRadius: 4,
    border: isAccent ? '1px solid var(--m-green-500, var(--theme-accent))' : '1px solid var(--theme-border)',
    background: isAccent ? 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 18%, transparent)' : 'transparent',
    color: isAccent ? 'var(--m-green-400, var(--theme-accent))' : 'var(--theme-muted)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  }
}
