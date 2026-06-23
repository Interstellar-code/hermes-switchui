/**
 * markdown-safe-href.test.ts
 *
 * Tests for the isSafeHref allowlist function exported from markdown.tsx.
 * Covers scheme-injection obfuscation (control chars / whitespace), blocked
 * schemes, and the full set of allowed relative/absolute forms.
 *
 * Run:  pnpm vitest run src/components/prompt-kit/markdown-safe-href.test.ts
 */
import { describe, expect, it } from 'vitest'
import { isSafeHref } from './markdown'

describe('isSafeHref — blocked schemes', () => {
  it('blocks javascript: (lowercase)', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
  })

  it('blocks JavaScript: (mixed case)', () => {
    expect(isSafeHref('JavaScript:alert(1)')).toBe(false)
  })

  it('blocks JAVASCRIPT: (uppercase)', () => {
    expect(isSafeHref('JAVASCRIPT:void(0)')).toBe(false)
  })

  it('blocks java\\tscript: (tab obfuscation)', () => {
    expect(isSafeHref('java\tscript:alert(1)')).toBe(false)
  })

  it('blocks java\\nscript: (newline obfuscation)', () => {
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false)
  })

  it('blocks java\\rscript: (carriage-return obfuscation)', () => {
    expect(isSafeHref('java\rscript:alert(1)')).toBe(false)
  })

  it('blocks " javascript:" (leading space obfuscation)', () => {
    expect(isSafeHref(' javascript:alert(1)')).toBe(false)
  })

  it('blocks data:text/html (HTML injection)', () => {
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('blocks data:text/html;base64,...', () => {
    expect(isSafeHref('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false)
  })

  it('blocks vbscript: scheme', () => {
    expect(isSafeHref('vbscript:MsgBox(1)')).toBe(false)
  })

  it('blocks unknown scheme with colon', () => {
    expect(isSafeHref('ftp:evil.com')).toBe(false)
  })
})

describe('isSafeHref — allowed schemes and relative forms', () => {
  it('allows https:// URL', () => {
    expect(isSafeHref('https://example.com/path?q=1#section')).toBe(true)
  })

  it('allows http:// URL', () => {
    expect(isSafeHref('http://example.com')).toBe(true)
  })

  it('allows mailto: link', () => {
    expect(isSafeHref('mailto:user@example.com')).toBe(true)
  })

  it('allows absolute-path /path', () => {
    expect(isSafeHref('/path/to/page')).toBe(true)
  })

  it('allows anchor #section', () => {
    expect(isSafeHref('#section')).toBe(true)
  })

  it('allows relative ./rel', () => {
    expect(isSafeHref('./relative/path')).toBe(true)
  })

  it('allows parent-relative ../up', () => {
    expect(isSafeHref('../up/path')).toBe(true)
  })

  it('allows bare relative path with no scheme', () => {
    expect(isSafeHref('page.html')).toBe(true)
  })
})

describe('isSafeHref — edge cases', () => {
  it('returns false for undefined', () => {
    expect(isSafeHref(undefined)).toBe(false)
  })

  it('allows empty string (treated as relative)', () => {
    // An empty href is safe — renders as a no-op anchor.
    expect(isSafeHref('')).toBe(true)
  })
})
