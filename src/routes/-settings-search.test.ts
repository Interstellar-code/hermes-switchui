// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  DEFAULT_SECTION,
  searchForSection,
  sectionFromSearch,
  settingsSearchSchema,
} from '@/screens/settings/lib/settings-search'

/**
 * `/settings` deep links, driven through a **real** router.
 *
 * The section used to live in `useState` seeded from
 * `localStorage['hermes.settings.section']`, so none of this was possible: no
 * shareable link, no back button, and callers "navigated" by writing that key
 * and hoping. These tests pin the two rules that are easy to regress — a bare
 * `/settings` stays bare, and an unknown section never errors the route.
 *
 * The schema is asserted directly rather than through `Route.options`: the real
 * route module imports the whole Settings screen (and two stylesheets) and this
 * file only cares about the search contract. `settings-search.test.ts` covers
 * the pure functions; `src/routes/settings/index.tsx` is the single place that
 * wires this schema in.
 */
function buildRouter(initialEntry: string) {
  const rootRoute = createRootRoute({})
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    validateSearch: settingsSearchSchema,
    component: () => null,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([settingsRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
}

function selectSection(
  router: ReturnType<typeof buildRouter>,
  id: string,
) {
  // Exactly what `SettingsRoute`'s single writer does.
  return router.navigate({
    to: '/settings',
    search: (prev: Record<string, unknown>) => ({
      ...prev,
      ...searchForSection(id),
    }),
  })
}

function activeSection(router: ReturnType<typeof buildRouter>): string {
  // `location.search` is the raw parsed query string; `validateSearch`'s output
  // lives on the match, which is what `Route.useSearch()` hands the screen.
  const matches = router.state.matches
  const search = matches[matches.length - 1].search as { section?: string }
  return sectionFromSearch(search)
}

describe('/settings?section= — clean URLs', () => {
  it('starts with no query string at all', async () => {
    const router = buildRouter('/settings')
    await router.load()
    expect(router.state.location.searchStr).toBe('')
    expect(activeSection(router)).toBe(DEFAULT_SECTION)
  })

  it('writes the section the user picked', async () => {
    const router = buildRouter('/settings')
    await router.load()
    await selectSection(router, 'safety')
    await router.invalidate()
    expect(router.state.location.search).toEqual({ section: 'safety' })
    expect(activeSection(router)).toBe('safety')
  })

  it('clears the param again when the default section is selected', async () => {
    const router = buildRouter('/settings?section=safety')
    await router.load()
    await selectSection(router, DEFAULT_SECTION)
    await router.invalidate()
    expect(router.state.location.searchStr).toBe('')
  })
})

describe('/settings?section= — deep links survive a reload', () => {
  it('decodes the approval card’s link to Safety', async () => {
    const router = buildRouter('/settings?section=safety')
    await router.load()
    expect(activeSection(router)).toBe('safety')
  })

  it('decodes the ops-strip link to the raw config editor', async () => {
    const router = buildRouter('/settings?section=raw-config')
    await router.load()
    expect(activeSection(router)).toBe('raw-config')
  })

  it('decodes the All-settings browser', async () => {
    const router = buildRouter('/settings?section=all-settings')
    await router.load()
    expect(activeSection(router)).toBe('all-settings')
  })

  it('lands on the default for a stale bookmark instead of erroring', async () => {
    const router = buildRouter('/settings?section=a-section-that-was-deleted')
    await router.load()
    expect(activeSection(router)).toBe(DEFAULT_SECTION)
  })
})

describe('/settings?section= — history behaviour', () => {
  it('moves between sections with the back and forward buttons', async () => {
    const router = buildRouter('/settings')
    await router.load()

    await selectSection(router, 'safety')
    await router.invalidate()
    await selectSection(router, 'execution')
    await router.invalidate()
    expect(activeSection(router)).toBe('execution')

    router.history.back()
    await router.invalidate()
    expect(activeSection(router)).toBe('safety')

    router.history.forward()
    await router.invalidate()
    expect(activeSection(router)).toBe('execution')
  })
})
