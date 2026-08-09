// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { Route as ProfilesRoute } from './profiles'
import type {
  ProfileFilterState,
  ProfilesSearch,
} from '@/stores/profiles-screen-store'
import {
  DEFAULT_FILTERS,
  applyFilterPatch,
  filtersToSearch,
  profilesSearchSchema,
  searchToFilters,
} from '@/stores/profiles-screen-store'

/**
 * G-07 — the Profiles filters live in the URL, so these drive the *real*
 * router against the *real* route's `validateSearch`. Deleting or weakening
 * that config fails them, which a store-level test could not catch.
 */
function buildRouter(initialEntry: string) {
  const rootRoute = createRootRoute({})
  const profilesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/profiles',
    validateSearch: ProfilesRoute.options.validateSearch,
    component: () => null,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([profilesRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
}

/** Exactly what the screen's single writer does. */
function patchFilters(
  router: ReturnType<typeof buildRouter>,
  patch: Partial<ProfileFilterState>,
  replace = false,
) {
  return router.navigate({
    to: '/profiles',
    search: (prev: Record<string, unknown>) => ({
      ...prev,
      ...filtersToSearch(
        applyFilterPatch(
          searchToFilters(profilesSearchSchema.parse(prev)),
          patch,
        ),
      ),
    }),
    replace,
  })
}

/**
 * `location.search` is the *raw* parsed query string; `validateSearch` output
 * lives on the match, which is what `Route.useSearch()` hands the screen.
 */
function validatedSearch(router: ReturnType<typeof buildRouter>): ProfilesSearch {
  const matches = router.state.matches
  return matches[matches.length - 1].search as ProfilesSearch
}

function currentFilters(router: ReturnType<typeof buildRouter>) {
  return searchToFilters(validatedSearch(router))
}

describe('/profiles search params — clean URLs', () => {
  it('starts with no query string at all', async () => {
    const router = buildRouter('/profiles')
    await router.load()
    expect(router.state.location.searchStr).toBe('')
    expect(currentFilters(router)).toEqual(DEFAULT_FILTERS)
  })

  it('writes nothing when a filter is set back to its default', async () => {
    const router = buildRouter('/profiles?tier=2')
    await router.load()
    await patchFilters(router, { tierFilter: 'all' })
    await router.invalidate()
    expect(router.state.location.searchStr).toBe('')
  })

  it('never accumulates all=all=all', async () => {
    const router = buildRouter('/profiles')
    await router.load()
    for (const patch of [
      { tierFilter: 'all' as const },
      { statusFilter: 'all' as const },
      { modelFilter: 'all' },
      { tagFilter: 'all' },
      { search: '' },
      { page: 1 },
    ]) {
      await patchFilters(router, patch)
      await router.invalidate()
    }
    expect(router.state.location.searchStr).toBe('')
  })

  it('writes only what is actually filtered', async () => {
    const router = buildRouter('/profiles')
    await router.load()
    await patchFilters(router, { tierFilter: '2' })
    await router.invalidate()
    await patchFilters(router, { tagFilter: 'review' })
    await router.invalidate()
    expect(router.state.location.search).toEqual({ tier: '2', tag: 'review' })
  })
})

describe('/profiles search params — deep links survive a reload', () => {
  it('decodes a shared "T2 agents tagged review" link', async () => {
    const router = buildRouter('/profiles?tier=2&tag=review')
    await router.load()
    expect(currentFilters(router)).toEqual({
      ...DEFAULT_FILTERS,
      tierFilter: '2',
      tagFilter: 'review',
    })
  })

  it('decodes every filter at once, including the page', async () => {
    const router = buildRouter(
      '/profiles?q=neo&tier=3&status=idle&model=gpt-4o&tag=ops&page=4',
    )
    await router.load()
    expect(currentFilters(router)).toEqual({
      search: 'neo',
      tierFilter: '3',
      statusFilter: 'idle',
      modelFilter: 'gpt-4o',
      tagFilter: 'ops',
      page: 4,
    })
  })

  it('ignores a hand-mangled param instead of erroring the route', async () => {
    const router = buildRouter('/profiles?tier=99&status=zombie&page=-1')
    await router.load()
    expect(currentFilters(router)).toEqual(DEFAULT_FILTERS)
  })
})

describe('/profiles search params — history behaviour', () => {
  it('restores the previous filters on back, and re-applies them on forward', async () => {
    const router = buildRouter('/profiles')
    await router.load()

    await patchFilters(router, { tierFilter: '2' })
    await router.invalidate()
    await patchFilters(router, { statusFilter: 'active' })
    await router.invalidate()
    expect(currentFilters(router)).toMatchObject({
      tierFilter: '2',
      statusFilter: 'active',
    })

    router.history.back()
    await router.invalidate()
    expect(currentFilters(router)).toMatchObject({
      tierFilter: '2',
      statusFilter: 'all',
    })

    router.history.forward()
    await router.invalidate()
    expect(currentFilters(router)).toMatchObject({
      tierFilter: '2',
      statusFilter: 'active',
    })
  })

  it('a replaced search-box write leaves no extra history entry', async () => {
    const router = buildRouter('/profiles')
    await router.load()
    const before = router.history.length

    // What the debounced search box does — one `replace` per settled query.
    await patchFilters(router, { search: 'ne' }, true)
    await router.invalidate()
    await patchFilters(router, { search: 'neo' }, true)
    await router.invalidate()

    expect(router.state.location.search).toEqual({ q: 'neo' })
    expect(router.history.length).toBe(before)
  })
})

describe('/profiles search params — page reset through the URL', () => {
  it('drops ?page= when a filter changes', async () => {
    const router = buildRouter('/profiles?tier=2&page=5')
    await router.load()
    expect(currentFilters(router).page).toBe(5)

    await patchFilters(router, { tierFilter: '3' })
    await router.invalidate()

    expect(router.state.location.search).toEqual({ tier: '3' })
    expect(currentFilters(router).page).toBe(1)
  })

  it('keeps the page when only the page moves', async () => {
    const router = buildRouter('/profiles?tier=2')
    await router.load()
    await patchFilters(router, { page: 3 })
    await router.invalidate()
    expect(router.state.location.search).toEqual({ tier: '2', page: 3 })
  })
})

describe('/profiles search params — wizard deep link', () => {
  it('carries ?edit= and a clamped ?step=', async () => {
    const router = buildRouter('/profiles?edit=custom-agent&step=3')
    await router.load()
    expect(validatedSearch(router)).toMatchObject({
      edit: 'custom-agent',
      step: 3,
    })
  })

  it('clamps an out-of-range step to the last real one', async () => {
    const router = buildRouter('/profiles?edit=custom-agent&step=99')
    await router.load()
    expect(validatedSearch(router).step).toBe(9)
  })

  it('clamps a zero/negative step up to the first', async () => {
    const router = buildRouter('/profiles?edit=custom-agent&step=0')
    await router.load()
    expect(validatedSearch(router).step).toBe(1)
  })

  it('survives a filter change without losing the wizard params', async () => {
    const router = buildRouter('/profiles?edit=custom-agent&step=4')
    await router.load()
    await patchFilters(router, { tierFilter: '2' })
    await router.invalidate()
    expect(router.state.location.search).toEqual({
      edit: 'custom-agent',
      step: 4,
      tier: '2',
    })
  })

  it('closing the wizard clears both params and keeps the filters', async () => {
    const router = buildRouter('/profiles?tier=2&edit=custom-agent&step=4')
    await router.load()
    await router.navigate({
      to: '/profiles',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        edit: undefined,
        step: undefined,
      }),
      replace: true,
    })
    await router.invalidate()
    expect(router.state.location.search).toEqual({ tier: '2' })
  })
})
