/**
 * section-registry.ts — the one description of what a Settings section is.
 *
 * This absorbs the two lists that used to sit inside `settings-screen.tsx`
 * (`SECTIONS` and `SECTION_COMPONENTS`) and adds the piece that was missing:
 * which *setting keys* each section owns.
 *
 * Without that mapping the sidebar could not draw a dirty dot. The old code
 * tested `dirty.has(section.id)` — a Set of setting keys like
 * `config.terminal.timeout` against a section id like `execution` — so the dot
 * was structurally unable to light. `dirtySectionIds` is the fix.
 *
 * `ownership` tells the save bar the truth about a section:
 *   store       — every control writes the draft store; the save bar applies.
 *   self-saving — the section writes the gateway itself, immediately.
 *   mixed       — store-backed rows plus one or more self-saving cards.
 *   read-only   — the section only reports; there is nothing to save.
 */

import { lazy } from 'react'
import type { ComponentType } from 'react'

export type SectionOwnership = 'store' | 'self-saving' | 'mixed' | 'read-only'

export type SectionSpec = {
  id: string
  label: string
  group: string
  ownership: SectionOwnership
  /** Exact store keys this section edits. */
  keys?: Array<string>
  /** Key prefixes this section owns, for generated/dynamic key sets. */
  keyPrefixes?: Array<string>
  /** Cards inside a `mixed` section that write the gateway directly. */
  selfSavedSurfaces?: Array<string>
  /** Fallbacks the section registers on mount via `registerDefaults`. */
  defaults?: Record<string, unknown>
}

export const SECTION_SPECS: Array<SectionSpec> = [
  // ── General ─────────────────────────────────────────────────────────────
  {
    id: 'workspace',
    label: 'Workspace',
    group: 'General',
    ownership: 'read-only',
  },
  {
    id: 'account',
    label: 'Account',
    group: 'General',
    ownership: 'read-only',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    group: 'General',
    ownership: 'self-saving',
    selfSavedSurfaces: ['Theme'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    group: 'General',
    ownership: 'read-only',
  },

  // ── Models ──────────────────────────────────────────────────────────────
  {
    id: 'provider',
    label: 'Provider',
    group: 'Models',
    ownership: 'mixed',
    keys: ['config.fallback_model'],
    // Provider / default-model rows call setModelAssignment directly.
    selfSavedSurfaces: ['Active provider', 'Default model'],
  },
  {
    id: 'model-registry',
    label: 'Model Registry',
    group: 'Models',
    ownership: 'read-only',
  },

  // ── Agent ───────────────────────────────────────────────────────────────
  {
    id: 'agent-runtime',
    label: 'Runtime',
    group: 'Agent',
    ownership: 'store',
    keys: [
      'config.agent.api_max_retries',
      'config.agent.gateway_timeout',
      'config.agent.max_turns',
      'config.agent.service_tier',
      'config.agent.tool_use_enforcement',
    ],
  },
  {
    id: 'execution',
    label: 'Execution',
    group: 'Agent',
    ownership: 'store',
    keys: [
      'config.code_execution.mode',
      'config.terminal.backend',
      'config.terminal.container_cpu',
      'config.terminal.container_disk',
      'config.terminal.container_memory',
      'config.terminal.docker_image',
      'config.terminal.docker_mount_cwd_to_workspace',
      'config.terminal.docker_network',
      'config.terminal.docker_volumes',
      'config.terminal.persistent_shell',
      'config.terminal.timeout',
    ],
  },
  {
    id: 'gateway',
    label: 'Gateway',
    group: 'Agent',
    ownership: 'store',
    keys: [
      'config.gateway.multiplex_profiles',
      'config.platforms.api_server.host',
      'config.platforms.api_server.port',
    ],
  },

  // ── Memory ──────────────────────────────────────────────────────────────
  {
    id: 'memory-wiki',
    label: 'Memory & Wiki',
    group: 'Memory',
    ownership: 'mixed',
    keys: [
      'config.memory.memory_char_limit',
      'config.memory.memory_enabled',
      'config.memory.provider',
      'config.memory.user_char_limit',
      'config.memory.user_profile_enabled',
    ],
    selfSavedSurfaces: ['Hindsight', 'Wiki source'],
  },

  // ── Skills ──────────────────────────────────────────────────────────────
  {
    id: 'skills',
    label: 'Skills',
    group: 'Skills',
    ownership: 'store',
    keys: [
      'config.skills.external_dirs',
      'config.skills.inline_shell',
      'config.skills.inline_shell_timeout',
      'config.skills.template_vars',
    ],
  },

  // ── Workflows ───────────────────────────────────────────────────────────
  {
    id: 'workflows',
    label: 'Workflows',
    group: 'Workflows',
    ownership: 'read-only',
  },

  // ── MCP ─────────────────────────────────────────────────────────────────
  {
    id: 'mcp-servers',
    label: 'Servers',
    group: 'MCP',
    ownership: 'read-only',
  },
  {
    id: 'mcp-registered',
    label: 'Registered',
    group: 'MCP',
    ownership: 'self-saving',
  },
  {
    id: 'hermes-plugin',
    label: 'Hermes Plugin',
    group: 'MCP',
    ownership: 'self-saving',
  },

  // ── System ──────────────────────────────────────────────────────────────
  {
    id: 'storage',
    label: 'Storage',
    group: 'System',
    ownership: 'store',
    keys: [
      'config.sessions.auto_prune',
      'config.sessions.retention_days',
      'config.sessions.vacuum_after_prune',
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    group: 'System',
    ownership: 'store',
    keys: [
      'config.privacy.redact_pii',
      'config.security.allow_private_urls',
      'config.security.redact_secrets',
    ],
  },
  {
    id: 'safety',
    label: 'Safety',
    group: 'System',
    ownership: 'store',
    keys: [
      'config.approvals.cron_mode',
      'config.approvals.destructive_slash_confirm',
      'config.approvals.mcp_reload_confirm',
      'config.approvals.mode',
      'config.command_allowlist',
      'config.hooks_auto_accept',
      'config.security.tirith_enabled',
      'config.security.tirith_fail_open',
    ],
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    group: 'System',
    ownership: 'store',
    keys: [
      'config.logging.backup_count',
      'config.logging.level',
      'config.logging.max_size_mb',
    ],
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    group: 'System',
    ownership: 'self-saving',
  },
  {
    id: 'network',
    label: 'Network',
    group: 'System',
    ownership: 'store',
    keys: ['config.network.force_ipv4'],
  },
  {
    id: 'performance',
    label: 'Performance',
    group: 'System',
    ownership: 'read-only',
  },
  {
    id: 'updates',
    label: 'Updates',
    group: 'System',
    ownership: 'self-saving',
  },

  // ── Other ───────────────────────────────────────────────────────────────
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    group: 'Shortcuts',
    ownership: 'read-only',
  },
  {
    /**
     * Schema-generated browser over every field `GET /api/config/schema`
     * publishes — 555 of them against the 48 the curated sections hand-maintain.
     *
     * `keyPrefixes: ['config.']` is a deliberate fail-open catch-all: an orphan
     * key (one no curated section declares) still resolves to a section, so it
     * still lights a sidebar dot instead of going dirty invisibly. Because
     * `sectionIdsForKey` resolves exact-before-prefix, a curated section's own
     * keys are never stolen by it — `section-registry.test.ts` pins that, so
     * the catch-all cannot mask a genuine registry gap.
     */
    id: 'all-settings',
    label: 'All settings',
    group: 'Advanced',
    ownership: 'store',
    keyPrefixes: ['config.'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    group: 'Advanced',
    ownership: 'store',
    keys: ['config.logging.level'],
    defaults: { 'config.logging.level': 'INFO' },
  },
  {
    id: 'raw-config',
    label: 'Raw config',
    group: 'Advanced',
    ownership: 'self-saving',
  },
  {
    id: 'danger',
    label: 'Danger Zone',
    group: 'Danger',
    ownership: 'self-saving',
  },
]

export const SECTION_SPEC_BY_ID = new Map(SECTION_SPECS.map((s) => [s.id, s]))

/**
 * What the shell hands a section body. Every field is optional and every
 * existing section ignores all of them — 26 of the 28 sections take no props at
 * all and must stay that way.
 */
export type SectionProps = {
  /** The page-wide search text, for a section that can filter itself. */
  query?: string
}

/**
 * Section id → lazily-loaded body. Kept beside the specs so a new section
 * cannot be registered in one list and forgotten in the other;
 * `section-registry.test.ts` asserts the two stay in step.
 */
export const SECTION_COMPONENTS: Record<
  string,
  ComponentType<SectionProps> | undefined
> = {
  workspace: lazy(() => import('../sections/section-workspace')),
  account: lazy(() => import('../sections/section-account')),
  appearance: lazy(() => import('../sections/section-appearance')),
  notifications: lazy(() => import('../sections/section-notifications')),
  provider: lazy(() => import('../sections/section-provider')),
  'model-registry': lazy(() => import('../sections/section-model-registry')),
  'agent-runtime': lazy(() => import('../sections/section-agent-runtime')),
  execution: lazy(() => import('../sections/section-execution')),
  gateway: lazy(() => import('../sections/section-gateway')),
  'memory-wiki': lazy(() => import('../sections/section-memory-wiki')),
  skills: lazy(() => import('../sections/section-skills')),
  workflows: lazy(() => import('../sections/section-workflows')),
  'mcp-servers': lazy(() => import('../sections/section-mcp-servers')),
  'mcp-registered': lazy(() => import('../sections/section-mcp-registered')),
  'hermes-plugin': lazy(() => import('../sections/section-hermes-plugin')),
  storage: lazy(() => import('../sections/section-storage')),
  privacy: lazy(() => import('../sections/section-privacy')),
  safety: lazy(() => import('../sections/section-safety')),
  telemetry: lazy(() => import('../sections/section-telemetry')),
  'api-keys': lazy(() => import('../sections/section-api-keys')),
  network: lazy(() => import('../sections/section-network')),
  performance: lazy(() => import('../sections/section-performance')),
  updates: lazy(() => import('../sections/section-updates')),
  shortcuts: lazy(() => import('../sections/section-shortcuts')),
  'all-settings': lazy(() => import('../sections/section-all-settings')),
  advanced: lazy(() => import('../sections/section-advanced')),
  'raw-config': lazy(() => import('../sections/section-raw-config')),
  danger: lazy(() => import('../sections/section-danger')),
}

/**
 * key → section ids that declare it. `config.logging.level` is genuinely
 * edited from two sections (Telemetry and Advanced), so both dots must light.
 */
const EXACT_INDEX: Map<string, Array<string>> = (() => {
  const index = new Map<string, Array<string>>()
  for (const spec of SECTION_SPECS) {
    for (const key of spec.keys ?? []) {
      const owners = index.get(key)
      if (owners) owners.push(spec.id)
      else index.set(key, [spec.id])
    }
  }
  return index
})()

/** Prefix rules, longest first so the most specific claim wins. */
const PREFIX_INDEX: Array<{ prefix: string; id: string }> = SECTION_SPECS.flatMap(
  (spec) => (spec.keyPrefixes ?? []).map((prefix) => ({ prefix, id: spec.id })),
).sort((a, b) => b.prefix.length - a.prefix.length)

/** Every section that claims `key`, exact matches first. */
export function sectionIdsForKey(key: string): Array<string> {
  const exact = EXACT_INDEX.get(key)
  if (exact) return exact
  const prefixed = PREFIX_INDEX.find((entry) => key.startsWith(entry.prefix))
  return prefixed ? [prefixed.id] : []
}

/**
 * Only the sections that declare `key` **exactly** — prefix catch-alls
 * excluded. The All-settings browser uses this to mark a row that a curated
 * section already surfaces, so the two are not silently duplicated.
 */
export function curatedSectionIdsForKey(key: string): Array<string> {
  return EXACT_INDEX.get(key) ?? []
}

/** The section that owns `key`: exact beats prefix, longest prefix wins. */
export function sectionIdForKey(key: string): string | undefined {
  return sectionIdsForKey(key)[0]
}

export function sectionOwnsKey(spec: SectionSpec, key: string): boolean {
  if (spec.keys?.includes(key)) return true
  return (spec.keyPrefixes ?? []).some((prefix) => key.startsWith(prefix))
}

/**
 * Section ids with at least one dirty key. Iterates the dirty set, not the
 * cross-product of sections and keys — Wave 2 registers 555 keys.
 */
export function dirtySectionIds(dirty: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const key of dirty) {
    for (const id of sectionIdsForKey(key)) out.add(id)
  }
  return out
}
