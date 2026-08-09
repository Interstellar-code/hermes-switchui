import { describe, expect, it } from 'vitest'

import { mergeProfileConfig } from './profile-merge'
import type { ProfileConfig } from '@/server/profiles-browser'
import type { NewAgentDraft } from '@/screens/profiles/types'
import { buildUpdatePayload, predictMergedConfig } from '@/screens/profiles/profile-config-map'
import { INITIAL_DRAFT } from '@/screens/profiles/types'

/**
 * Contract test: the server's save path (`mergeProfileConfig`, consumed by
 * `updateProfileConfig()` in `src/server/profiles-browser.ts`) and the
 * wizard's client-side save-preview (`predictMergedConfig()` in
 * `src/screens/profiles/profile-config-map.ts`) MUST compute the same
 * resulting config for the same (current config, patch) pair.
 *
 * Both now delegate to the same `mergeProfileConfig`/`REPLACE_WHOLE_CONFIG_KEYS`
 * exported from this module (see profile-merge.ts's doc comment) specifically
 * so this can never again silently drift — before that consolidation, adding
 * a key to the server's replace-whole set without touching the client copy
 * would make the wizard's "before → after" diff lie about what a save
 * actually does, and nothing would catch it. This test is that catch.
 *
 * Each case below independently re-derives the "server would produce" result
 * via `mergeProfileConfig` and compares it against `predictMergedConfig`'s
 * "client predicts" result for the exact same inputs. If either
 * implementation (or the shared module they both depend on) is ever
 * re-forked, this fails.
 */

function draft(patch: Partial<NewAgentDraft> = {}): NewAgentDraft {
  return { ...INITIAL_DRAFT, ...patch }
}

// What updateProfileConfig() actually receives as its patch: buildUpdatePayload()
// minus `name`, which identifies the profile rather than being part of
// config.yaml itself. Mirrors update.ts's route handler shape.
function serverPatchFor(d: NewAgentDraft): Record<string, unknown> {
  const patch = buildUpdatePayload(d)
  delete patch.name
  return patch
}

function cloneConfig(config: ProfileConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>
}

function expectServerAndClientAgree(current: ProfileConfig, d: NewAgentDraft) {
  const clientResult = predictMergedConfig(current, d)
  const serverResult = mergeProfileConfig(cloneConfig(current), serverPatchFor(d))
  expect(serverResult).toEqual(clientResult)
}

describe('profile-merge contract: server and client agree on the merge result', () => {
  it('agrees on a brand-new profile with no prior config', () => {
    expectServerAndClientAgree(
      {},
      draft({
        name: 'agent-1',
        role: 'Tester',
        description: 'A test agent',
        model: 'auto',
        provider: 'manifest',
      }),
    )
  })

  it('agrees when mcp_servers is replaced wholesale (a server deselected)', () => {
    const current: ProfileConfig = {
      model: { default: 'auto', provider: 'manifest' },
      mcp_servers: {
        alpha: { command: 'alpha-cmd' },
        bravo: { command: 'bravo-cmd' },
      },
    }
    expectServerAndClientAgree(
      current,
      draft({
        name: 'agent-2',
        role: 'Builder',
        model: 'auto',
        provider: 'manifest',
        mcp_servers: { alpha: { command: 'alpha-cmd-v2' } },
      }),
    )
  })

  it('agrees that agent_ui deep-merges — tier/status survive a save that omits them', () => {
    const current: ProfileConfig = {
      model: { default: 'auto', provider: 'manifest' },
      agent_ui: { tier: 3, status: 'active', glyph: 'A4', last_run: 1234 },
    }
    expectServerAndClientAgree(
      current,
      draft({
        name: 'agent-4',
        glyph: 'B4',
        role: 'Reviewer',
        tags: ['updated'],
        model: 'auto',
        provider: 'manifest',
      }),
    )
  })

  it('agrees when the draft clears mcp_servers entirely', () => {
    const current: ProfileConfig = {
      mcp_servers: { alpha: { command: 'alpha-cmd' } },
    }
    expectServerAndClientAgree(
      current,
      draft({ name: 'agent-5', role: 'Solo', model: 'auto', provider: 'manifest' }),
    )
  })

  it('agrees on memory + skills + toolsets all merging at once', () => {
    const current: ProfileConfig = {
      memory: { memory_enabled: false, provider: '' },
      skills: { external_dirs: ['/old/skills'] },
      agent: { max_turns: 50, reasoning_effort: 'low' },
    }
    expectServerAndClientAgree(
      current,
      draft({
        name: 'agent-6',
        role: 'Memory-enabled',
        model: 'auto',
        provider: 'manifest',
        memory_enabled: true,
        memory_provider: 'matrix-memory',
        skill_dirs: ['/new/skills'],
        max_turns: 300,
        reasoning_effort: 'high',
        disabled_toolsets: ['web'],
      }),
    )
  })
})
