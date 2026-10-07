import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  WorkflowEngineUnavailableError,
  cancelWorkflowRun,
  chatWorkflowWizard,
  getWorkflowDefinitionVersion,
  getWorkflowFeatures,
  listRunEvents,
  listRunEventsPaged,
  listWorkflowDefinitionVersions,
  listWorkflowDefinitions,
  resetWorkflowDefinitionToFactory,
  validateWorkflowDefinition,
} from './api-client'

function createEventStream(events: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event))
      }
      controller.close()
    },
  })
}

describe('chatWorkflowWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses the same send-stream transport with the gateway session model', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            payload: { model: 'anthropic/claude-sonnet-test' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          createEventStream([
            'event: chunk\n',
            'data: {"text":"{\\"reply\\":\\"ok\\",\\"stage\\":\\"clarify\\",\\"workflow_yaml\\":\\"name: Test\\\\ndescription: Test\\\\nnodes: []\\\\n\\"}"}\n\n',
          ]),
          {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'X-Hermes-Session-Key': 'wizard-session',
            },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchSpy)

    const result = await chatWorkflowWizard({
      sessionId: 'new',
      message: 'hi',
      currentYaml: 'name: Current\nnodes: []\n',
    })

    expect(result.sessionId).toBe('wizard-session')
    expect(result.reply).toBe('ok')
    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/session-status')

    const [, sendInit] = fetchSpy.mock.calls[1]
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/send-stream')
    const body = JSON.parse(String((sendInit as RequestInit).body)) as Record<
      string,
      unknown
    >
    expect(body).toMatchObject({
      sessionKey: 'new',
      friendlyId: 'new',
      model: 'anthropic/claude-sonnet-test',
    })
    expect(String(body.message)).toContain(
      'You are Hermes, the workflow-authoring assistant inside Hermes Switch UI.',
    )
  })

  it('keeps using send-stream when session-status cannot resolve a model', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          createEventStream([
            'event: chunk\n',
            'data: {"text":"plain assistant text"}\n\n',
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )

    vi.stubGlobal('fetch', fetchSpy)

    const result = await chatWorkflowWizard({
      message: 'hello',
      currentYaml: 'name: Current\nnodes: []\n',
    })

    expect(result.reply).toBe('plain assistant text')
    const body = JSON.parse(
      String((fetchSpy.mock.calls[1][1] as RequestInit).body),
    ) as Record<string, unknown>
    expect(body).toMatchObject({ sessionKey: 'main', friendlyId: 'main' })
    expect(body).not.toHaveProperty('model')
  })

  it('prefers the same persisted main-chat model override used by Switch UI chat', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(
          createEventStream([
            'event: chunk\n',
            'data: {"text":"plain assistant text"}\n\n',
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) =>
          key === 'hermes-session-model'
            ? JSON.stringify({
                state: { models: { main: 'hermes-agent' } },
                version: 0,
              })
            : null,
      },
    })

    await chatWorkflowWizard({
      message: 'hello',
      currentYaml: 'name: Current\nnodes: []\n',
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body),
    ) as Record<string, unknown>
    expect(body).toMatchObject({
      sessionKey: 'main',
      friendlyId: 'main',
      model: 'hermes-agent',
    })
  })
})

describe('cancelWorkflowRun / listRunEvents / getWorkflowFeatures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('cancel POSTs JSON content-type with a body (CSRF guard)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchSpy)
    await cancelWorkflowRun('r 1')
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/workflow-runs/r%201?action=cancel')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe('{}')
  })

  it('listRunEvents builds the query and maps 404 to null', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"events":[]}'))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)
    await listRunEvents('r1', { limit: 5, node_run_id: 'n1', after: 'c' })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      '/api/workflow-runs/r1/events?limit=5&node_run_id=n1&after=c',
    )
    expect(await listRunEvents('r1')).toBeNull()
  })

  it('listRunEventsPaged pages with after=cursor until a short page or the cap', async () => {
    const page = (n: number, cursor: number) =>
      new Response(
        JSON.stringify({
          events: Array.from({ length: n }, () => ({})),
          cursor,
        }),
      )
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(page(2, 2))
      .mockResolvedValueOnce(page(1, 3))
    vi.stubGlobal('fetch', fetchSpy)
    const r = await listRunEventsPaged('r1', { limit: 2 })
    expect(r).toMatchObject({ complete: true, cursor: 3 })
    expect(r?.events).toHaveLength(3)
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
      '/api/workflow-runs/r1/events?limit=2&after=0',
      '/api/workflow-runs/r1/events?limit=2&after=2',
    ])
    fetchSpy.mockReset().mockImplementation(() => Promise.resolve(page(2, 9)))
    const capped = await listRunEventsPaged('r1', { limit: 2 }, 2)
    expect(capped).toMatchObject({ complete: false })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('getWorkflowFeatures never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    expect((await getWorkflowFeatures()).features).toEqual([])
  })
})

describe('listWorkflowDefinitions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('throws WorkflowEngineUnavailableError when engine_ok is false', async () => {
    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            definitions: [],
            engine_ok: false,
            error: 'Workflow engine unavailable',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await expect(listWorkflowDefinitions()).rejects.toThrow(
      WorkflowEngineUnavailableError,
    )

    try {
      await listWorkflowDefinitions()
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(WorkflowEngineUnavailableError)
      expect((err as WorkflowEngineUnavailableError).name).toBe(
        'WorkflowEngineUnavailableError',
      )
      expect((err as Error).message).toBe('Workflow engine unavailable')
    }
  })

  it('returns definitions when engine_ok is true', async () => {
    const mockDefs = [
      {
        id: 'wf-1',
        name: 'Workflow 1',
        source: 'project',
        node_count: 3,
      },
    ]
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          definitions: mockDefs,
          engine_ok: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const result = await listWorkflowDefinitions()
    expect(result).toEqual(mockDefs)
  })

  it('treats missing engine_ok as ok (older server compatibility)', async () => {
    const mockDefs = [
      {
        id: 'wf-legacy',
        name: 'Legacy Server Workflow',
        source: 'bundled',
        node_count: 1,
      },
    ]
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          definitions: mockDefs,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const result = await listWorkflowDefinitions()
    expect(result).toEqual(mockDefs)
  })

  it('throws on non-200 HTTP response', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('Internal Server Error', { status: 500 }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(listWorkflowDefinitions()).rejects.toThrow(
      'listWorkflowDefinitions failed (500)',
    )
  })
})

describe('validateWorkflowDefinition', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('calls POST /api/workflow-definitions/validate with yaml and optional id', async () => {
    const mockRes = {
      ok: true,
      errors: [],
      warnings: [],
      id_available: true,
    }
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockRes), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const res = await validateWorkflowDefinition('name: test', 'my-id')
    expect(res).toEqual(mockRes)
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflow-definitions/validate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: 'name: test', id: 'my-id' }),
      },
    )
  })

  it('throws WorkflowEngineUnavailableError on 503 or engine_ok: false', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          engine_ok: false,
          error: 'Engine down',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await expect(validateWorkflowDefinition('name: test')).rejects.toThrow(
      WorkflowEngineUnavailableError,
    )
  })
})

describe('listWorkflowDefinitionVersions / getWorkflowDefinitionVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const LIST = [
    {
      checksum: 'cc11ac2f5033',
      version: null,
      saved_at: 1791315040892,
      source: 'save',
      node_count: 2,
      size_bytes: 117,
      in_use_by_runs: 0,
    },
  ]

  it('unwraps { versions } from the route', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ versions: LIST }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const versions = await listWorkflowDefinitionVersions('wf-1')
    expect(versions).toEqual(LIST)
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflow-definitions/wf-1/versions',
      undefined,
    )
  })

  it('throws WorkflowEngineUnavailableError when the engine is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            engine_ok: false,
            error: 'Workflow engine unavailable',
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(listWorkflowDefinitionVersions('wf-1')).rejects.toThrow(
      WorkflowEngineUnavailableError,
    )
  })

  it('surfaces 404 with a status on the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const err = await listWorkflowDefinitionVersions('ghost').catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as { status?: number }).status).toBe(404)
  })

  it('unwraps { version } for a single snapshot', async () => {
    const detail = {
      ...LIST[0],
      yaml: 'name: demo\nnodes:\n  - id: a\n    prompt: hi\n',
      parsed: { id: 'demo', nodes: [] },
    }
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: detail }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const version = await getWorkflowDefinitionVersion('wf-1', 'cc11ac2f5033')
    expect(version.yaml).toContain('name: demo')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workflow-definitions/wf-1/versions/cc11ac2f5033',
      undefined,
    )
  })
})

describe('resetWorkflowDefinitionToFactory (F8 review HIGH)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('POSTs JSON with a Content-Type the route guard accepts', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ definition: { id: 'wf-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await resetWorkflowDefinitionToFactory('wf-1')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit | undefined,
    ]
    expect(String(url)).toBe('/api/workflow-definitions/wf-1/reset-factory')
    expect(init?.method).toBe('POST')
    // The route's requireJsonContentType returns 415 without this header.
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/json',
    )
    expect(init?.body).toBe('{}')
  })
})
