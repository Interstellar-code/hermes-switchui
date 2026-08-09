/**
 * core-plugins.ts — the Interstellar plugin set shown in the wizard,
 * cross-referenced against a live Plugins Hub snapshot. The enable/disable
 * split mirrors `plugins-screen.tsx`'s constraint exactly: only a `bundled`
 * plugin can be flipped on from the UI, because enabling anything else needs
 * a CLI step outside this process's reach. Getting that wrong here would
 * offer a button that silently does nothing.
 *
 * Membership rule: `author: Interstellar-code` in the plugin's own
 * `plugin.yaml`. The gateway ships ~90 plugins — model providers, memory
 * backends, web search, chat platforms — and almost none of them are ours;
 * a first-run step that listed them would be a catalogue, not a decision.
 * The hub payload carries no author field (see `PluginsHubPlugin`), so the
 * rule cannot be applied at runtime and the list is curated here instead.
 * Verify with:
 *   grep -rl 'author: Interstellar-code' ~/.hermes/hermes-agent/plugins
 *
 * Deliberately excluded despite being enabled on a typical install:
 * `kanban` (no plugin.yaml, bundled upstream), `projects` (upstream, no
 * author), `herdr-agent-state` and `matrix-platform` (not Interstellar, and
 * not installed as top-level plugins). Dropping kanban and projects does
 * cost the two most visible unlocks — the Tasks and Projects screens — which
 * is a real trade, made deliberately in favour of the authorship rule.
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
    name: 'workflow-engine',
    label: 'Workflow Engine',
    purpose: 'Define, trigger and monitor multi-step DAG workflows',
    unlocks: 'the Workflows screen',
  },
  {
    name: 'a2a_fleet',
    label: 'A2A Fleet',
    purpose: 'Agent-to-agent JSON-RPC fleet membership and managed executors',
    unlocks: 'the Matrix3D fleet view',
  },
  {
    name: 'personas',
    label: 'Personas',
    purpose: 'Canonical persona store, applied to agent profiles',
    unlocks: null,
  },
  {
    name: 'mcp_lazy',
    label: 'MCP Lazy Loading',
    purpose: 'Loads MCP servers on demand instead of at startup',
    unlocks: null,
  },
  {
    name: 'hermes-switch-ui',
    label: 'Hermes Switch UI',
    purpose: 'This app, registered with the gateway',
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
