import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  MnemosyneBrowsePage,
  MnemosyneBrowseType,
  MnemosyneStats,
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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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

  const stats = useQuery<MnemosyneStats>({
    queryKey: ['memory', 'availability', profile],
    queryFn: () =>
      apiFetch(`/api/memory/stats?profile=${encodeURIComponent(profile)}`),
    staleTime: 60_000,
  })

  const list = useInfiniteQuery({
    queryKey: ['memory', 'browse', profile, type, q],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), profile })
      if (pageParam) params.set('cursor', pageParam)
      if (type) params.set('type', type)
      if (q) params.set('q', q)
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
  const filtered = type !== null || q !== ''

  return (
    <section className="mbrowse-shell">
      {stats.data?.db.exists && (
        <div className="mbrowse-strip" aria-label="Memory stats">
          <span>
            <b>{formatCount(stats.data.counts.working)}</b> working
          </span>
          <span>
            <b>{formatCount(stats.data.counts.episodic)}</b> episodic
          </span>
          <span>
            <b>{formatCount(stats.data.counts.triples)}</b> triples
          </span>
          <span>
            <b>{formatCount(stats.data.counts.fts)}</b> indexed
          </span>
          {stats.data.lastWriteAt && (
            <span>last write {formatDate(stats.data.lastWriteAt)}</span>
          )}
        </div>
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
            </button>
          ))}
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
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <ul className="mbrowse-list">
            {items.map((item) => (
              <li key={`${item.type}:${item.id}`} className="mbrowse-item">
                <div className="mbrowse-item-meta">
                  <span className="mbrowse-type">{item.type}</span>
                  <time dateTime={item.createdAt ?? undefined}>
                    {formatDate(item.createdAt)}
                  </time>
                </div>
                <p className="mbrowse-item-text">{item.text}</p>
              </li>
            ))}
          </ul>
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
