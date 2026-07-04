import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('wizard-step-memory provider surface', () => {
  it('uses the shared memory provider catalog', () => {
    const source = readFileSync(new URL('./wizard-step-memory.tsx', import.meta.url), 'utf8')
    expect(source).toContain('MEMORY_PROVIDER_CATALOG')
    expect(source).not.toContain("id: 'hindsight'")
    expect(source).not.toContain("id: 'byterover'")
  })
})
