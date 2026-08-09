import type { MemoryProvider, ProfileConfig } from '@/server/profiles-browser'
import type { NewAgentDraft } from './types'
import { mergeProfileConfig } from '@/lib/profile-merge'
import { maskSecrets } from '@/lib/secret-mask'

/**
 * Re-exported so the wizard's config step and the profile detail drawer can
 * keep importing `maskSecrets` from this module. The implementation lives in
 * `@/lib/secret-mask`, which the server's profile export shares — masking has
 * to mean the same thing in a preview and in a bundle handed to somebody else.
 */
export { maskSecrets }

// ── draftFromConfig ───────────────────────────────────────────────────────────
// Reverse of the create payload — hydrates a NewAgentDraft from a ProfileConfig.

export function draftFromConfig(name: string, config: ProfileConfig): NewAgentDraft {
  const modelObj = typeof config.model === 'object' ? config.model : null
  const modelStr = typeof config.model === 'string' ? config.model : ''

  return {
    name,
    glyph: config.agent_ui?.glyph ?? '',
    // P-08: role and description are independent fields. role comes ONLY from
    // agent_ui.role (the short card label); description comes ONLY from the
    // top-level config.description (the longer blurb). They used to be
    // conflated here (role fell back to config.description), which silently
    // destroyed the description the first time the editor was opened and
    // saved — see resolveDescription()/configPreviewFromDraft() below.
    role: config.agent_ui?.role ?? '',
    description: config.description ?? '',
    tags: config.agent_ui?.tags ?? [],
    persona_id: config.agent_ui?.persona_id ?? null,
    system_prompt: config.system_prompt ?? '',
    model: modelObj?.default ?? modelStr,
    provider: modelObj?.provider ?? '',
    max_turns: config.agent?.max_turns ?? 200,
    reasoning_effort: config.agent?.reasoning_effort ?? 'medium',
    skill_dirs: config.skills?.external_dirs ?? [],
    mcp_servers: config.mcp_servers ?? {},
    memory_enabled: config.memory?.memory_enabled ?? false,
    memory_provider: config.memory?.provider ?? 'hindsight',
    disabled_toolsets: config.agent?.disabled_toolsets ?? [],
  }
}

// ── resolveDescription ────────────────────────────────────────────────────────
// The single place that decides what `description` gets written to
// config.yaml. Prefers the draft's own (possibly multi-line) description;
// falls back to role/name ONLY when the description is genuinely empty, so
// profiles that never had a description keep their pre-P-08 behaviour.

export function resolveDescription(
  draft: Pick<NewAgentDraft, 'description' | 'role' | 'name'>,
): string {
  return draft.description.trim() || draft.role || draft.name
}

// ── configPreviewFromDraft ────────────────────────────────────────────────────
// Builds a config.yaml-shaped object mirroring the create payload.

export function configPreviewFromDraft(draft: NewAgentDraft, tier = 3): Record<string, unknown> {
  const obj: Record<string, unknown> = {}

  const description = resolveDescription(draft)
  if (description) obj.description = description
  if (draft.system_prompt) obj.system_prompt = draft.system_prompt

  if (draft.model || draft.provider) {
    obj.model = {
      ...(draft.model ? { default: draft.model } : {}),
      ...(draft.provider ? { provider: draft.provider } : {}),
    }
  }

  if (Object.keys(draft.mcp_servers).length > 0) {
    obj.mcp_servers = draft.mcp_servers
  }

  if (draft.skill_dirs.length > 0) {
    obj.skills = { external_dirs: draft.skill_dirs }
  }

  obj.memory = {
    memory_enabled: draft.memory_enabled,
    provider: draft.memory_provider,
  }

  obj.agent = {
    max_turns: draft.max_turns,
    reasoning_effort: draft.reasoning_effort,
    ...(draft.disabled_toolsets.length > 0 ? { disabled_toolsets: draft.disabled_toolsets } : {}),
  }

  obj.agent_ui = {
    tier,
    glyph: draft.glyph,
    role: draft.role,
    status: 'draft',
    tags: draft.tags,
    persona_id: draft.persona_id,
  }

  return obj
}

// ── buildUpdatePayload / buildCreatePayload ───────────────────────────────────
// Single source of truth for the POST bodies sent by the wizard's Save/Create
// actions. Centralising this (rather than inlining object literals in
// agent-wizard.tsx) means the diff computed in predictMergedConfig() below can
// never drift from what actually gets sent over the wire.

export function buildUpdatePayload(draft: NewAgentDraft): Record<string, unknown> {
  return {
    name: draft.name,
    description: resolveDescription(draft),
    system_prompt: draft.system_prompt,
    model: { default: draft.model, provider: draft.provider },
    mcp_servers: draft.mcp_servers,
    skills: { external_dirs: draft.skill_dirs },
    memory: {
      memory_enabled: draft.memory_enabled,
      provider: draft.memory_provider,
    },
    agent: {
      max_turns: draft.max_turns,
      reasoning_effort: draft.reasoning_effort,
      disabled_toolsets: draft.disabled_toolsets,
    },
    agent_ui: {
      glyph: draft.glyph,
      role: draft.role,
      tags: draft.tags,
      persona_id: draft.persona_id,
    },
  }
}

export function buildCreatePayload(draft: NewAgentDraft, tier = 3): Record<string, unknown> {
  const { agent_ui, ...rest } = buildUpdatePayload(draft)
  return {
    ...rest,
    agent_ui: {
      tier,
      ...(agent_ui as Record<string, unknown>),
      status: 'draft',
    },
  }
}

// ── predictMergedConfig ───────────────────────────────────────────────────────
// Predicts the config.yaml the server will write when the current edit-mode
// draft is saved over `current`. It does not *mirror* updateProfileConfig()'s
// merge — it DELEGATES to it: both call sites now run the one
// `mergeProfileConfig` in `@/lib/profile-merge`. Nested objects (agent,
// agent_ui, memory, skills) merge key-by-key, so a key the draft's patch
// doesn't touch SURVIVES from `current` — except `mcp_servers`, which is
// replaced wholesale. Getting this right matters: a naive "after" preview
// built purely from the draft would make every field the wizard doesn't model
// (or leaves at its own defaults) look like it's being deleted, when in fact
// the deep-merge leaves it untouched.
//
// This function used to carry its own replica of that algorithm
// (REPLACE_WHOLE_CONFIG_KEYS + deepMergeInPlace). `profile-merge.contract.test.ts`
// asserted the two agreed; with the replica gone it now asserts they are
// literally the same code.

export function predictMergedConfig(
  current: ProfileConfig,
  draft: NewAgentDraft,
): Record<string, unknown> {
  // JSON round-trip clone: `current` always came from YAML.parse(), so it is
  // plain-data-safe (no functions, Dates, etc) — and `mergeProfileConfig`
  // mutates its first argument, which must not be the caller's config.
  const result = JSON.parse(JSON.stringify(current)) as Record<string, unknown>

  const patch = buildUpdatePayload(draft)
  delete patch.name // identifies the profile; never part of config.yaml itself

  return mergeProfileConfig(result, patch)
}

// ── diffLines ─────────────────────────────────────────────────────────────────
// Small line-level diff (LCS-based) between two multi-line strings, used to
// show "before → after" YAML in the wizard's review-before-save step. Not a
// merge tool — just a review aid, so plain added/removed/unchanged
// classification is enough.

export type DiffLineType = 'added' | 'removed' | 'unchanged'
export type DiffLine = { type: DiffLineType; text: string }

export function diffLines(before: string, after: string): Array<DiffLine> {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length

  // dp[i][j] = length of the LCS of a[i..] and b[j..]
  const dp: Array<Int32Array> = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: Array<DiffLine> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'unchanged', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'removed', text: a[i] })
      i++
    } else {
      result.push({ type: 'added', text: b[j] })
      j++
    }
  }
  while (i < n) {
    result.push({ type: 'removed', text: a[i] })
    i++
  }
  while (j < m) {
    result.push({ type: 'added', text: b[j] })
    j++
  }
  return result
}
