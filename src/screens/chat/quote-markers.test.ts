import { describe, expect, it } from 'vitest'
import {
  QUOTE_TEXT_LIMIT,
  formatOutgoingMessage,
  normalizeQuoteText,
  parseMessageMarkers,
} from './quote-markers'

describe('quote markers', () => {
  it('round-trips a multi-line quote with blank lines and indentation', () => {
    const text = 'def f():\n    return 1\n\nprint(f())'
    const out = formatOutgoingMessage({
      quotes: [{ seq: 3, text }],
      replyTo: null,
      body: 'why?',
    })
    expect(out).toBe(
      '> [Quote: #3]\n> def f():\n>     return 1\n>\n> print(f())\n\nwhy?',
    )
    expect(parseMessageMarkers(out)).toEqual({
      quotes: [{ seq: 3, text }],
      reply: null,
      body: 'why?',
    })
  })

  it('stacks multiple quotes followed by a reply marker', () => {
    const out = formatOutgoingMessage({
      quotes: [
        { seq: 1, text: 'first' },
        { seq: 4, text: 'second\nline' },
      ],
      replyTo: { seq: 5, role: 'assistant', preview: 'hello\n  world' },
      body: 'body',
    })
    expect(parseMessageMarkers(out)).toEqual({
      quotes: [
        { seq: 1, text: 'first' },
        { seq: 4, text: 'second\nline' },
      ],
      reply: { seq: 5, snippet: 'hello world' },
      body: 'body',
    })
  })

  it('keeps the legacy reply-only format byte-identical', () => {
    const out = formatOutgoingMessage({
      quotes: [],
      replyTo: { seq: 2, role: 'user', preview: 'x'.repeat(200) },
      body: 'b',
    })
    expect(out).toBe(`> [Re: #2] ${'x'.repeat(140)}…\n\nb`)
  })

  it('parses both legacy reply formats', () => {
    expect(parseMessageMarkers('> [Re: #7] snip\n\nbody').reply).toEqual({
      seq: 7,
      snippet: 'snip',
    })
    expect(parseMessageMarkers('\u200B[reply:#8] s\n\nbody')).toEqual({
      quotes: [],
      reply: { seq: 8, snippet: 's' },
      body: 'body',
    })
  })

  it('leaves ordinary content and later blockquotes untouched', () => {
    const plain = '> just a normal quote\n\ntext'
    expect(parseMessageMarkers(plain)).toEqual({
      quotes: [],
      reply: null,
      body: plain,
    })
    const out = formatOutgoingMessage({
      quotes: [{ seq: 1, text: 'q' }],
      replyTo: null,
      body: '> mine\nrest',
    })
    expect(parseMessageMarkers(out).body).toBe('> mine\nrest')
  })

  it('normalizes CRLF, trailing spaces, blank runs and caps length', () => {
    expect(normalizeQuoteText('\r\n a  \r\n\r\n\r\n\r\nb \r\n')).toBe(' a\n\nb')
    const capped = normalizeQuoteText('y'.repeat(QUOTE_TEXT_LIMIT + 10))
    expect(capped).toHaveLength(QUOTE_TEXT_LIMIT + 1)
    expect(capped.endsWith('…')).toBe(true)
  })
})
