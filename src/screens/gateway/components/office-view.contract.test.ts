import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('office-view orchestration surface', () => {
  it('uses the shared session orchestration helper for badges and details', () => {
    const source = readFileSync(new URL('./office-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain('getSessionKindBadgeLabel')
    expect(source).toContain('getSessionOrchestrationMeta')
    expect(source).toContain('orchestrationMeta.detail')
  })
})
