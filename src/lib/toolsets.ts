// Canonical toolset list mirroring hermes-agent hermes_cli/tools_config.py:54-87
// This is the source of truth for the UI — do not add/remove keys without syncing the backend.

export const TOOLSET_GROUPS: Array<string> = [
  'Core',
  'Memory & Context',
  'Web & Search',
  'Media & Vision',
  'Automation & Integrations',
]

export const CONFIGURABLE_TOOLSETS: Array<{ key: string; label: string; group: string }> = [
  { key: 'file',           label: 'File Operations',           group: 'Core' },
  { key: 'terminal',       label: 'Terminal & Processes',      group: 'Core' },
  { key: 'code_execution', label: 'Code Execution',            group: 'Core' },
  { key: 'skills',         label: 'Skills',                    group: 'Core' },
  { key: 'todo',           label: 'Task Planning',             group: 'Core' },
  { key: 'delegation',     label: 'Task Delegation',           group: 'Core' },
  { key: 'clarify',        label: 'Clarifying Questions',      group: 'Core' },
  { key: 'memory',         label: 'Memory',                    group: 'Memory & Context' },
  { key: 'context_engine', label: 'Context Engine',            group: 'Memory & Context' },
  { key: 'session_search', label: 'Session Search',            group: 'Memory & Context' },
  { key: 'web',            label: 'Web Search & Scraping',     group: 'Web & Search' },
  { key: 'browser',        label: 'Browser Automation',        group: 'Web & Search' },
  { key: 'x_search',       label: 'X (Twitter) Search',       group: 'Web & Search' },
  { key: 'vision',         label: 'Vision / Image Analysis',   group: 'Media & Vision' },
  { key: 'video',          label: 'Video Analysis',            group: 'Media & Vision' },
  { key: 'image_gen',      label: 'Image Generation',          group: 'Media & Vision' },
  { key: 'video_gen',      label: 'Video Generation',          group: 'Media & Vision' },
  { key: 'tts',            label: 'Text-to-Speech',            group: 'Media & Vision' },
  { key: 'cronjob',        label: 'Cron Jobs',                 group: 'Automation & Integrations' },
  { key: 'messaging',      label: 'Cross-Platform Messaging',  group: 'Automation & Integrations' },
  { key: 'discord',        label: 'Discord',                   group: 'Automation & Integrations' },
  { key: 'discord_admin',  label: 'Discord Server Admin',      group: 'Automation & Integrations' },
  { key: 'homeassistant',  label: 'Home Assistant',            group: 'Automation & Integrations' },
  { key: 'spotify',        label: 'Spotify',                   group: 'Automation & Integrations' },
  { key: 'computer_use',   label: 'Computer Use (macOS)',      group: 'Automation & Integrations' },
  { key: 'moa',            label: 'Mixture of Agents',         group: 'Automation & Integrations' },
]

// Toolsets that grant powerful system access — show a security hint in the UI
// when these are enabled, especially relevant for review-only or read-only agents.
export const DESTRUCTIVE_TOOLSETS = new Set([
  'terminal',
  'file',
  'code_execution',
  'computer_use',
  'browser',
])

/**
 * Normalized toolset item — the shared shape consumed by the wizard step and
 * produced by both the live gateway route and the static fallback.
 *
 * `gatewayEnabled` is only ever populated from a live gateway response
 * (`/api/profiles/toolsets` with `source: 'gateway'`) — it mirrors the
 * `enabled` field GET /v1/toolsets reports, which is
 * `_get_platform_tools(config, "api_server")` with `agent.disabled_toolsets`
 * applied LAST as an override (hermes_cli/tools_config.py, verified against
 * ~/.hermes/hermes-agent). `disabled_toolsets` beats any positive toolset
 * selection, including a profile's own — so `gatewayEnabled: false` here
 * means the gateway will suppress this toolset right now regardless of what
 * a profile draft shows. Left `undefined` for the static fallback, which has
 * no way to know what the gateway currently suppresses.
 */
export type NormalizedToolset = {
  key: string
  label: string
  group: string
  destructive: boolean
  plugin: boolean
  gatewayEnabled?: boolean
}

/**
 * A toolset the wizard shows as selected (not in the draft's
 * `disabled_toolsets`) that the live gateway is actually suppressing right
 * now via `agent.disabled_toolsets` (e.g. the upstream blank-slate bug that
 * pre-populates ~27 entries there — issue #49995). Only trust this when the
 * catalog came from `source: 'gateway'` — the static fallback cannot know
 * what the gateway suppresses, so it must say nothing rather than guess.
 */
export function isToolsetSuppressed(
  toolset: NormalizedToolset,
  source: 'gateway' | 'static',
  locallyEnabled: boolean,
): boolean {
  return source === 'gateway' && locallyEnabled && toolset.gatewayEnabled === false
}

/** Group used for plugin-registered toolsets that have no static mapping. */
export const PLUGINS_GROUP = 'Plugins'

/** Lookup: canonical toolset key → static group. */
export const TOOLSET_GROUP_BY_KEY: Record<string, string> = Object.fromEntries(
  CONFIGURABLE_TOOLSETS.map((t) => [t.key, t.group]),
)

/**
 * Build the normalized fallback array from the static CONFIGURABLE_TOOLSETS.
 * Shared by the server route (on gateway error) and the component (on fetch
 * loading/error) so the fallback shape is identical everywhere.
 */
export function buildStaticToolsetCatalog(): Array<NormalizedToolset> {
  return CONFIGURABLE_TOOLSETS.map((t) => ({
    key: t.key,
    label: t.label,
    group: t.group,
    destructive: DESTRUCTIVE_TOOLSETS.has(t.key),
    plugin: false,
  }))
}

export function getToolsetSecurityHint(key: string): string | null {
  if (key === 'browser') {
    return 'Approval-gated in hardened mode. Private/internal URLs stay blocked unless you explicitly allow them in Privacy settings.'
  }
  if (key === 'computer_use') {
    return 'Approval-gated in hardened mode. Grants direct desktop control.'
  }
  if (key === 'terminal' || key === 'file' || key === 'code_execution') {
    return 'Grants powerful system access — disable for read-only or review agents.'
  }
  return null
}

/**
 * Best-effort mapper from persona `suggested_toolsets` vocabulary to canonical keys.
 *
 * Persona files use loose names like `core`, `files`, `bash`, `web`, `vision`, `terminal`.
 * Most canonical keys pass through unchanged (exact match). The mismatches are:
 *   files  → file      (persona shorthand for File Operations)
 *   bash   → terminal  (persona shorthand for Terminal & Processes)
 *   core   → null      (no canonical equivalent; ignore)
 *
 * Unknown names that have no canonical key → null (caller should skip them).
 */
export function mapPersonaToolset(name: string): string | null {
  // Explicit overrides for vocabulary mismatches
  const overrides: Record<string, string | null> = {
    files: 'file',
    bash: 'terminal',
    core: null,
  }

  if (Object.prototype.hasOwnProperty.call(overrides, name)) {
    return overrides[name]
  }

  // Exact-key pass-through: check if the name is a valid canonical key
  if (CONFIGURABLE_TOOLSETS.some((t) => t.key === name)) {
    return name
  }

  // Unknown — ignore
  return null
}
