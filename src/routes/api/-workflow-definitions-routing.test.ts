/**
 * Routing precedence for the workflow-definitions API tree (FIX1).
 *
 * `/api/workflow-definitions/validate` is a static sibling of the `$id`
 * route; the router must send it to workflow-definitions.validate.ts, not
 * to workflow-definitions.$id.ts (which only implements GET/DELETE and
 * would strand the POST). Same check for the versions sub-routes.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../../routeTree.gen'

interface ProbeMatch {
  routeId: string
  params: Record<string, string>
}

function match(path: string): Array<ProbeMatch> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const matches = router.matchRoutes(path) as unknown as Array<ProbeMatch>
  return matches
}

describe('workflow-definitions route precedence', () => {
  it('sends /api/workflow-definitions/validate to the static validate route, not $id', () => {
    const leaf = match('/api/workflow-definitions/validate').at(-1)
    expect(leaf?.routeId).toBe('/api/workflow-definitions/validate')
    expect(leaf?.params).toEqual({})
  })

  it('still sends other single segments to $id', () => {
    const leaf = match('/api/workflow-definitions/youtube-catalog-intake').at(
      -1,
    )
    expect(leaf?.routeId).toBe('/api/workflow-definitions/$id')
    expect(leaf?.params).toEqual({ id: 'youtube-catalog-intake' })
  })

  it('sends /:id/versions and /:id/versions/:checksum to the versions routes', () => {
    expect(
      match('/api/workflow-definitions/wf-1/versions').at(-1)?.routeId,
    ).toBe('/api/workflow-definitions/$id/versions')
    expect(
      match('/api/workflow-definitions/wf-1/versions/cc11ac2f').at(-1)?.routeId,
    ).toBe('/api/workflow-definitions/$id/versions/$checksum')
  })
})
