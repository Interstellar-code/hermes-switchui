import { describe, expect, it } from 'vitest'

import { CORE_PLUGINS, buildCorePluginRows } from './core-plugins'
import type { PluginsHubPlugin } from '@/lib/hermes-client'

function plugin(overrides: Partial<PluginsHubPlugin>): PluginsHubPlugin {
  return {
    name: 'kanban',
    version: '1.0.0',
    description: '',
    source: 'bundled',
    runtimeStatus: 'inactive',
    hasDashboardManifest: false,
    dashboardManifest: null,
    canRemove: false,
    canUpdateGit: false,
    authRequired: false,
    authCommand: '',
    userHidden: false,
    ...overrides,
  }
}

describe('buildCorePluginRows', () => {
  it('bundled + inactive gets the enable action, no cli command', () => {
    const rows = buildCorePluginRows([
      plugin({
        name: 'personas',
        source: 'bundled',
        runtimeStatus: 'inactive',
      }),
    ])
    const row = rows.find((r) => r.name === 'personas')
    expect(row?.state).toBe('inactive')
    expect(row?.action).toBe('enable')
    expect(row?.cliCommand).toBeNull()
  })

  it('non-bundled + inactive falls back to the exact CLI command', () => {
    const rows = buildCorePluginRows([
      plugin({
        name: 'a2a_fleet',
        source: 'plugins-hub',
        runtimeStatus: 'inactive',
      }),
    ])
    const row = rows.find((r) => r.name === 'a2a_fleet')
    expect(row?.state).toBe('inactive')
    expect(row?.action).toBe('cli')
    expect(row?.cliCommand).toBe('hermes plugins enable a2a_fleet')
  })

  /**
   * Membership of the `interstellar` group is `author: Interstellar-code` in
   * the plugin's own manifest. The gateway ships ~90 plugins and the hub
   * payload carries no author field, so the rule lives in the curated list
   * and is pinned here — the point is that nothing upstream drifts into the
   * group whose heading claims we wrote it.
   */
  it('puts exactly the Interstellar-authored plugins in the interstellar group', () => {
    const ours = CORE_PLUGINS.filter(
      (entry) => entry.group === 'interstellar',
    ).map((entry) => entry.name)
    expect(ours).toEqual([
      'workflow-engine',
      'a2a_fleet',
      'personas',
      'mcp_lazy',
      'hermes-switch-ui',
    ])
  })

  it('keeps the upstream screen-gating plugins in their own group', () => {
    const recommended = CORE_PLUGINS.filter(
      (entry) => entry.group === 'recommended',
    ).map((entry) => entry.name)
    expect(recommended).toEqual(['kanban', 'projects'])
  })

  it('offers nothing outside the two curated groups', () => {
    const names = new Set(CORE_PLUGINS.map((entry) => entry.name))
    for (const excluded of ['herdr-agent-state', 'matrix-platform']) {
      expect(names.has(excluded)).toBe(false)
    }
  })

  it('carries the group through onto every built row', () => {
    const rows = buildCorePluginRows([])
    expect(rows.find((r) => r.name === 'kanban')?.group).toBe('recommended')
    expect(rows.find((r) => r.name === 'a2a_fleet')?.group).toBe('interstellar')
  })

  /**
   * `kanban` ships no plugin.yaml — it is mounted from a dashboard manifest —
   * so it never appears in a hub snapshot. Reading that absence as "not
   * installed" told users their Tasks screen was off while they were looking
   * at it. The gateway's own capability probe is the truth for anything the
   * hub cannot see.
   */
  it('trusts the capability probe for a plugin the hub cannot see', () => {
    const rows = buildCorePluginRows([], { kanban: true })
    const row = rows.find((r) => r.name === 'kanban')
    expect(row?.state).toBe('enabled')
    // Nothing to toggle: the hub is the only thing that can toggle, and it
    // does not know this plugin exists.
    expect(row?.action).toBe('none')
    expect(row?.cliCommand).toBeNull()
  })

  it('still reports absent when the probe says the capability is off', () => {
    const rows = buildCorePluginRows([], { kanban: false })
    const row = rows.find((r) => r.name === 'kanban')
    expect(row?.state).toBe('absent')
    expect(row?.action).toBe('cli')
  })

  it('treats an unprobed capability as absent rather than assuming it is on', () => {
    const row = buildCorePluginRows([], {}).find((r) => r.name === 'kanban')
    expect(row?.state).toBe('absent')
  })

  it('non-bundled + disabled also falls back to cli', () => {
    const rows = buildCorePluginRows([
      plugin({
        name: 'workflow-engine',
        source: 'plugins-hub',
        runtimeStatus: 'disabled',
      }),
    ])
    const row = rows.find((r) => r.name === 'workflow-engine')
    expect(row?.state).toBe('disabled')
    expect(row?.action).toBe('cli')
    expect(row?.cliCommand).toBe('hermes plugins enable workflow-engine')
  })

  it('running plugins get the disable action regardless of source', () => {
    const rows = buildCorePluginRows([
      plugin({
        name: 'personas',
        source: 'plugins-hub',
        runtimeStatus: 'enabled',
      }),
    ])
    const row = rows.find((r) => r.name === 'personas')
    expect(row?.state).toBe('enabled')
    expect(row?.action).toBe('disable')
    expect(row?.cliCommand).toBeNull()
  })

  it('a plugin absent from the hub is "absent" with a cli command', () => {
    const rows = buildCorePluginRows([])
    const row = rows.find((r) => r.name === 'a2a_fleet')
    expect(row?.state).toBe('absent')
    expect(row?.action).toBe('cli')
    expect(row?.cliCommand).toBe('hermes plugins enable a2a_fleet')
  })

  it('hermes-switch-ui is always self/none, even if it appears in the hub', () => {
    const rows = buildCorePluginRows([
      plugin({
        name: 'hermes-switch-ui',
        source: 'bundled',
        runtimeStatus: 'enabled',
      }),
    ])
    const row = rows.find((r) => r.name === 'hermes-switch-ui')
    expect(row?.state).toBe('self')
    expect(row?.action).toBe('none')
    expect(row?.cliCommand).toBeNull()
  })

  it('emits exactly the curated set, in order, with no extras', () => {
    const rows = buildCorePluginRows([])
    expect(rows.map((r) => r.name)).toEqual(CORE_PLUGINS.map((c) => c.name))
  })
})
