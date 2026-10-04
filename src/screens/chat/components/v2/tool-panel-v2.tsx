import { useMemo, useState } from 'react'
import { formatStreamingActivityLabel } from '../streaming-activity-ui'
import { DEFAULT_CHAT_HISTORY_LIMIT } from '../../chat-queries'
import {
  categorizeEntry,
  filterToolEntries,
  unwrapToolInput,
} from './tool-entries'
import type { FlatToolEntry } from './tool-entries'

type PanelEvent = {
  text: string
  emoji: string
  timestamp: number
  isError: boolean
}

export type ToolPanelV2Props = {
  entries: Array<FlatToolEntry>
  events?: Array<PanelEvent>
  mcpToolNames?: ReadonlySet<string>
  /** Show the "covers the latest N messages" footer note. */
  historyCapped?: boolean
}

export type ToolGroup = {
  name: string
  label: string
  entries: Array<FlatToolEntry>
  errors: number
  running: boolean
  lastTs: number
  lastDisplayTs?: number
}

const PAGE = 20
const NO_EVENTS: Array<PanelEvent> = []
const EVENTS_CHIP = '__events'
const ERRORS_CHIP = '__errors'

const danger = 'var(--theme-danger, #ef4444)'
const muted = 'var(--m-muted, var(--theme-muted))'
const border = 'var(--m-border, var(--theme-border))'
const surface = 'var(--m-surface-1, var(--theme-card))'

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function isRunning(e: FlatToolEntry): boolean {
  return e.output === undefined && !e.isError
}

function searchText(e: FlatToolEntry): string {
  let args = ''
  try {
    args = e.input ? JSON.stringify(e.input) : ''
  } catch {
    // unserialisable args: match on name/output only
  }
  return `${e.name}\n${args}\n${e.output ?? ''}`.toLowerCase()
}

function argsSummary(e: FlatToolEntry): string {
  const input = unwrapToolInput(e.input)
  if (!input) return ''
  const first = Object.values(input).find((v) => typeof v === 'string')
  return typeof first === 'string' ? first : JSON.stringify(input)
}

/** Group entries by tool name; groups and calls most recent first. */
export function groupToolEntries(
  entries: Array<FlatToolEntry>,
): Array<ToolGroup> {
  const map = new Map<string, ToolGroup>()
  for (const e of entries) {
    let g = map.get(e.name)
    if (!g) {
      g = {
        name: e.name,
        label: formatStreamingActivityLabel(e.name),
        entries: [],
        errors: 0,
        running: false,
        lastTs: 0,
      }
      map.set(e.name, g)
    }
    g.entries.push(e)
    if (e.isError) g.errors++
    if (isRunning(e)) g.running = true
    const ts = e.timestamp ?? 0
    if (ts >= g.lastTs) g.lastTs = ts
    if (e.displayTs !== undefined && e.displayTs >= (g.lastDisplayTs ?? 0))
      g.lastDisplayTs = e.displayTs
  }
  const groups = [...map.values()]
  for (const g of groups)
    g.entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  return groups.sort((a, b) => b.lastTs - a.lastTs)
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    borderColor: active ? 'var(--theme-accent)' : border,
    color: active ? 'var(--theme-accent)' : muted,
    background: 'transparent',
  }
}

function CallRow({ entry }: { entry: FlatToolEntry }) {
  const color = entry.isError
    ? danger
    : isRunning(entry)
      ? 'var(--theme-accent, #6366f1)'
      : 'var(--theme-success, #22c55e)'
  const summary = argsSummary(entry)
  const firstLine = entry.isError
    ? (entry.output ?? '').trim().split('\n')[0]
    : ''
  return (
    <li className="flex min-w-0 flex-col gap-0.5 px-3 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span
          data-testid="call-dot"
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span
          className="m-mono min-w-0 flex-1 truncate"
          title={summary.slice(0, 300)}
        >
          {summary || entry.callId}
        </span>
      </div>
      {firstLine ? (
        <span className="m-mono truncate pl-3.5" style={{ color: danger }}>
          {firstLine}
        </span>
      ) : null}
    </li>
  )
}

function GroupCard({ group }: { group: ToolGroup }) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const rest = group.entries.length - shown
  return (
    <div
      className="overflow-hidden rounded border"
      style={{ background: surface, borderColor: border }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <span aria-hidden="true">{open ? '▼' : '▶'}</span>
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{
            background:
              group.errors > 0
                ? danger
                : group.running
                  ? 'var(--theme-accent, #6366f1)'
                  : 'var(--theme-success, #22c55e)',
          }}
        />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        <span className="shrink-0 text-xs" style={{ color: muted }}>
          ×{group.entries.length}
        </span>
        {group.errors > 0 ? (
          <span
            className="shrink-0 rounded-[3px] border px-1 text-[10px]"
            style={{ color: danger, borderColor: danger }}
          >
            {group.errors} err
          </span>
        ) : null}
        <span className="shrink-0 text-xs" style={{ color: muted }}>
          {group.running
            ? 'running'
            : group.lastDisplayTs !== undefined
              ? relativeTime(group.lastDisplayTs)
              : ''}
        </span>
      </button>
      {open ? (
        <ul className="border-t" style={{ borderColor: border }}>
          {group.entries.slice(0, shown).map((e) => (
            <CallRow key={e.key} entry={e} />
          ))}
          {rest > 0 ? (
            <li className="px-3 py-1.5">
              <button
                type="button"
                className="text-xs underline"
                style={{ color: muted }}
                onClick={() => setShown((n) => n + PAGE)}
              >
                Show {rest} more
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

export function ToolPanelV2({
  entries,
  events = NO_EVENTS,
  mcpToolNames,
  historyCapped,
}: ToolPanelV2Props) {
  const [chip, setChip] = useState('all')
  const [query, setQuery] = useState('')

  const rows = useMemo(
    () => filterToolEntries(entries, 'all', mcpToolNames),
    [entries, mcpToolNames],
  )
  const errorCount = useMemo(() => rows.filter((e) => e.isError).length, [rows])
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const e of rows) set.add(categorizeEntry(e, mcpToolNames))
    return [...set].sort()
  }, [rows, mcpToolNames])

  // A chip whose category vanished (new session data, errors fixed) resets.
  const chipAvailable =
    chip === 'all' ||
    (chip === ERRORS_CHIP && errorCount > 0) ||
    (chip === EVENTS_CHIP && events.length > 0) ||
    categories.includes(chip)
  if (!chipAvailable) setChip('all')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groupToolEntries(
      rows.filter((e) => {
        if (chip === ERRORS_CHIP && !e.isError) return false
        if (
          chip !== 'all' &&
          chip !== ERRORS_CHIP &&
          chip !== EVENTS_CHIP &&
          categorizeEntry(e, mcpToolNames) !== chip
        )
          return false
        return !q || searchText(e).includes(q)
      }),
    )
  }, [rows, chip, query, mcpToolNames])

  const attention = groups
    .filter((g) => g.errors > 0)
    .sort((a, b) => b.errors - a.errors)
  const healthy = groups.filter((g) => g.errors === 0)
  const showEvents = chip === EVENTS_CHIP
  const q = query.trim()

  const chipBtn = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      aria-pressed={chip === id}
      onClick={() => setChip(id)}
      className="rounded-full border px-2 py-0.5 text-xs"
      style={chipStyle(chip === id)}
    >
      {label}
    </button>
  )

  return (
    <div
      className="flex min-w-0 flex-col gap-3 p-3"
      style={{ color: 'var(--m-text, var(--theme-text))' }}
    >
      <input
        type="search"
        aria-label="Search tools"
        placeholder="Search tools, args, output"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault()
            setQuery('')
          }
        }}
        className="w-full min-w-0 rounded border px-2 py-1 text-sm"
        style={{ background: surface, borderColor: border, color: 'inherit' }}
      />
      <div className="flex flex-wrap gap-1.5">
        {chipBtn('all', 'all')}
        {errorCount > 0 ? chipBtn(ERRORS_CHIP, `errors ${errorCount}`) : null}
        {categories.map((c) => chipBtn(c, c))}
        {events.length > 0
          ? chipBtn(EVENTS_CHIP, `events ${events.length}`)
          : null}
      </div>

      {showEvents ? (
        <ul className="flex flex-col gap-1 text-xs">
          {events.map((ev, i) => (
            <li
              key={i}
              className="truncate"
              style={{ color: ev.isError ? danger : muted }}
            >
              {ev.emoji} {ev.text}
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: muted }}>
          No tool calls yet.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm" style={{ color: muted }}>
          No matches{q ? ` for "${q}"` : ''}.
        </p>
      ) : (
        <>
          {attention.length > 0 ? (
            <section
              aria-label="Needs attention"
              className="flex flex-col gap-1.5"
            >
              <h3
                className="text-[10px] font-medium uppercase tracking-[0.16em]"
                style={{ color: danger }}
              >
                Needs attention
              </h3>
              {attention.map((g) => (
                <GroupCard key={g.name} group={g} />
              ))}
            </section>
          ) : null}
          {healthy.length > 0 ? (
            <section aria-label="All tools" className="flex flex-col gap-1.5">
              <h3
                className="text-[10px] font-medium uppercase tracking-[0.16em]"
                style={{ color: muted }}
              >
                All tools
              </h3>
              {healthy.map((g) => (
                <GroupCard key={g.name} group={g} />
              ))}
            </section>
          ) : null}
        </>
      )}

      {historyCapped ? (
        <p
          className="border-t pt-2 text-[10px]"
          style={{ color: muted, borderColor: border }}
        >
          Covers the latest {DEFAULT_CHAT_HISTORY_LIMIT} messages
        </p>
      ) : null}
    </div>
  )
}
