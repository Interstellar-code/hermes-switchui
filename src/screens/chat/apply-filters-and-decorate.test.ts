import { describe, expect, it } from 'vitest'
import { applyFiltersAndDecorate } from './apply-filters-and-decorate'
import type { SessionFeedItem } from './sessions-feed-types'
import type { FilterState } from '@/stores/sessions-filter-store'
import type { LocalState } from '@/stores/sessions-local-store'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<SessionFeedItem> & { id: string }): SessionFeedItem {
  return {
    src: 'chat',
    title: 'Test Session',
    sub: null,
    tokens: null,
    when: Date.now(),
    day: 'today',
    live: false,
    state: 'idle',
    badges: [],
    pinned: false,
    starred: false,
    archived: false,
    sourceMeta: {},
    ...overrides,
  }
}

function makeFilter(overrides: Partial<FilterState> = {}): Pick<FilterState, 'sources' | 'state' | 'query' | 'dateRange' | 'sort'> {
  return {
    sources: [],
    state: 'all',
    query: '',
    dateRange: { from: null, to: null },
    sort: 'recent',
    ...overrides,
  }
}

function makeLocal(overrides: Partial<LocalState> = {}): Pick<LocalState, 'pinned' | 'starred' | 'archived'> {
  return {
    pinned: [],
    starred: [],
    archived: [],
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('applyFiltersAndDecorate', () => {
  it('empty sources = all sources included', () => {
    const items = [
      makeItem({ id: 'chat:a', src: 'chat' }),
      makeItem({ id: 'task:b', src: 'task' }),
      makeItem({ id: 'cron:c', src: 'cron' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ sources: [] }), makeLocal())
    expect(result.totalCount).toBe(3)
  })

  it('source filter narrows results', () => {
    const items = [
      makeItem({ id: 'chat:a', src: 'chat' }),
      makeItem({ id: 'task:b', src: 'task' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ sources: ['chat'] }), makeLocal())
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items).every((i) => i.src === 'chat')).toBe(true)
  })

  it('state filter = live shows only live items', () => {
    const items = [
      makeItem({ id: 'chat:a', state: 'live' }),
      makeItem({ id: 'chat:b', state: 'idle' }),
      makeItem({ id: 'chat:c', state: 'complete' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ state: 'live' }), makeLocal())
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:a')
  })

  it('archived items hidden by default (state = all)', () => {
    const items = [
      makeItem({ id: 'chat:a', state: 'idle' }),
      makeItem({ id: 'chat:b', state: 'archived' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter(), makeLocal())
    expect(result.totalCount).toBe(1)
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids).not.toContain('chat:b')
  })

  it('locally archived items hidden by default', () => {
    const items = [
      makeItem({ id: 'chat:a', state: 'idle' }),
      makeItem({ id: 'chat:b', state: 'idle' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter(), makeLocal({ archived: ['chat:b'] }))
    expect(result.totalCount).toBe(1)
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids).not.toContain('chat:b')
  })

  it('state = archived shows only archived items', () => {
    const items = [
      makeItem({ id: 'chat:a', state: 'idle' }),
      makeItem({ id: 'chat:b', state: 'archived' }),
      makeItem({ id: 'chat:c', state: 'idle' }),
    ]
    const local = makeLocal({ archived: ['chat:c'] })
    const result = applyFiltersAndDecorate(items, makeFilter({ state: 'archived' }), local)
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids).toContain('chat:b')
    expect(ids).toContain('chat:c')
    expect(ids).not.toContain('chat:a')
  })

  it('search is case-insensitive on title', () => {
    const items = [
      makeItem({ id: 'chat:a', title: 'Hello World' }),
      makeItem({ id: 'chat:b', title: 'Goodbye' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ query: 'hello' }), makeLocal())
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:a')
  })

  it('search matches sub field', () => {
    const items = [
      makeItem({ id: 'chat:a', title: 'Session', sub: 'last message preview' }),
      makeItem({ id: 'chat:b', title: 'Other', sub: null }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ query: 'PREVIEW' }), makeLocal())
    expect(result.totalCount).toBe(1)
  })

  it('date range: items before from are excluded', () => {
    const items = [
      makeItem({ id: 'chat:a', when: new Date('2025-01-15').getTime(), day: 'earlier' }),
      makeItem({ id: 'chat:b', when: new Date('2025-03-01').getTime(), day: 'earlier' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ dateRange: { from: '2025-02-01', to: null } }), makeLocal())
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:b')
  })

  it('date range: items after to are excluded (inclusive to-day)', () => {
    const items = [
      makeItem({ id: 'chat:a', when: new Date('2025-01-15').getTime(), day: 'earlier' }),
      makeItem({ id: 'chat:b', when: new Date('2025-03-01').getTime(), day: 'earlier' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ dateRange: { from: null, to: '2025-02-01' } }), makeLocal())
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:a')
  })

  it('pinned items appear in Pinned group above Today', () => {
    const now = Date.now()
    const items = [
      makeItem({ id: 'chat:a', when: now, day: 'today' }),
      makeItem({ id: 'chat:b', when: now - 1000, day: 'today' }),
    ]
    const local = makeLocal({ pinned: ['chat:b'] })
    const result = applyFiltersAndDecorate(items, makeFilter(), local)
    expect(result.groups[0].label).toBe('Pinned')
    expect(result.groups[0].items[0].id).toBe('chat:b')
    const todayGroup = result.groups.find((g) => g.label === 'Today')
    expect(todayGroup).toBeDefined()
    expect(todayGroup!.items.every((i) => i.id !== 'chat:b')).toBe(true)
  })

  it('pinned group appears before all day groups', () => {
    const now = Date.now()
    const items = [
      makeItem({ id: 'chat:today', when: now, day: 'today' }),
      makeItem({ id: 'chat:yesterday', when: now - 86400001, day: 'yesterday' }),
      makeItem({ id: 'chat:earlier', when: now - 172800001, day: 'earlier' }),
    ]
    const local = makeLocal({ pinned: ['chat:earlier'] })
    const result = applyFiltersAndDecorate(items, makeFilter(), local)
    const labels = result.groups.map((g) => g.label)
    expect(labels[0]).toBe('Pinned')
  })

  it('decorated items have pinned/starred/archived flags from local store', () => {
    const items = [makeItem({ id: 'chat:a' })]
    const local = makeLocal({ pinned: ['chat:a'], starred: ['chat:a'] })
    const result = applyFiltersAndDecorate(items, makeFilter(), local)
    const item = result.groups.flatMap((g) => g.items)[0]
    expect(item.pinned).toBe(true)
    expect(item.starred).toBe(true)
    expect(item.archived).toBe(false)
  })

  it('source-archived item gets archived=true after decoration', () => {
    // item.state === 'archived' should decorate archived=true even without local entry
    const items = [makeItem({ id: 'chat:b', state: 'archived' })]
    const result = applyFiltersAndDecorate(items, makeFilter({ state: 'archived' }), makeLocal())
    const item = result.groups.flatMap((g) => g.items)[0]
    expect(item).toBeDefined()
    expect(item.archived).toBe(true)
  })

  it('sort = recent: most recent first', () => {
    const items = [
      makeItem({ id: 'chat:old', when: 1000 }),
      makeItem({ id: 'chat:new', when: 9000 }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ sort: 'recent' }), makeLocal())
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids[0]).toBe('chat:new')
  })

  it('sort = tokens: highest tokens first', () => {
    const items = [
      makeItem({ id: 'chat:a', tokens: 100 }),
      makeItem({ id: 'chat:b', tokens: 500 }),
      makeItem({ id: 'chat:c', tokens: 50 }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ sort: 'tokens' }), makeLocal())
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids[0]).toBe('chat:b')
  })

  it('sort = source: grouped by source order', () => {
    const items = [
      makeItem({ id: 'task:a', src: 'task' }),
      makeItem({ id: 'chat:a', src: 'chat' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ sort: 'source' }), makeLocal())
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids[0]).toBe('chat:a')
  })

  it('sourceCounts ignores current source filter', () => {
    const items = [
      makeItem({ id: 'chat:a', src: 'chat', state: 'idle' }),
      makeItem({ id: 'task:a', src: 'task', state: 'idle' }),
      makeItem({ id: 'cron:a', src: 'cron', state: 'idle' }),
    ]
    // Filter to chat only, but sourceCounts should reflect all sources
    const result = applyFiltersAndDecorate(items, makeFilter({ sources: ['chat'] }), makeLocal())
    expect(result.sourceCounts['chat']).toBe(1)
    expect(result.sourceCounts['task']).toBe(1)
    expect(result.sourceCounts['cron']).toBe(1)
    // But totalCount reflects the actual source filter
    expect(result.totalCount).toBe(1)
  })

  it('sourceCounts respects state+search+date filters', () => {
    const items = [
      makeItem({ id: 'chat:a', src: 'chat', state: 'live' }),
      makeItem({ id: 'chat:b', src: 'chat', state: 'idle' }),
      makeItem({ id: 'task:a', src: 'task', state: 'live' }),
    ]
    const result = applyFiltersAndDecorate(items, makeFilter({ sources: [], state: 'live' }), makeLocal())
    expect(result.sourceCounts['chat']).toBe(1)
    expect(result.sourceCounts['task']).toBe(1)
    expect(result.sourceCounts['cron']).toBeUndefined()
  })

  it('date range: item at local 23:30 on to-day is included', () => {
    // Use a fixed local date: 2025-01-15 23:30:00 local time
    const d = new Date(2025, 0, 15, 23, 30, 0, 0) // local midnight-ish
    const items = [
      makeItem({ id: 'chat:a', when: d.getTime(), day: 'earlier' }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ dateRange: { from: '2025-01-15', to: '2025-01-15' } }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
  })

  it('date range: item at local 00:00 on day after to is excluded', () => {
    const d = new Date(2025, 0, 16, 0, 0, 0, 0)
    const items = [
      makeItem({ id: 'chat:a', when: d.getTime(), day: 'earlier' }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ dateRange: { from: null, to: '2025-01-15' } }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(0)
  })

  it('totalCount is 0 when nothing matches', () => {
    const items = [makeItem({ id: 'chat:a', title: 'hello' })]
    const result = applyFiltersAndDecorate(items, makeFilter({ query: 'zzznomatch' }), makeLocal())
    expect(result.totalCount).toBe(0)
    expect(result.groups).toEqual([])
  })
})
