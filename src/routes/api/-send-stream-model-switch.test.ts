import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parseModelErrorEnvelope } from './send-stream'

/**
 * Task #24 — `POST /api/sessions/{id}/chat[/stream]` now reads `model` from
 * the body. The refusal arrives as a plain JSON 400 BEFORE the SSE stream
 * opens, so `streamChat` raises it as a thrown Error rather than an SSE
 * `error` frame; this route has to dig the gateway's own envelope back out.
 */

describe('parseModelErrorEnvelope', () => {
  const thrown =
    'Hermes chat stream: 400 {"error":{"message":"Model \\"nope\\" is not available.",' +
    '"type":"invalid_request_error","param":"model","code":"model_not_available"}}'

  it('recovers the envelope from the wrapped throw message', () => {
    expect(parseModelErrorEnvelope(thrown)).toEqual({
      message: 'Model "nope" is not available.',
      code: 'model_not_available',
      param: 'model',
    })
  })

  it('recognises invalid_model (non-string/empty value) without a param', () => {
    expect(
      parseModelErrorEnvelope(
        'Hermes chat stream: 400 {"error":{"message":"bad model","code":"invalid_model"}}',
      ),
    ).toEqual({ message: 'bad model', code: 'invalid_model', param: null })
  })

  it('leaves unrelated upstream failures on the existing error path', () => {
    expect(
      parseModelErrorEnvelope(
        'Hermes chat stream: 502 {"error":{"message":"upstream down","code":"bad_gateway"}}',
      ),
    ).toBe(null)
    expect(parseModelErrorEnvelope('Hermes chat stream: 502 ')).toBe(null)
    expect(parseModelErrorEnvelope('ECONNREFUSED')).toBe(null)
  })
})

describe('send-stream model-switch wiring', () => {
  const source = readFileSync(
    new URL('./send-stream.ts', import.meta.url),
    'utf8',
  )

  it('forwards the model on the chat/stream request body', () => {
    expect(source).toContain(
      "model:\n                      typeof body.model === 'string' ? body.model : undefined,",
    )
  })

  it('forwards the effective model reported on run.started', () => {
    expect(source).toContain("if (event === 'run.started') {")
    expect(source).toContain('const effectiveModel = readString(data.model)')
    expect(source).toContain("sendEvent('model_effective', {")
  })

  it('relays a model refusal as a flagged error event, not a generic one', () => {
    expect(source).toContain('const modelError = parseModelErrorEnvelope(')
    expect(source).toContain('modelError: {')
  })
})
