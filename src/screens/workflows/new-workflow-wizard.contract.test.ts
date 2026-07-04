import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('new-workflow-wizard contract', () => {
  it('does not expose provider/model authoring fields anymore', () => {
    const source = readFileSync(new URL('./new-workflow-wizard.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('<span>Provider</span>')
    expect(source).not.toContain('<span>Model</span>')
    expect(source).not.toContain('selectedNode.provider')
    expect(source).not.toContain('selectedNode.model')
    expect(source).toContain('Legacy contract')
  })
})
