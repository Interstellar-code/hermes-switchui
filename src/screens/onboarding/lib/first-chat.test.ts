import { describe, expect, it } from 'vitest'

import { looksLikeCredentialFailure, parseFirstChatStream } from './first-chat'

function sse(events: Array<[string, unknown]>): string {
  return events
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('')
}

describe('parseFirstChatStream', () => {
  it('accumulates chunk text', () => {
    const body = sse([
      ['chunk', { text: 'Yes, ' }],
      ['chunk', { text: 'I can hear you.' }],
    ])
    expect(parseFirstChatStream(body)).toEqual({
      reply: 'Yes, I can hear you.',
      error: null,
    })
  })

  it('honours fullReplace instead of appending', () => {
    // The portable backend sends every chunk as a full replacement, so
    // appending blindly produces the answer N times over.
    const body = sse([
      ['chunk', { text: 'Yes', fullReplace: true }],
      ['chunk', { text: 'Yes, I can hear you.', fullReplace: true }],
    ])
    expect(parseFirstChatStream(body).reply).toBe('Yes, I can hear you.')
  })

  it('prefers the authoritative text on the done event', () => {
    const body = sse([
      ['chunk', { text: 'part' }],
      [
        'done',
        {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'The whole answer.' }],
          },
        },
      ],
    ])
    expect(parseFirstChatStream(body).reply).toBe('The whole answer.')
  })

  it("returns the gateway's error verbatim", () => {
    const body = sse([
      ['error', { message: 'Error code: 401 - invalid x-api-key' }],
    ])
    expect(parseFirstChatStream(body)).toEqual({
      reply: '',
      error: 'Error code: 401 - invalid x-api-key',
    })
  })

  it('handles the non-stream JSON error body a hard failure produces', () => {
    expect(
      parseFirstChatStream('{"ok":false,"error":"provider not configured"}'),
    ).toEqual({ reply: '', error: 'provider not configured' })
  })

  it('does not treat an error payload as content', () => {
    const body = sse([
      ['chunk', { text: 'partial' }],
      ['error', { message: 'stream aborted' }],
    ])
    const parsed = parseFirstChatStream(body)
    expect(parsed.error).toBe('stream aborted')
    expect(parsed.reply).toBe('partial')
  })

  it('never throws on garbage', () => {
    expect(parseFirstChatStream('')).toEqual({ reply: '', error: null })
    expect(parseFirstChatStream('not json at all')).toEqual({
      reply: '',
      error: null,
    })
  })
})

describe('looksLikeCredentialFailure', () => {
  it('recognises the shapes providers actually return', () => {
    for (const message of [
      'Error code: 401 - invalid x-api-key',
      '403 Forbidden',
      'invalid_api_key',
      'authentication_error',
      'No API key provided',
    ]) {
      expect(looksLikeCredentialFailure(message), message).toBe(true)
    }
  })

  it('does not misread an outage as a credential problem', () => {
    for (const message of [
      'connection refused',
      'The provider did not answer within 30 seconds.',
      'model not found',
    ]) {
      expect(looksLikeCredentialFailure(message), message).toBe(false)
    }
  })
})
