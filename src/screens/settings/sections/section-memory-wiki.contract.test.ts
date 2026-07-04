import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('section-memory-wiki provider surface', () => {
  it('uses the shared memory provider catalog instead of a stale local list', () => {
    const source = readFileSync(new URL('./section-memory-wiki.tsx', import.meta.url), 'utf8')
    expect(source).toContain('MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED')
    expect(source).toContain('getMemoryProviderInfo')
    expect(source).not.toContain("value: 'honcho'")
    expect(source).not.toContain("value: 'builtin'")
  })
})
