// Canonical toolset list mirroring hermes-agent hermes_cli/tools_config.py:54-87
// This is the source of truth for the UI — do not add/remove keys without syncing the backend.

export const CONFIGURABLE_TOOLSETS: { key: string; label: string }[] = [
  { key: 'web', label: 'Web Search & Scraping' },
  { key: 'browser', label: 'Browser Automation' },
  { key: 'terminal', label: 'Terminal & Processes' },
  { key: 'file', label: 'File Operations' },
  { key: 'code_execution', label: 'Code Execution' },
  { key: 'vision', label: 'Vision / Image Analysis' },
  { key: 'video', label: 'Video Analysis' },
  { key: 'image_gen', label: 'Image Generation' },
  { key: 'video_gen', label: 'Video Generation' },
  { key: 'x_search', label: 'X (Twitter) Search' },
  { key: 'moa', label: 'Mixture of Agents' },
  { key: 'tts', label: 'Text-to-Speech' },
  { key: 'skills', label: 'Skills' },
  { key: 'todo', label: 'Task Planning' },
  { key: 'memory', label: 'Memory' },
  { key: 'context_engine', label: 'Context Engine' },
  { key: 'session_search', label: 'Session Search' },
  { key: 'clarify', label: 'Clarifying Questions' },
  { key: 'delegation', label: 'Task Delegation' },
  { key: 'cronjob', label: 'Cron Jobs' },
  { key: 'messaging', label: 'Cross-Platform Messaging' },
  { key: 'homeassistant', label: 'Home Assistant' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'discord', label: 'Discord' },
  { key: 'discord_admin', label: 'Discord Server Admin' },
  { key: 'computer_use', label: 'Computer Use (macOS)' },
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
