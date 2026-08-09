import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () =>
  [
    'src/screens/chat/components/chat-composer-services.ts',
    'src/screens/chat/components/v2/session-selectors-v2.tsx',
  ]
    .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
    .join('\n')

describe('ChatComposer context controls', () => {
  it('keeps profile selection session-scoped and never activates the gateway profile', () => {
    const src = source()

    expect(src).toContain("fetch('/api/profiles/list')")
    expect(src).not.toContain("fetch('/api/profiles/activate'")
    expect(src).not.toContain('activateProfile')
    expect(src).toContain('profileMutable')
  })

  it('surfaces workspace and reasoning controls next to the model picker', () => {
    const src = source()

    expect(src).toContain("fetch('/api/workspace')")
    // The heading no longer says "Workspace context": /api/workspace only moves
    // the Files-browser root, and calling that "the workspace" is what made
    // users believe it moved the agent. See the agent-cwd assertions below.
    expect(src).toContain('Files browser root')
    expect(src).toContain('workspaceSelectMutation')
    expect(src).toContain('workspaceEntries.map')
    expect(src).toContain('Reasoning effort')
    expect(src).toContain("['medium', 'Medium']")
    expect(src).toContain("['high', 'High']")
  })

  it('shows the resolved AGENT cwd, distinct from the files-browser root', () => {
    const src = source()

    // The chip is driven by the resolver, not by a Switch-UI-local preference.
    expect(src).toContain("fetch('/api/agent-cwd')")
    expect(src).toContain('Agent working directory')
    expect(src).toContain('agentCwdSourceLabel')
    // The two mechanisms must stay visibly separate in the same popover.
    expect(src).toContain('does not move the agent')
  })

  it('gates the agent-cwd write behind a before → after confirmation', () => {
    const src = source()

    // A dry run must exist and must be what the confirmation renders.
    expect(src).toContain('dryRun: true')
    expect(src).toContain('previewAgentCwdMutation')
    expect(src).toContain('commitAgentCwdMutation')
    expect(src).toContain('cwdPreview.before.path')
    expect(src).toContain('cwdPreview.after.path')
    // The commit must be reachable only from the confirmation block.
    const confirmAt = src.indexOf('agent-cwd-confirm')
    const commitAt = src.indexOf('commitAgentCwdMutation.mutate')
    expect(confirmAt).toBeGreaterThan(-1)
    expect(commitAt).toBeGreaterThan(confirmAt)
  })

  it('raises the gateway-restart store after a write and does not touch the banner', () => {
    const src = source()

    expect(src).toContain('markNeedsRestart')
    expect(src).not.toContain('GatewayRestartBanner')
  })

  it('warns when the active profile has no terminal: block', () => {
    const src = source()

    expect(src).toContain('missingTerminalBlock')
    expect(src).toContain('profiles do not inherit')
    // The one-click fix writes a real value rather than only explaining.
    expect(src).toContain('agent-cwd-fix')
  })
})
