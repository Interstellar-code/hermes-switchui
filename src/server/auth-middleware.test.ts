import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for #123 (Secure cookie attribute) and #125
 * (x-forwarded-for spoofing).
 *
 * We reset the module between tests because the cookie helper captures
 * env-dependent state at call time and rate-limit / middleware paths
 * depend on `TRUST_PROXY`.
 */

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete process.env.COOKIE_SECURE
  delete process.env.NODE_ENV
  delete process.env.TRUST_PROXY
  delete process.env.CLAUDE_PASSWORD
  delete process.env.HERMES_PASSWORD
})

describe('createSessionCookie (#123)', () => {
  it('omits Secure in development by default', async () => {
    process.env.NODE_ENV = 'development'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toMatch(/^claude-auth=tok123/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
  })

  it('sets Secure in production by default', async () => {
    process.env.NODE_ENV = 'production'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('respects COOKIE_SECURE=1 override in development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.COOKIE_SECURE = '1'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
  })

  it('respects COOKIE_SECURE=0 override in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = '0'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).not.toContain('Secure')
  })
})

describe('getRequestIp (#125)', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/', { headers })
  }

  it('ignores x-forwarded-for when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('127.0.0.1')
  })

  it('ignores x-real-ip when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '203.0.113.77' }))
    expect(ip).toBe('127.0.0.1')
  })

  it('honors x-forwarded-for when TRUST_PROXY=1', async () => {
    process.env.TRUST_PROXY = '1'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('203.0.113.77')
  })

  it('honors x-real-ip fallback when TRUST_PROXY=true and x-forwarded-for absent', async () => {
    process.env.TRUST_PROXY = 'true'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '198.51.100.5' }))
    expect(ip).toBe('198.51.100.5')
  })
})

describe('verifyPassword (#150 — timing-safe, no length leak)', () => {
  it('returns true for correct password', async () => {
    process.env.HERMES_PASSWORD = 'secret123'
    const { verifyPassword } = await import('./auth-middleware')
    expect(verifyPassword('secret123')).toBe(true)
  })

  it('returns false for wrong password (same length)', async () => {
    process.env.HERMES_PASSWORD = 'secret123'
    const { verifyPassword } = await import('./auth-middleware')
    expect(verifyPassword('wrongo123')).toBe(false)
  })

  it('returns false for wrong password (different length)', async () => {
    process.env.HERMES_PASSWORD = 'secret123'
    const { verifyPassword } = await import('./auth-middleware')
    expect(verifyPassword('short')).toBe(false)
    expect(verifyPassword('a-very-long-password-that-exceeds-configured')).toBe(false)
  })

  it('returns false when no password is configured', async () => {
    delete process.env.HERMES_PASSWORD
    delete process.env.CLAUDE_PASSWORD
    const { verifyPassword } = await import('./auth-middleware')
    expect(verifyPassword('anything')).toBe(false)
  })

  it('returns false for empty password input when configured password is set', async () => {
    process.env.HERMES_PASSWORD = 'secret123'
    const { verifyPassword } = await import('./auth-middleware')
    expect(verifyPassword('')).toBe(false)
  })

  it('falls back to CLAUDE_PASSWORD for back-compat', async () => {
    delete process.env.HERMES_PASSWORD
    process.env.CLAUDE_PASSWORD = 'legacy-pass'
    const { verifyPassword } = await import('./auth-middleware')
    expect(verifyPassword('legacy-pass')).toBe(true)
    expect(verifyPassword('wrong')).toBe(false)
  })
})
