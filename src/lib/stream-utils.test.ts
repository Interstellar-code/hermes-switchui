import { describe, expect, it } from 'vitest'
import {
  parseJsonIfPossible,
  readRecord,
  readString,
  stripDataUrlPrefix,
} from './stream-utils'

describe('readString', () => {
  it('returns the trimmed string for string input', () => {
    expect(readString('  hello  ')).toBe('hello')
    expect(readString('hello')).toBe('hello')
    expect(readString('')).toBe('')
    expect(readString('  ')).toBe('')
  })

  it('returns empty string for non-string inputs', () => {
    expect(readString(undefined)).toBe('')
    expect(readString(null)).toBe('')
    expect(readString(42)).toBe('')
    expect(readString(true)).toBe('')
    expect(readString({})).toBe('')
    expect(readString([])).toBe('')
  })
})

describe('readRecord', () => {
  it('returns the object as a record for plain objects', () => {
    const obj = { a: 1, b: 'two' }
    expect(readRecord(obj)).toBe(obj)
  })

  it('returns the object as a record for nested objects', () => {
    const obj = { nested: { x: 1 } }
    expect(readRecord(obj)).toEqual({ nested: { x: 1 } })
  })

  it('returns undefined for non-object inputs', () => {
    expect(readRecord(undefined)).toBeUndefined()
    expect(readRecord(null)).toBeUndefined()
    expect(readRecord('string')).toBeUndefined()
    expect(readRecord(42)).toBeUndefined()
    expect(readRecord(true)).toBeUndefined()
  })

  it('returns the array as-is since arrays are objects', () => {
    // Arrays pass the typeof check — callers guard array specifically if needed
    expect(readRecord([])).toBeDefined()
  })
})

describe('parseJsonIfPossible', () => {
  it('parses a valid JSON object string', () => {
    expect(parseJsonIfPossible('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses a valid JSON array string', () => {
    expect(parseJsonIfPossible('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('returns the original string for invalid JSON that looks like an object', () => {
    const bad = '{not json}'
    expect(parseJsonIfPossible(bad)).toBe(bad)
  })

  it('returns the original string for plain strings', () => {
    expect(parseJsonIfPossible('hello')).toBe('hello')
  })

  it('returns the original string for empty/whitespace strings', () => {
    expect(parseJsonIfPossible('')).toBe('')
    expect(parseJsonIfPossible('  ')).toBe('  ')
  })

  it('returns non-string values unchanged', () => {
    expect(parseJsonIfPossible(42)).toBe(42)
    expect(parseJsonIfPossible(null)).toBeNull()
    expect(parseJsonIfPossible(undefined)).toBeUndefined()
    const obj = { a: 1 }
    expect(parseJsonIfPossible(obj)).toBe(obj)
  })
})

describe('stripDataUrlPrefix', () => {
  it('strips the data-URL prefix from a base64 string', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,abc123')).toBe('abc123')
    expect(stripDataUrlPrefix('data:application/pdf;base64,pdfdata==')).toBe(
      'pdfdata==',
    )
  })

  it('strips prefix regardless of case in the data: scheme', () => {
    expect(stripDataUrlPrefix('DATA:image/png;base64,abc')).toBe('abc')
  })

  it('returns trimmed plain string unchanged when no data-URL prefix', () => {
    expect(stripDataUrlPrefix('abc123')).toBe('abc123')
    expect(stripDataUrlPrefix('  abc123  ')).toBe('abc123')
  })

  it('returns empty string for empty or whitespace-only string', () => {
    expect(stripDataUrlPrefix('')).toBe('')
    expect(stripDataUrlPrefix('   ')).toBe('')
  })

  it('returns empty string for non-string inputs (unknown signature)', () => {
    expect(stripDataUrlPrefix(undefined)).toBe('')
    expect(stripDataUrlPrefix(null)).toBe('')
    expect(stripDataUrlPrefix(42)).toBe('')
    expect(stripDataUrlPrefix({})).toBe('')
  })

  it('does not strip a string that starts with "data:" but has no comma', () => {
    // no comma → not a valid data-URL; return trimmed value as-is
    expect(stripDataUrlPrefix('data:image/png;base64')).toBe(
      'data:image/png;base64',
    )
  })
})
