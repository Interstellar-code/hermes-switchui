import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  MnemosyneActivity,
  MnemosyneBrowsePage,
  MnemosyneBrowseType,
} from '@/server/mnemosyne-browser'
import {
  useBrowseFocusStore,
  useMemoryScreenStore,
} from '@/stores/memory-screen-store'

const PAGE_SIZE = 50

const TYPE_FILTERS: Array<{ id: MnemosyneBrowseType | null; label: string }> = [
  { id: null, label: 'All' },
  { id: 'gist', label: 'Gists' },
  { id: 'fact', label: 'Facts' },
  { id: 'entity', label: 'Entities' },
  { id: 'episodic', label: 'Episodic' },
  { id: 'working', label: 'Working' },
]

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return payload as T
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

const dayKey = (iso: string | null) =>
  iso ? new Date(iso).toDateString() : 'Undated'

function dayLabel(iso: string | null): string {
  if (!iso) return 'UNDATED'
  const d = new Date(iso)
  const md = d
    .toLocaleDateString([], { month: 'short', day: 'numeric' })
    .toUpperCase()
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return `TODAY · ${md}`
  if (d.toDateString() === yesterday.toDateString()) return `YESTERDAY · ${md}`
  return md
}

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

const SPARK_W = 300
const SPARK_H = 54

type DateRange = [start: string, end: string]

/** Local midnight of a YYYY-MM-DD date, as an ISO instant. */
const localMidnightIso = (date: string, plusDays = 0) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d + plusDays).toISOString()
}

/** Write-count sparkline; pointer-drag (or arrow keys) selects a day range. */
function Sparkline({
  days,
  range,
  onRange,
}: {
  days: MnemosyneActivity['days']
  range: DateRange | null
  onRange: (r: DateRange | null) => void
}) {
  const ref = useRef<SVGSVGElement>(null)
  const anchor = useRef<number | null>(null)
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Highlight while dragging / arrowing; committed to the query on release.
  const [draft, setDraft] = useState<[number, number] | null>(null)
  const n = days.length
  const idx = (date: string) => days.findIndex((d) => d.date === date)
  const committed: [number, number] | null = range
    ? [Math.max(0, idx(range[0])), Math.max(0, idx(range[1]))]
    : null
  const shown = draft ?? committed
  useEffect(() => () => clearTimeout(keyTimer.current), [])
  const max = Math.max(1, ...days.map((d) => d.count))
  const slot = SPARK_W / Math.max(1, n)
  const x = (i: number) => (i + 0.5) * slot
  const y = (c: number) => SPARK_H - 4 - (c / max) * (SPARK_H - 10)
  const points = days.map((d, i) => `${x(i)},${y(d.count)}`).join(' ')
  const dayAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return Math.min(
      n - 1,
      Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)),
    )
  }
  const sel = (a: number, b: number): [number, number] => [
    Math.min(a, b),
    Math.max(a, b),
  ]
  const commit = (r: [number, number] | null) => {
    setDraft(null)
    onRange(r ? [days[r[0]].date, days[r[1]].date] : null)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      clearTimeout(keyTimer.current)
      return commit(null)
    }
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!dir) return
    e.preventDefault()
    const [a, b] = shown ?? [n - 1, n - 1]
    const clamp = (v: number) => Math.min(n - 1, Math.max(0, v))
    const next = e.shiftKey
      ? sel(a, clamp(b + dir))
      : sel(clamp(a + dir), clamp(b + dir))
    setDraft(next)
    clearTimeout(keyTimer.current)
    keyTimer.current = setTimeout(() => commit(next), 250)
  }
  const sum = (r: [number, number]) =>
    days.slice(r[0], r[1] + 1).reduce((t, d) => t + d.count, 0)
  const summary = shown
    ? `${shortDate(days[shown[0]].date)}${shown[0] === shown[1] ? '' : ` – ${shortDate(days[shown[1]].date)}`}, ${formatCount(sum(shown))} writes`
    : ''
  return (
    <div className="mbrowse-spark">
      <div className="mbrowse-spark-head">
        <span className="mbrowse-spark-label">RAW WRITES · LAST {n} DAYS</span>
        <span
          id="mbrowse-spark-hint"
          className="mbrowse-spark-hint"
          aria-live="polite"
        >
          {shown ? `showing ${summary}` : 'drag to filter'}
        </span>
        {range && (
          <button
            type="button"
            className="mbrowse-pill mbrowse-chip"
            onClick={() => commit(null)}
          >
            Clear range
          </button>
        )}
      </div>
      <svg
        ref={ref}
        className="mbrowse-spark-svg"
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        role="application"
        aria-label="Writes per day. Drag, or use arrow keys, to filter by date range"
        aria-describedby="mbrowse-spark-hint"
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          anchor.current = dayAt(e.clientX)
          setDraft([anchor.current, anchor.current])
        }}
        onPointerMove={(e) => {
          if (anchor.current !== null)
            setDraft(sel(anchor.current, dayAt(e.clientX)))
        }}
        onPointerUp={(e) => {
          if (anchor.current === null) return
          commit(sel(anchor.current, dayAt(e.clientX)))
          anchor.current = null
        }}
        onPointerCancel={() => {
          anchor.current = null
          setDraft(null)
        }}
      >
        {shown && (
          <rect
            className="mbrowse-spark-sel"
            x={shown[0] * slot}
            y={0}
            width={(shown[1] - shown[0] + 1) * slot}
            height={SPARK_H}
          />
        )}
        <polyline
          className="mbrowse-spark-line"
          points={points}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="sr-only">{summary}</span>
    </div>
  )
}

function SkeletonRows() {
  return (
    <div
      className="mbrowse-list"
      aria-busy="true"
      aria-label="Loading memories"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="mbrowse-item mem-skeleton" />
      ))}
    </div>
  )
}

export function BrowseTab() {
  const profile = useMemoryScreenStore((st) => st.profile)
  const [type, setType] = useState<MnemosyneBrowseType | null>(null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  // Chat source → Browse hand-off: apply whenever set (mounted or not), then
  // clear so it never re-applies stale. Unknown types are ignored.
  const focus = useBrowseFocusStore((st) => st.focus)
  useEffect(() => {
    if (!focus) return
    const known = TYPE_FILTERS.find((f) => f.id === focus.type)
    setType(known ? known.id : null)
    setSearch(focus.q)
    setQ(focus.q.trim())
    useBrowseFocusStore.getState().setFocus(null)
  }, [focus])
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const [fold, setFold] = useState(true)
  const [hideJunk, setHideJunk] = useState(true)
  const [range, setRange] = useState<DateRange | null>(null)

  // Day boundaries are local; reset the range when the profile changes.
  useEffect(() => {
    setRange(null)
  }, [profile])

  const activity = useQuery<MnemosyneActivity>({
    queryKey: ['memory', 'activity', profile, -new Date().getTimezoneOffset()],
    queryFn: () =>
      apiFetch(
        `/api/memory/activity?days=30&tz=${-new Date().getTimezoneOffset()}&profile=${encodeURIComponent(profile)}`,
      ),
    staleTime: 60_000,
  })
  const days = activity.data?.days
  const since = range ? localMidnightIso(range[0]) : null
  const until = range ? localMidnightIso(range[1], 1) : null

  const list = useInfiniteQuery({
    queryKey: [
      'memory',
      'browse',
      profile,
      type,
      q,
      since,
      until,
      fold,
      hideJunk,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), profile })
      if (pageParam) params.set('cursor', pageParam)
      if (type) params.set('type', type)
      if (q) params.set('q', q)
      if (since) params.set('since', since)
      if (until) params.set('until', until)
      if (!fold) params.set('fold', '0')
      if (!hideJunk) params.set('junk', '0')
      return apiFetch<MnemosyneBrowsePage>(`/api/memory/browse?${params}`)
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  // Keyset paging can't duplicate, but dedupe anyway (belt-and-braces).
  const seen = new Set<string>()
  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => {
    const key = `${i.type}:${i.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const groups = (() => {
    const out: Array<{ key: string; label: string; items: typeof items }> = []
    for (const it of items) {
      const key = dayKey(it.createdAt)
      const last = out.at(-1)
      if (last?.key === key) last.items.push(it)
      else out.push({ key, label: dayLabel(it.createdAt), items: [it] })
    }
    return out
  })()
  const totals = activity.data?.totals
  const countOf = (id: MnemosyneBrowseType | null) =>
    totals
      ? id
        ? totals[id]
        : totals.gist +
          totals.fact +
          totals.entity +
          totals.episodic +
          totals.working
      : null
  const filtered = type !== null || q !== '' || range !== null

  return (
    <section className="mbrowse-shell">
      {days && days.length > 0 && (
        <Sparkline days={days} range={range} onRange={setRange} />
      )}

      <div className="mbrowse-toolbar">
        <input
          type="search"
          className="mem-input mbrowse-search"
          placeholder="Search memory…"
          aria-label="Search memory"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mbrowse-chips" role="group" aria-label="Filter by type">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              className={`mbrowse-pill mbrowse-chip ${type === f.id ? 'is-active' : ''}`}
              aria-pressed={type === f.id}
              onClick={() => setType(f.id)}
            >
              {f.label}
              {countOf(f.id) !== null && (
                <span className="mbrowse-count">
                  {formatCount(countOf(f.id)!)}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="mbrowse-toggles">
          <label className="mbrowse-toggle">
            <input
              type="checkbox"
              checked={fold}
              onChange={(e) => setFold(e.target.checked)}
            />
            Fold duplicates
          </label>
          <label className="mbrowse-toggle">
            <input
              type="checkbox"
              checked={hideJunk}
              onChange={(e) => setHideJunk(e.target.checked)}
            />
            Hide junk
            {activity.data ? ` (${formatCount(activity.data.junkFacts)})` : ''}
          </label>
        </div>
      </div>

      {list.isLoading ? (
        <SkeletonRows />
      ) : list.isError ? (
        <div className="mem-empty">
          <span>
            {list.error instanceof Error
              ? list.error.message
              : 'Failed to load memories'}
          </span>
          <button
            type="button"
            className="mem-btn"
            onClick={() => void list.refetch()}
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="mem-empty">
          <span>
            {filtered ? 'No memories match these filters' : 'No memories yet'}
          </span>
          {filtered && (
            <button
              type="button"
              className="mem-btn"
              onClick={() => {
                setType(null)
                setSearch('')
                setRange(null)
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mbrowse-days">
            {groups.map((g, gi) => (
              <section key={g.key} className="mbrowse-day">
                <h3 className="mbrowse-day-head">
                  {g.label} · {g.items.length}
                  {list.hasNextPage && gi === groups.length - 1 ? '+' : ''}
                </h3>
                <ul className="mbrowse-rows">
                  {g.items.map((item) => (
                    <li
                      key={`${item.type}:${item.id}`}
                      className={`mbrowse-row ${item.junk ? 'is-junk' : ''}`}
                    >
                      <span className="mbrowse-kind" data-kind={item.type}>
                        {item.type}
                      </span>
                      <span className="mbrowse-row-text" title={item.text}>
                        {item.text}
                      </span>
                      <span className="mbrowse-ents">
                        {item.junk && (
                          <span className="mbrowse-junk">junk</span>
                        )}
                        {item.entities?.map((e) => (
                          <span key={e} className="mbrowse-ent">
                            {e}
                          </span>
                        ))}
                      </span>
                      {item.dupCount > 1 ? (
                        <span
                          className="mbrowse-dup"
                          title={`${item.dupCount} identical facts folded`}
                        >
                          ×{item.dupCount}
                        </span>
                      ) : (
                        <span />
                      )}
                      <time dateTime={item.createdAt ?? undefined}>
                        {formatTime(item.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {list.hasNextPage && (
            <button
              type="button"
              className="mem-btn mbrowse-more"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
