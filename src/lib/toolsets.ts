// Canonical toolset list mirroring hermes-agent hermes_cli/tools_config.py:54-87
// This is the source of truth for the UI — do not add/remove keys without syncing the backend.

export const TOOLSET_GROUPS: string[] = [
  'Core',
  'Memory & Context',
  'Web & Search',
  'Media & Vision',
  'Automation & Integrations',
]

export const CONFIGURABLE_TOOLSETS: { key: string; label: string; group: string }[] = [
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
