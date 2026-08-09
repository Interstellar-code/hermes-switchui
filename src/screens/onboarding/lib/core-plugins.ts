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
 * A second group, `recommended`, carries upstream plugins that are not ours
 * but gate a screen this UI ships: kanban (no plugin.yaml at all) and
 * projects (declares no author). Keeping them in their own labelled group
 * means the authorship rule stays honest — nothing upstream is presented as
 * Interstellar's — while the two most visible unlocks, the Tasks and
 * Projects screens, are still offered at first run.
 *
 * Still excluded despite being enabled on a typical install:
 * `herdr-agent-state` and `matrix-platform` — neither is Interstellar's, and
 * neither is installed as a top-level plugin.
 */
import type { PluginsHubPlugin } from '@/lib/hermes-client'

export type CorePluginState =
  | 'enabled'
  | 'inactive'
  | 'disabled'
  | 'absent'
  | 'self'

export type CorePluginAction = 'enable' | 'disable' | 'cli' | 'none'

/** `interstellar` = authored by us; `recommended` = upstream, but gates a screen. */
export type CorePluginGroup = 'interstellar' | 'recommended'

export const CORE_PLUGIN_GROUPS: ReadonlyArray<{
  id: CorePluginGroup
  label: string
}> = [
  { id: 'interstellar', label: 'Interstellar plugins' },
  { id: 'recommended', label: 'Also recommended' },
]

export type CorePluginRow = {
  name: string
  label: string
  purpose: string
  unlocks: string | null
  group: CorePluginGroup
  state: CorePluginState
  action: CorePluginAction
  cliCommand: string | null
}

export const CORE_PLUGINS: ReadonlyArray<{
  name: string
  label: string
  purpose: string
  unlocks: string | null
  group: CorePluginGroup
}> = [
  {
    name: 'workflow-engine',
    label: 'Workflow Engine',
    purpose: 'Define, trigger and monitor multi-step DAG workflows',
    unlocks: 'the Workflows screen',
    group: 'interstellar',
  },
  {
    name: 'a2a_fleet',
    label: 'A2A Fleet',
    purpose: 'Agent-to-agent JSON-RPC fleet membership and managed executors',
    unlocks: 'the Matrix3D fleet view',
    group: 'interstellar',
  },
  {
    name: 'personas',
    label: 'Personas',
    purpose: 'Canonical persona store, applied to agent profiles',
    unlocks: null,
    group: 'interstellar',
  },
  {
    name: 'mcp_lazy',
    label: 'MCP Lazy Loading',
    purpose: 'Loads MCP servers on demand instead of at startup',
    unlocks: null,
    group: 'interstellar',
  },
  {
    name: 'hermes-switch-ui',
    label: 'Hermes Switch UI',
    purpose: 'This app, registered with the gateway',
    unlocks: null,
    group: 'interstellar',
  },
  {
    name: 'kanban',
    label: 'Kanban',
    purpose: 'Multi-agent Kanban board with drag-drop cards and comments',
    unlocks: 'the Tasks screen',
    group: 'recommended',
  },
  {
    name: 'projects',
    label: 'Projects',
    purpose: 'First-class Hermes projects with their own folders and sessions',
    unlocks: 'the Projects screen',
    group: 'recommended',
  },
]

function cliCommand(action: 'enable' | 'disable', name: string): string {
  return `hermes plugins ${action} ${name}`
}

/**
 * Capability flags from `/api/gateway-status`, keyed by plugin name.
 *
 * Not every plugin is a hub plugin. `kanban` ships no `plugin.yaml` at all —
 * it is mounted from a dashboard manifest — so it never appears in the hub
 * snapshot, and reading absence as "not installed" told users their Tasks
 * screen was off while they were looking at it. The gateway already probes
 * these, so the probe is the truth for anything the hub cannot see.
 */
export type CorePluginCapabilities = {
  kanban?: boolean
  projects?: boolean
}

export function buildCorePluginRows(
  hub: Array<PluginsHubPlugin>,
  capabilities: CorePluginCapabilities = {},
): Array<CorePluginRow> {
  const byName = new Map(hub.map((plugin) => [plugin.name, plugin]))

  return CORE_PLUGINS.map((core) => {
    if (core.name === 'hermes-switch-ui') {
      return { ...core, state: 'self', action: 'none', cliCommand: null }
    }

    const plugin = byName.get(core.name)
    if (!plugin) {
      // Live according to the gateway, just not a hub plugin. There is
      // nothing to toggle — the hub is the only thing that can toggle — so
      // it reports its real state and offers no control.
      const capable = capabilities[core.name as keyof CorePluginCapabilities]
      if (capable === true) {
        return { ...core, state: 'enabled', action: 'none', cliCommand: null }
      }
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
