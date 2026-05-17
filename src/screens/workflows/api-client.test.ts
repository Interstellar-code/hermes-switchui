import { afterEach, describe, expect, it, vi } from 'vitest'

import { chatWorkflowWizard } from './api-client'

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
