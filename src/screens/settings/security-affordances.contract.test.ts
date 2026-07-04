import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('security affordance copy', () => {
  it('tightens browser/private-url, approval, and dashboard-plugin messaging', () => {
    const privacySource = readFileSync(new URL('./sections/section-privacy.tsx', import.meta.url), 'utf8')
    const pluginSource = readFileSync(new URL('./sections/section-hermes-plugin.tsx', import.meta.url), 'utf8')
    const registeredSource = readFileSync(new URL('./sections/section-mcp-registered.tsx', import.meta.url), 'utf8')
    const approvalsSource = readFileSync(new URL('../gateway/components/approvals-bell.tsx', import.meta.url), 'utf8')
    const toolsetsSource = readFileSync(new URL('../../lib/toolsets.ts', import.meta.url), 'utf8')

    expect(privacySource).toContain('Browser/web tools will reject')
    expect(pluginSource).toContain('re-authenticate to the dashboard proxy')
    expect(registeredSource).toContain('auth or dashboard restart may be required')
    expect(approvalsSource).toContain('approval-gated actions will pause here')
    expect(toolsetsSource).toContain('Approval-gated in hardened mode')
  })
})
