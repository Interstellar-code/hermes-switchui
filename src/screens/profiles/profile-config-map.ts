import type { MemoryProvider, ProfileConfig } from '@/server/profiles-browser'
import type { NewAgentDraft } from './types'

// ── draftFromConfig ───────────────────────────────────────────────────────────
// Reverse of the create payload — hydrates a NewAgentDraft from a ProfileConfig.

export function draftFromConfig(name: string, config: ProfileConfig): NewAgentDraft {
  const modelObj = typeof config.model === 'object' ? config.model : null
  const modelStr = typeof config.model === 'string' ? config.model : ''

  return {
    name,
    glyph: config.agent_ui?.glyph ?? '',
    role: config.agent_ui?.role ?? config.description ?? '',
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

// ── configPreviewFromDraft ────────────────────────────────────────────────────
// Builds a config.yaml-shaped object mirroring the create payload.

export function configPreviewFromDraft(draft: NewAgentDraft, tier = 3): Record<string, unknown> {
  const obj: Record<string, unknown> = {}

  const description = draft.role || draft.name
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

// ── maskSecrets ───────────────────────────────────────────────────────────────
// Deep-clones obj; replaces secret string values with truncated + masked form.
// Does NOT mask key_env (it's an env-var name, not a secret).

const SECRET_KEY_RE = /^(api_?key|secret|token|password|authorization)$/i

export function maskSecrets(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(maskSecrets)
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k) && typeof v === 'string') {
        result[k] = v.slice(0, 6) + '…••••'
      } else {
        result[k] = maskSecrets(v)
      }
    }
    return result
  }
  return obj
}
