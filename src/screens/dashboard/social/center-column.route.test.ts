/**
 * Node environment on purpose: the TanStack Start plugin strips route
 * `server` handlers from client (jsdom) transforms. No mocking of the route
 * module: the dashboard dialogs POST here, so it must really export POST.
 */
import { describe, expect, it } from 'vitest'
import { Route } from '../../../routes/api/workflow-runs.$runId.approve'

describe('approve route', () => {
  it('exists and handles POST', () => {
    const handlers = (
      Route as unknown as {
        options: { server: { handlers: { POST?: unknown } } }
      }
    ).options.server.handlers
    expect(typeof handlers.POST).toBe('function')
  })
})
