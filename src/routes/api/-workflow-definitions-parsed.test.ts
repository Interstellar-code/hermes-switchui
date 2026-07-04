import { describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'
import { Route } from './workflow-definitions.$id.parsed'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: vi.fn(),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: {
        GET: (ctx: { request: Request; params: { id: string } }) => Promise<Response>
      }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.GET

describe('GET /api/workflow-definitions/:id/parsed', () => {
  it('keeps legacy model/provider readable without projecting provider as an editable field', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(getEngine).mockReturnValue({
      getDefinition: vi.fn().mockResolvedValue({
        id: 'wf-1',
        name: 'Legacy Workflow',
        description: 'legacy',
        checksum: 'abc123',
        yaml: [
          'name: Legacy Workflow',
          'description: legacy',
          'nodes:',
          '  - id: analyze',
          '    prompt: "hello"',
          '    provider: codex',
          '    model: gpt-5.4',
        ].join('\n'),
      }),
    } as never)

    const res = await handler({
      request: new Request('http://localhost/api/workflow-definitions/wf-1/parsed'),
      params: { id: 'wf-1' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parsed.nodes[0]).not.toHaveProperty('provider')
    expect(body.parsed.nodes[0].model_hint).toBe('gpt-5.4')
    expect(body.parsed.nodes[0].config_preview).toContain('provider')
    expect(body.parsed.nodes[0].config_preview).toContain('model')
  })
})
