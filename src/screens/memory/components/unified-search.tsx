/**
 * UnifiedSearch — header search across agent memory files, the wiki and
 * matrix-memory (/api/memory/unified-search). Results are grouped by source;
 * picking one switches to the tab that shows it.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWikiFocusStore } from './wiki-focus-store'
import type { UnifiedSearchResponse } from '@/routes/api/memory/unified-search'
import { apiJson } from '@/lib/api-fetch'
import {
  useBrowseFocusStore,
  useMemoryScreenStore,
} from '@/stores/memory-screen-store'

type Hit = { key: string; label: string; detail: string; open: () => void }

export function UnifiedSearch() {
  const profile = useMemoryScreenStore((s) => s.profile)
  const setActiveTab = useMemoryScreenStore((s) => s.setActiveTab)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data, isFetching, isError } = useQuery<UnifiedSearchResponse>({
    queryKey: ['memory', 'unified-search', profile, q],
    queryFn: () =>
      apiJson(
        `/api/memory/unified-search?q=${encodeURIComponent(q)}&profile=${encodeURIComponent(profile)}`,
      ),
    enabled: q.length >= 2,
    staleTime: 30_000,
  })

  const done = () => {
    setOpen(false)
    setSearch('')
  }
  const groups: Array<{ id: string; label: string; hits: Array<Hit> }> = data
    ? [
        {
          id: 'agentFiles',
          // searchMemoryFiles isn't profile-scoped.
          label: 'Agent files (all profiles)',
          hits: data.agentFiles.map((h) => ({
            key: `${h.path}:${h.line}`,
            label: h.text.trim() || h.path,
            detail: `${h.path}:${h.line}`,
            open: () => setActiveTab('memory'),
          })),
        },
        {
          id: 'wiki',
          label: 'Wiki',
          hits: data.wiki.map((h) => ({
            key: h.path,
            label: h.title,
            detail: h.text || h.path,
            open: () => {
              useWikiFocusStore.getState().setPath(h.path)
              setActiveTab('wiki')
            },
          })),
        },
        {
          id: 'memories',
          label: 'Memories',
          hits: data.memories.map((h, i) => ({
            key: `${h.kind}:${i}`,
            label: h.text,
            detail: h.kind,
            open: () => {
              // Browse ANDs its words, so filter by the hit's own leading
              // words (not the OR-matched query) to keep the hit in view.
              useBrowseFocusStore.getState().setFocus({
                type: h.kind,
                q: (h.text.match(/[\p{L}\p{N}_]+/gu) ?? [])
                  .slice(0, 8)
                  .join(' '),
              })
              setActiveTab('browse')
            },
          })),
        },
      ].filter((g) => g.hits.length > 0)
    : []
  const flat = groups.flatMap((g) => g.hits)
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1))
  const showResults = open && q.length >= 2
  const pick = (h: Hit) => {
    h.open()
    done()
  }

  const status = !showResults
    ? ''
    : isError
      ? 'Search failed'
      : !data || (isFetching && flat.length === 0)
        ? 'Searching…'
        : flat.length === 0
          ? 'No matches'
          : `${flat.length} match${flat.length === 1 ? '' : 'es'} · Enter to open`

  let n = -1
  return (
    <div className="mem-search-wrap">
      {/* Always mounted so screen readers announce count changes. */}
      <span className="sr-only" role="status">
        {status}
      </span>
      <input
        type="search"
        className="mem-search"
        placeholder="Search memory…"
        value={search}
        aria-label="Search agent files, wiki and memories"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showResults}
        aria-controls="mem-search-list"
        aria-activedescendant={
          showResults && flat[activeIdx] ? `mem-search-${activeIdx}` : undefined
        }
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && flat.length > 0) {
            e.preventDefault()
            setOpen(true)
            setActive((activeIdx + 1) % flat.length)
          } else if (e.key === 'ArrowUp' && flat.length > 0) {
            e.preventDefault()
            setActive((activeIdx - 1 + flat.length) % flat.length)
          } else if (e.key === 'Enter' && showResults && flat[activeIdx]) {
            e.preventDefault()
            pick(flat[activeIdx])
          } else if (e.key === 'Escape') {
            if (showResults) setOpen(false)
            else setSearch('')
          }
        }}
      />
      {showResults && (
        <div className="mem-search-results">
          <div className="mem-search-count" aria-hidden>
            {status}
          </div>
          <div id="mem-search-list" role="listbox" aria-label="Search results">
            {groups.map((g) => (
              <div
                key={g.id}
                role="group"
                aria-labelledby={`mem-search-g-${g.id}`}
              >
                <div id={`mem-search-g-${g.id}`} className="mem-search-group">
                  {g.label}
                </div>
                {g.hits.map((h) => {
                  const i = ++n
                  return (
                    <div
                      key={h.key}
                      id={`mem-search-${i}`}
                      role="option"
                      aria-selected={i === activeIdx}
                      className={`mem-search-item ${i === activeIdx ? 'is-active' : ''}`}
                      // mousedown, not click: fires before the input's blur closes the list
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(h)
                      }}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span className="mem-search-label">{h.label}</span>
                      <span className="mem-search-detail">{h.detail}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
