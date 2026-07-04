import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('config-wizards provider surface', () => {
  it('does not carry stale google-antigravity setup entries', () => {
    const source = readFileSync(new URL('./config-wizards.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('google-antigravity')
    expect(source).not.toContain('Google AG')
  })
})
