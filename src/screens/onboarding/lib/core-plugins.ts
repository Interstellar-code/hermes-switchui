/**
 * core-plugins.ts — the curated Interstellar plugin set shown in the wizard,
 * cross-referenced against a live Plugins Hub snapshot. The enable/disable
 * split mirrors `plugins-screen.tsx`'s constraint exactly: only a `bundled`
 * plugin can be flipped on from the UI, because enabling anything else needs
 * a CLI step outside this process's reach. Getting that wrong here would
 * offer a button that silently does nothing.
 */
import type { PluginsHubPlugin } from '@/lib/hermes-client'

export type CorePluginState =
  | 'enabled'
  | 'inactive'
  | 'disabled'
  | 'absent'
  | 'self'

export type CorePluginAction = 'enable' | 'disable' | 'cli' | 'none'

export type CorePluginRow = {
  name: string
  label: string
  purpose: string
  unlocks: string | null
  state: CorePluginState
  action: CorePluginAction
  cliCommand: string | null
}

export const CORE_PLUGINS: ReadonlyArray<{
  name: string
  label: string
  purpose: string
  unlocks: string | null
}> = [
  {
    name: 'kanban',
    label: 'Kanban',
    purpose: 'Kanban board',
    unlocks: 'the Tasks screen',
  },
  {
    name: 'projects',
    label: 'Projects',
    purpose: 'First-class Hermes projects',
    unlocks: 'the Projects screen',
  },
  {
    name: 'workflow-engine',
    label: 'Workflow Engine',
    purpose: 'DAG workflow engine',
    unlocks: 'Workflows',
  },
  {
    name: 'personas',
    label: 'Personas',
    purpose: 'Canonical persona store',
    unlocks: null,
  },
  {
    name: 'a2a_fleet',
    label: 'A2A Fleet',
    purpose: 'Agent-to-agent JSON-RPC fleet',
    unlocks: null,
  },
  {
    name: 'mcp_lazy',
    label: 'MCP Lazy Loading',
    purpose: 'Lazy MCP server loading',
    unlocks: null,
  },
  {
    name: 'herdr-agent-state',
    label: 'Herdr Agent State',
    purpose: 'Agent state tracking',
    unlocks: null,
  },
  {
    name: 'matrix-platform',
    label: 'Matrix Platform',
    purpose: 'Matrix homeserver chat adapter',
    unlocks: null,
  },
  {
    name: 'hermes-switch-ui',
    label: 'Hermes Switch UI',
    purpose: 'This app',
    unlocks: null,
  },
]

function cliCommand(action: 'enable' | 'disable', name: string): string {
  return `hermes plugins ${action} ${name}`
}

export function buildCorePluginRows(
  hub: Array<PluginsHubPlugin>,
): Array<CorePluginRow> {
  const byName = new Map(hub.map((plugin) => [plugin.name, plugin]))

  return CORE_PLUGINS.map((core) => {
    if (core.name === 'hermes-switch-ui') {
      return { ...core, state: 'self', action: 'none', cliCommand: null }
    }

    const plugin = byName.get(core.name)
    if (!plugin) {
      return {
        ...core,
        state: 'absent',
        action: 'cli',
        cliCommand: cliCommand('enable', core.name),
      }
    }

    if (plugin.runtimeStatus === 'enabled') {
      return { ...core, state: 'enabled', action: 'disable', cliCommand: null }
    }

    const state: CorePluginState =
      plugin.runtimeStatus === 'inactive' ? 'inactive' : 'disabled'
    const bundled = plugin.source === 'bundled'

    return bundled
      ? { ...core, state, action: 'enable', cliCommand: null }
      : {
          ...core,
          state,
          action: 'cli',
          cliCommand: cliCommand('enable', core.name),
        }
  })
}
