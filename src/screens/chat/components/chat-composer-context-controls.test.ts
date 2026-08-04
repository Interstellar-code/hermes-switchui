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
    expect(src).toContain('Workspace context')
    expect(src).toContain('workspaceSelectMutation')
    expect(src).toContain('workspaceEntries.map')
    expect(src).toContain('Reasoning effort')
    expect(src).toContain("['medium', 'Medium']")
    expect(src).toContain("['high', 'High']")
  })
})
