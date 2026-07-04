import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('provider-model-icon detection', () => {
  it('does not special-case the removed antigravity provider anymore', () => {
    const source = readFileSync(new URL('./provider-model-icon.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('antigravity')
  })
})
