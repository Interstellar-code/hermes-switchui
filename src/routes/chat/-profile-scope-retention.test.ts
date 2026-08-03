// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { Route as ChatSessionRoute } from './$sessionKey'

/**
 * F1 — `?profile=` must survive every navigation into `/chat/$sessionKey`.
 *
 * A conversation that loses its profile mid-thread keeps streaming and returns
 * 200 while writing the rest of itself into another profile's `state.db`. The
 * guarantee therefore cannot live at the call sites: it is a search middleware
 * on the destination route, and these tests drive the real router against the
 * real route's `search` config so deleting that config fails them.
 */
function buildRouter(initialEntry: string) {
  const rootRoute = createRootRoute({})
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$sessionKey',
    // The subject under test: whatever the real route declares.
    validateSearch: ChatSessionRoute.options.validateSearch,
    search: ChatSessionRoute.options.search,
    component: () => null,
  })
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard',
    component: () => null,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([chatRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
}

describe('chat route profile retention', () => {
  it('carries ?profile= across a session-to-session navigation', async () => {
    const router = buildRouter('/chat/session-a?profile=neo')
    await router.load()

    // The shape use-composer-send fires after the first message of a new chat:
    // params only, no `search`.
    await router.navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'session-b' },
      replace: true,
    })
    await router.invalidate()

    expect(router.state.location.pathname).toBe('/chat/session-b')
    expect(router.state.location.search).toEqual({ profile: 'neo' })
  })

  it('lets an explicit profile change win over retention', async () => {
    const router = buildRouter('/chat/session-a?profile=neo')
    await router.load()

    await router.navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'session-a' },
      search: { profile: 'morpheus' },
    })
    await router.invalidate()

    expect(router.state.location.search).toEqual({ profile: 'morpheus' })
  })

  it('lets an explicit clear win over retention', async () => {
    const router = buildRouter('/chat/session-a?profile=neo')
    await router.load()

    // The composer's profile picker clears by setting the key to `undefined`
    // rather than omitting it — an omitted key reads as "unspecified" and
    // would be refilled by the retention middleware.
    await router.navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'session-a' },
      search: { profile: undefined },
    })
    await router.invalidate()

    expect(router.state.location.searchStr).toBe('')
  })

  it('treats an omitted key as unspecified, not as a clear', async () => {
    // Pins the contract session-selectors-v2 depends on: dropping the key
    // cannot clear the scope, which is why its picker sends `undefined`.
    const router = buildRouter('/chat/session-a?profile=neo')
    await router.load()

    await router.navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'session-a' },
      search: {},
    })
    await router.invalidate()

    expect(router.state.location.search).toEqual({ profile: 'neo' })
  })

  it('does not invent a profile for an unscoped chat', async () => {
    const router = buildRouter('/chat/session-a')
    await router.load()

    await router.navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'session-b' },
    })
    await router.invalidate()

    expect(router.state.location.searchStr).toBe('')
  })
})
