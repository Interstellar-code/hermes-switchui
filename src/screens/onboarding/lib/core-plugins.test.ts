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
      plugin({ name: 'kanban', source: 'bundled', runtimeStatus: 'inactive' }),
    ])
    const row = rows.find((r) => r.name === 'kanban')
    expect(row?.state).toBe('inactive')
    expect(row?.action).toBe('enable')
    expect(row?.cliCommand).toBeNull()
  })

  it('non-bundled + inactive falls back to the exact CLI command', () => {
    const rows = buildCorePluginRows([
      plugin({
        name: 'projects',
        source: 'plugins-hub',
        runtimeStatus: 'inactive',
      }),
    ])
    const row = rows.find((r) => r.name === 'projects')
    expect(row?.state).toBe('inactive')
    expect(row?.action).toBe('cli')
    expect(row?.cliCommand).toBe('hermes plugins enable projects')
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
