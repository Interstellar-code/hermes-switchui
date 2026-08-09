/**
 * Contract tests for copy and data-source rules the Profiles screen must keep.
 *
 * These assert on module source because the claims are about *strings shown to
 * the user* and about *which server field is read* — both are cheap to check
 * statically and expensive to reach through a full render with a QueryClient,
 * a Zustand filter store and four fetch mocks. Same approach as
 * `wizard-step-memory.contract.test.ts` and
 * `settings/security-affordances.contract.test.ts`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const here = path.dirname(new URL(import.meta.url).pathname)

/**
 * Comments in these files *discuss* the very strings and fields these tests
 * forbid ("agent_ui.status is inert", "saying 'cannot be undone' was false").
 * Strip them so the assertions read code and copy, not commentary.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const read = (rel: string) =>
  stripComments(fs.readFileSync(path.join(here, rel), 'utf-8'))

const screen = read('profiles-screen.tsx')
const card = read('components/profile-card.tsx')
const tableRow = read('components/profile-table-row.tsx')
const trashPanel = read('components/trash-panel.tsx')

describe('P-06 / P-12 — the legacy agent_ui fields are never read', () => {
  const consumers = { screen, card, tableRow }

  for (const [name, source] of Object.entries(consumers)) {
    it(`${name} does not read agent_ui.status or agent_ui.last_run`, () => {
      // `ui.status ?? builtin?.status` and `ui.last_run` were the old sources;
      // both are stamped once at creation and never advanced.
      expect(source).not.toMatch(/\bui\.status\b/)
      expect(source).not.toMatch(/\bui\.last_run\b/)
      expect(source).not.toMatch(/agent_ui\??\.status/)
      expect(source).not.toMatch(/agent_ui\??\.last_run/)
      expect(source).not.toMatch(/builtin\?\.status/)
    })
  }
})

describe('P-13 — the wizard success toast is mode-aware', () => {
  it('does not unconditionally claim the agent was created', () => {
    const created = screen.match(/created`/g) ?? []
    const saved = screen.match(/saved`/g) ?? []
    expect(created.length).toBeGreaterThan(0)
    expect(saved.length).toBeGreaterThan(0)
  })

  it('branches on whether the wizard was opened on an existing profile', () => {
    expect(screen).toMatch(/wasEdit/)
  })
})

describe('P-14 — the delete dialog describes what actually happens', () => {
  it('no longer claims deletion cannot be undone', () => {
    const dialog = screen.slice(screen.indexOf('title="Delete agent?"'))
    expect(dialog).not.toMatch(/cannot be undone/i)
    expect(dialog).not.toMatch(/permanently deletes/i)
  })

  it('names the trash directory and points at Recently Deleted', () => {
    const dialog = screen.slice(screen.indexOf('title="Delete agent?"'))
    expect(dialog).toMatch(/~\/\.hermes\/trash/)
    expect(dialog).toMatch(/Recently Deleted/)
  })

  it('reserves "cannot be undone" for the purge confirmation, which is true there', () => {
    expect(trashPanel).toMatch(/cannot be undone/i)
    expect(trashPanel).toMatch(/from disk/i)
  })
})

describe('P-05 — reverting to the default profile is reachable', () => {
  it('offers a default-profile control wired to the activate endpoint', () => {
    expect(screen).toMatch(/Use default profile/)
    expect(screen).toMatch(/'\/api\/profiles\/activate', \{ name: 'default' \}/)
  })
})
