/**
 * profile-choices.ts — turns the raw `/api/profiles/list` body into the cards
 * the agent-profile step renders.
 *
 * Two things separate this from the Agents screen's own row builder. First,
 * the synthetic `default` row is *kept*: `profiles-screen.tsx` filters it out
 * because it duplicates a named profile's identity in a management grid, but
 * an activation picker that drops it renders four cards with none marked
 * active on every install that has never written `~/.hermes/active_profile` —
 * which is the common case, since an absent pointer *is* `default` (the root
 * `~/.hermes/config.yaml`). Second, nothing here may throw: the payload is
 * `unknown` because a 401 body, a 500 body with `profiles: []`, or a network
 * shape from a different backend all reach this function.
 */
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'

export type ProfileChoice = {
  /** The id; a profile's identity is its directory name. */
  name: string
  /** Display name. */
  label: string
  /** Two/three-char monogram, e.g. 'HS'. */
  glyph: string
  tier: 1 | 2 | 3 | null
  role: string | null
  description: string
  model: string | null
  isActive: boolean
  /** The synthetic root-config row. */
  isDefault: boolean
  isBuiltin: boolean
}

/** The name the gateway falls back to when no pointer file exists. */
export const DEFAULT_PROFILE_NAME = 'default'

const DEFAULT_LABEL = 'Default'
const DEFAULT_GLYPH = 'DF'
const DEFAULT_DESCRIPTION =
  'Runs the root ~/.hermes/config.yaml rather than a named agent profile.'

const BUILTIN_BY_ID = new Map(BUILTIN_AGENTS.map((agent) => [agent.id, agent]))

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(rec: Record<string, unknown> | null, key: string): string | null {
  const value = rec?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function list(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : []
}

function tierOf(value: unknown): 1 | 2 | 3 | null {
  return value === 1 || value === 2 || value === 3 ? value : null
}

/** Fallback monogram for a profile with no `agent_ui.glyph` and no builtin. */
function monogram(name: string): string {
  const letters = name.replace(/[^a-z0-9]/gi, '')
  const source = letters || name
  return (source.slice(0, 2) || '??').toUpperCase()
}

function defaultChoice(isActive: boolean, model: string | null): ProfileChoice {
  return {
    name: DEFAULT_PROFILE_NAME,
    label: DEFAULT_LABEL,
    glyph: DEFAULT_GLYPH,
    tier: null,
    role: null,
    description: DEFAULT_DESCRIPTION,
    model,
    isActive,
    isDefault: true,
    isBuiltin: false,
  }
}

function choiceFrom(
  row: Record<string, unknown>,
  activeName: string,
): ProfileChoice | null {
  const name = str(row, 'name')
  if (!name) return null

  const ui = record(row.agent_ui)
  const builtin = BUILTIN_BY_ID.get(name)
  const isActive = name === activeName

  if (name === DEFAULT_PROFILE_NAME) {
    return defaultChoice(isActive, str(row, 'model'))
  }

  return {
    name,
    label: builtin?.name ?? name,
    glyph: str(ui, 'glyph') ?? builtin?.glyph ?? monogram(name),
    tier: tierOf(ui?.tier) ?? builtin?.tier ?? null,
    role: str(ui, 'role') ?? builtin?.role ?? null,
    description: str(row, 'description') ?? builtin?.description ?? '',
    model: str(row, 'model'),
    isActive,
    isDefault: false,
    isBuiltin: builtin !== undefined,
  }
}

/**
 * Active first, then tier 1, then tier 2, then everything else — stable
 * within each band, so the order the API returned survives inside a band.
 */
function rankOf(choice: ProfileChoice): number {
  if (choice.isActive) return 0
  if (choice.tier === 1) return 1
  if (choice.tier === 2) return 2
  return 3
}

export function buildProfileChoices(payload: unknown): Array<ProfileChoice> {
  const body = record(payload)
  // An absent or blank pointer means the root config is what runs.
  const activeName = str(body, 'activeProfile') ?? DEFAULT_PROFILE_NAME

  const choices: Array<ProfileChoice> = []
  const seen = new Set<string>()

  for (const entry of list(body?.profiles)) {
    const row = record(entry)
    if (!row) continue
    const choice = choiceFrom(row, activeName)
    if (!choice || seen.has(choice.name)) continue
    seen.add(choice.name)
    choices.push(choice)
  }

  // The API only emits the synthetic row while it is the active one, and a
  // malformed body emits nothing at all — but "run the root config" is always
  // a real, selectable state, so the card is always offered.
  if (!seen.has(DEFAULT_PROFILE_NAME)) {
    choices.unshift(defaultChoice(activeName === DEFAULT_PROFILE_NAME, null))
  }

  // Whatever the pointer named, something has to read as active. A pointer to
  // a profile that no longer exists on disk leaves the root config running,
  // which is exactly what the gateway does too.
  if (!choices.some((choice) => choice.isActive)) {
    const fallback = choices.find((choice) => choice.isDefault)
    if (fallback) fallback.isActive = true
  }

  return choices
    .map((choice, index) => ({ choice, index }))
    .sort(
      (left, right) =>
        rankOf(left.choice) - rankOf(right.choice) || left.index - right.index,
    )
    .map((entry) => entry.choice)
}

export function activeProfileLabel(
  choices: Array<ProfileChoice>,
): string | null {
  return choices.find((choice) => choice.isActive)?.label ?? null
}
