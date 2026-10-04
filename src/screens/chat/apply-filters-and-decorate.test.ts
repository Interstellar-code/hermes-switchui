import { describe, expect, it } from 'vitest'
import { applyFiltersAndDecorate } from './apply-filters-and-decorate'
import type { SessionFeedItem } from './sessions-feed-types'
import type { FilterState } from '@/stores/sessions-filter-store'
import type { LocalState } from '@/stores/sessions-local-store'
import type { SessionProjectMap } from '@/lib/projects-types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeItem(
  overrides: Partial<SessionFeedItem> & { id: string },
): SessionFeedItem {
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

function makeFilter(
  overrides: Partial<FilterState> = {},
): Pick<
  FilterState,
  'sources' | 'state' | 'query' | 'dateRange' | 'sort' | 'updatesOnly'
> {
  return {
    sources: [],
    state: 'all',
    query: '',
    dateRange: { from: null, to: null },
    sort: 'recent',
    updatesOnly: false,
    ...overrides,
  }
}

function makeLocal(
  overrides: Partial<LocalState> = {},
): Pick<
  LocalState,
  | 'pinned'
  | 'starred'
  | 'archived'
  | 'lastSeenUpdate'
  | 'seenUpdatesInitialized'
> {
  return {
    pinned: [],
    starred: [],
    archived: [],
    lastSeenUpdate: {},
    seenUpdatesInitialized: false,
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
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sources: [] }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(3)
  })

  it('a selected source is hidden, not the only one shown', () => {
    const items = [
      makeItem({ id: 'chat:a', src: 'chat' }),
      makeItem({ id: 'task:b', src: 'task' }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sources: ['chat'] }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
    expect(
      result.groups.flatMap((g) => g.items).every((i) => i.src === 'task'),
    ).toBe(true)
  })

  it('state filter = live shows only live items', () => {
    const items = [
      makeItem({ id: 'chat:a', state: 'live' }),
      makeItem({ id: 'chat:b', state: 'idle' }),
      makeItem({ id: 'chat:c', state: 'complete' }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ state: 'live' }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:a')
  })

  it('marks a completed background update and never marks a live session as updated', () => {
    const result = applyFiltersAndDecorate(
      [
        makeItem({ id: 'chat:updated', when: 20 }),
        makeItem({ id: 'chat:live', when: 20, live: true, state: 'live' }),
      ],
      makeFilter(),
      makeLocal({
        seenUpdatesInitialized: true,
        lastSeenUpdate: { 'chat:updated': 10, 'chat:live': 10 },
      }),
    )

    const byId = Object.fromEntries(
      result.groups
        .flatMap((group) => group.items)
        .map((item) => [item.id, item]),
    )
    expect(byId['chat:updated'].hasUnseenUpdate).toBe(true)
    expect(byId['chat:live'].hasUnseenUpdate).toBe(false)
  })

  it('updates-only excludes read and live sessions', () => {
    const result = applyFiltersAndDecorate(
      [
        makeItem({ id: 'chat:updated', when: Date.UTC(2025, 0, 1) }),
        makeItem({ id: 'chat:read', when: Date.UTC(2025, 0, 1) }),
        makeItem({
          id: 'chat:live',
          when: Date.UTC(2025, 0, 1),
          live: true,
          state: 'live',
        }),
      ],
      makeFilter({
        updatesOnly: true,
        dateRange: { from: '2026-01-01', to: '2026-01-31' },
      }),
      makeLocal({
        seenUpdatesInitialized: true,
        lastSeenUpdate: {
          'chat:updated': 10,
          'chat:read': Date.UTC(2025, 0, 1),
          'chat:live': 10,
        },
      }),
    )

    expect(
      result.groups.flatMap((group) => group.items).map((item) => item.id),
    ).toEqual(['chat:updated'])
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
    const result = applyFiltersAndDecorate(
      items,
      makeFilter(),
      makeLocal({ archived: ['chat:b'] }),
    )
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
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ state: 'archived' }),
      local,
    )
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
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ query: 'hello' }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:a')
  })

  it('search matches sub field', () => {
    const items = [
      makeItem({ id: 'chat:a', title: 'Session', sub: 'last message preview' }),
      makeItem({ id: 'chat:b', title: 'Other', sub: null }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ query: 'PREVIEW' }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
  })

  it('search matches session ids and source metadata with fuzzy separators', () => {
    const items = [
      makeItem({
        id: 'chat:cron_70f2affe1860_20260608_040005',
        title: 'Daily Brief',
        sourceMeta: {
          key: 'cron_70f2affe1860_20260608_040005',
          friendlyId: 'cron_70f2affe1860_20260608_040005',
        },
      }),
      makeItem({ id: 'chat:other', title: 'Other' }),
    ]

    const exact = applyFiltersAndDecorate(
      items,
      makeFilter({ query: 'cron_70f2affe1860_20260608_040005' }),
      makeLocal(),
    )
    expect(exact.totalCount).toBe(1)

    const fuzzy = applyFiltersAndDecorate(
      items,
      makeFilter({ query: 'cron 70f2 040005' }),
      makeLocal(),
    )
    expect(fuzzy.totalCount).toBe(1)
    expect(fuzzy.groups.flatMap((g) => g.items)[0].id).toBe(
      'chat:cron_70f2affe1860_20260608_040005',
    )
  })

  it('date range: items before from are excluded', () => {
    const items = [
      makeItem({
        id: 'chat:a',
        when: new Date('2025-01-15').getTime(),
        day: 'earlier',
      }),
      makeItem({
        id: 'chat:b',
        when: new Date('2025-03-01').getTime(),
        day: 'earlier',
      }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ dateRange: { from: '2025-02-01', to: null } }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:b')
  })

  it('date range: items after to are excluded (inclusive to-day)', () => {
    const items = [
      makeItem({
        id: 'chat:a',
        when: new Date('2025-01-15').getTime(),
        day: 'earlier',
      }),
      makeItem({
        id: 'chat:b',
        when: new Date('2025-03-01').getTime(),
        day: 'earlier',
      }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ dateRange: { from: null, to: '2025-02-01' } }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:a')
  })

  it('a search matches outside the date window (search bypasses dateRange)', () => {
    const items = [
      makeItem({
        id: 'chat:old',
        title: 'needle in the archive',
        when: new Date('2024-06-01').getTime(),
        day: 'earlier',
      }),
      makeItem({ id: 'chat:new', title: 'unrelated', day: 'today' }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({
        query: 'needle',
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
      }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(1)
    expect(result.groups.flatMap((g) => g.items)[0].id).toBe('chat:old')
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
      makeItem({
        id: 'chat:yesterday',
        when: now - 86400001,
        day: 'yesterday',
      }),
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
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ state: 'archived' }),
      makeLocal(),
    )
    const item = result.groups.flatMap((g) => g.items)[0]
    expect(item).toBeDefined()
    expect(item.archived).toBe(true)
  })

  it('sort = recent: most recent first', () => {
    const items = [
      makeItem({ id: 'chat:old', when: 1000 }),
      makeItem({ id: 'chat:new', when: 9000 }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sort: 'recent' }),
      makeLocal(),
    )
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids[0]).toBe('chat:new')
  })

  it('sort = tokens: highest tokens first', () => {
    const items = [
      makeItem({ id: 'chat:a', tokens: 100 }),
      makeItem({ id: 'chat:b', tokens: 500 }),
      makeItem({ id: 'chat:c', tokens: 50 }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sort: 'tokens' }),
      makeLocal(),
    )
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids[0]).toBe('chat:b')
  })

  it.skip('sort = source: grouped by source order', () => {
    const items = [
      makeItem({ id: 'task:a', src: 'task' }),
      makeItem({ id: 'chat:a', src: 'chat' }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sort: 'source' }),
      makeLocal(),
    )
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids[0]).toBe('chat:a')
  })

  it('sourceCounts ignores current source filter', () => {
    const items = [
      makeItem({ id: 'chat:a', src: 'chat', state: 'idle' }),
      makeItem({ id: 'task:a', src: 'task', state: 'idle' }),
      makeItem({ id: 'cron:a', src: 'cron', state: 'idle' }),
    ]
    // Hide chat; every chip still shows what it would contribute.
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sources: ['chat'] }),
      makeLocal(),
    )
    expect(result.sourceCounts['chat']).toBe(1)
    expect(result.sourceCounts['task']).toBe(1)
    expect(result.sourceCounts['cron']).toBe(1)
    // But totalCount reflects the hidden source
    expect(result.totalCount).toBe(2)
  })

  it('sourceCounts respects state+search+date filters', () => {
    const items = [
      makeItem({ id: 'chat:a', src: 'chat', state: 'live' }),
      makeItem({ id: 'chat:b', src: 'chat', state: 'idle' }),
      makeItem({ id: 'task:a', src: 'task', state: 'live' }),
    ]
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sources: [], state: 'live' }),
      makeLocal(),
    )
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
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ query: 'zzznomatch' }),
      makeLocal(),
    )
    expect(result.totalCount).toBe(0)
    expect(result.groups).toEqual([])
  })
})

describe('applyFiltersAndDecorate — grouping', () => {
  const project = (
    id: string,
    name: string,
    archived = false,
  ): SessionProjectMap['projects'][number] => ({
    id,
    slug: id,
    name,
    icon: null,
    color: '#f00',
    archived,
    board_slug: null,
  })

  const map: SessionProjectMap = {
    version: 'v1',
    projects: [
      project('p-old', 'Old', true),
      project('p-a', 'Alpha'),
      project('p-empty', 'Empty'),
      project('p-b', 'Beta'),
    ],
    sessions: {
      a1: 'p-a',
      b1: 'p-b',
      old1: 'p-old',
      pin1: 'p-a',
      'run:x': 'p-b',
      gone: 'p-a',
      ghost: 'p-missing',
    },
  }

  const now = Date.now()
  const items = [
    makeItem({ id: 'chat:a1', when: now - 1 }),
    makeItem({ id: 'chat:b1', when: now - 2 }),
    makeItem({ id: 'chat:old1', when: now - 3 }),
    makeItem({ id: 'chat:pin1', when: now - 4 }),
    makeItem({ id: 'chat:loose', when: now - 5, day: 'earlier' }),
    makeItem({ id: 'cron:run:x', src: 'cron', when: now - 6 }),
    makeItem({ id: 'cron:job', src: 'cron', when: now - 7 }),
    makeItem({ id: 'chat:ghost', when: now - 8 }),
  ]
  const local = makeLocal({ pinned: ['chat:pin1'] })

  it('date mode output carries key/kind and keeps day grouping', () => {
    const result = applyFiltersAndDecorate(items, makeFilter(), local)
    expect(result.groups.map((g) => [g.key, g.kind, g.label])).toEqual([
      ['pinned', 'pinned', 'Pinned'],
      ['day:Today', 'day', 'Today'],
      ['day:Earlier', 'day', 'Earlier'],
    ])
  })

  it('without a map project mode falls back to date grouping', () => {
    const result = applyFiltersAndDecorate(items, makeFilter(), local, {
      groupBy: 'project',
      map: null,
    })
    expect(result.groups.map((g) => g.key)).toEqual([
      'pinned',
      'day:Today',
      'day:Earlier',
    ])
  })

  it('project mode: pinned, live projects in map order, archived, unfiled', () => {
    const result = applyFiltersAndDecorate(items, makeFilter(), local, {
      groupBy: 'project',
      map,
    })
    expect(result.groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual(
      [
        ['pinned', ['chat:pin1']],
        ['project:p-a', ['chat:a1']],
        ['project:p-b', ['chat:b1', 'cron:run:x']],
        ['project:p-old', ['chat:old1']],
        ['unfiled', ['chat:loose', 'cron:job', 'chat:ghost']],
      ],
    )
    const alpha = result.groups[1]
    expect(alpha).toMatchObject({
      label: 'Alpha',
      kind: 'project',
      color: '#f00',
      archived: false,
    })
    expect(result.groups[3].archived).toBe(true)
    expect(result.groups[4]).toMatchObject({
      label: 'Unfiled',
      kind: 'unfiled',
    })
    expect(result.totalCount).toBe(items.length)
  })

  it('project mode respects filters', () => {
    const result = applyFiltersAndDecorate(
      items,
      makeFilter({ sources: ['cron'] }),
      local,
      { groupBy: 'project', map },
    )
    const ids = result.groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids).not.toContain('cron:run:x')
    expect(ids).not.toContain('cron:job')
  })
  it('withTotals attaches server folder counts and keeps empty folders with a total', () => {
    const counted = {
      ...map,
      counts: { 'p-a': 41, 'p-b': 2, 'p-empty': 5 },
      unfiled: 77,
    }
    const result = applyFiltersAndDecorate(items, makeFilter(), local, {
      groupBy: 'project',
      map: counted,
      withTotals: true,
    })
    expect(result.groups.map((g) => [g.key, g.items.length, g.total])).toEqual([
      ['pinned', 1, undefined],
      ['project:p-a', 1, 40], // pin1 (p-a) is shown under Pinned
      ['project:p-empty', 0, 5],
      ['project:p-b', 2, 2],
      ['project:p-old', 1, 0],
      ['unfiled', 3, 77],
    ])
    // A count-affecting filter drops the server totals and the empty folder.
    const filtered = applyFiltersAndDecorate(items, makeFilter(), local, {
      groupBy: 'project',
      map: counted,
      withTotals: false,
    })
    expect(filtered.groups.some((g) => g.total !== undefined)).toBe(false)
    expect(filtered.groups.map((g) => g.key)).not.toContain('project:p-empty')
  })

  it('folder totals exclude pinned and locally archived sessions of that folder', () => {
    const counted = {
      ...map,
      counts: { 'p-a': 10, 'p-b': 2 },
      unfiled: 5,
    }
    const result = applyFiltersAndDecorate(
      items,
      makeFilter(),
      makeLocal({ pinned: ['chat:pin1'], archived: ['chat:b1', 'chat:loose'] }),
      { groupBy: 'project', map: counted, withTotals: true },
    )
    const total = (key: string) =>
      result.groups.find((g) => g.key === key)?.total
    expect(total('project:p-a')).toBe(9) // pin1 shows under Pinned
    expect(total('project:p-b')).toBe(1) // b1 archived locally
    expect(total('unfiled')).toBe(4) // loose archived locally
  })

  it('inherited sessions group under their folder and carry the folder name', () => {
    const result = applyFiltersAndDecorate(items, makeFilter(), local, {
      groupBy: 'project',
      map: { ...map, inherited: { a1: true } },
    })
    const alpha = result.groups.find((g) => g.key === 'project:p-a')!
    expect(alpha.items[0]).toMatchObject({
      id: 'chat:a1',
      inheritedFolder: 'Alpha',
    })
    const beta = result.groups.find((g) => g.key === 'project:p-b')!
    expect(beta.items[0].inheritedFolder).toBeUndefined()
  })
})
