import { describe, expect, it } from 'vitest'
import {
  decodeDataUrlText,
  isTextLikeFile,
} from './chat-composer-attachments'

describe('isTextLikeFile', () => {
  it.each([
    ['a.ts', 'video/mp2t', true],
    ['a.csv', 'application/vnd.ms-excel', true],
    ['a.md', '', true],
    ['Dockerfile', '', true],
    ['a.pdf', 'application/pdf', false],
    ['a.png', 'image/png', false],
  ])('(%s, %s) → %s', (name, mime, expected) => {
    expect(isTextLikeFile(name, mime)).toBe(expected)
  })
})

describe('decodeDataUrlText', () => {
  it('decodes base64 payloads as UTF-8', () => {
    const b64 = Buffer.from('héllo ✓', 'utf8').toString('base64')
    expect(decodeDataUrlText(`data:text/plain;base64,${b64}`)).toBe('héllo ✓')
  })

  it('decodes percent-encoded (non-base64) payloads', () => {
    expect(decodeDataUrlText('data:text/plain,hello%20world')).toBe(
      'hello world',
    )
  })
})
