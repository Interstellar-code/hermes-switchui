/**
 * memory-choices.ts — turns the memory catalog plus the gateway's own
 * readiness read into the cards the memory step renders.
 *
 * Two inputs, both untrustworthy in different ways. `activeProvider` comes
 * from `/api/claude-config`, which may name a plugin this UI has never heard
 * of. `gatewayMemory` is the raw `GET /api/memory` body, which is `unknown`
 * because it arrives through a proxy that can hand back a 401 body, a FastAPI
 * `{detail: …}` error, or nothing at all when the dashboard is not running.
 *
 * The honesty rule this module exists to keep: when the readiness read is
 * missing or unparseable, every status is `'unknown'` — never `'ready'`, and
 * never a failure. A step that cannot check must say it could not check, not
 * claim the provider will load and not claim it is broken. Nothing here throws.
 */
import type { MemorySetupKind } from '@/lib/memory-provider-catalog'
import { MEMORY_PROVIDER_CATALOG } from '@/lib/memory-provider-catalog'

/**
 * The gateway's own verdict, hyphenated to house style. `'unknown'` has no
 * gateway equivalent — it is what this module substitutes when it has no
 * readiness read at all.
 */
export type MemoryStatus =
  | 'ready'
  | 'needs-config'
  | 'unavailable'
  | 'missing'
  | 'unknown'

export type MemoryChoice = {
  id: string
  label: string
  desc: string
  setup: MemorySetupKind
  local: boolean
  recommended: boolean
  isActive: boolean
  status: MemoryStatus
  /** One line on what this one needs before it will work. */
  requirement: string | null
}

/**
 * What each setup kind costs the user, in the plainest terms available without
 * knowing the provider's own config schema. A `none` provider costs nothing,
 * which is the whole reason one of them can be recommended.
 */
const REQUIREMENT_BY_SETUP: Record<MemorySetupKind, string | null> = {
  none: null,
  'api-key': 'Needs an API key stored in ~/.hermes/.env before it will load.',
  service: 'Needs its own service running and reachable from this machine.',
  oauth: 'Needs a sign-in with the provider before it will load.',
  cli: 'Needs its command-line tool installed on this machine first.',
}

/**
 * Explicitly partial: the lookup key is a string off the wire, so a word this
 * table does not list has to come back `undefined` rather than be assumed
 * present.
 */
const STATUS_BY_GATEWAY_VALUE: Record<string, MemoryStatus | undefined> = {
  ready: 'ready',
  needs_config: 'needs-config',
  unavailable: 'unavailable',
  missing: 'missing',
}

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

/**
 * `name → status` from the gateway body. A body that is null, an error object,
 * or an array of things that are not provider rows yields an empty map, and an
 * empty map is what makes every card read `'unknown'`.
 */
function statusesFrom(gatewayMemory: unknown): Map<string, MemoryStatus> {
  const out = new Map<string, MemoryStatus>()
  const rows = record(gatewayMemory)?.providers
  if (!Array.isArray(rows)) return out

  for (const entry of rows) {
    const row = record(entry)
    const name = str(row, 'name')
    if (!name) continue
    const status = STATUS_BY_GATEWAY_VALUE[str(row, 'status') ?? '']
    // A row with an unrecognised status word is no better than no row at all.
    if (status) out.set(name, status)
  }

  return out
}

/**
 * Active first, then the recommendation, then the other zero-setup local
 * providers, then everything else — stable within each band.
 *
 * The active card is hoisted above the recommended one deliberately: on a
 * machine that is already running a provider, "what am I on" is the question
 * the step has to answer before "what should I switch to", and burying the
 * live one under a recommendation is how a picker talks a user into a change
 * they did not need.
 */
function rankOf(choice: MemoryChoice): number {
  if (choice.isActive) return 0
  if (choice.recommended) return 1
  if (choice.setup === 'none' && choice.local) return 2
  return 3
}

export function buildMemoryChoices(input: {
  activeProvider: string | null
  /** The `GET /api/memory` payload; may be null. */
  gatewayMemory: unknown
}): Array<MemoryChoice> {
  const statuses = statusesFrom(input.gatewayMemory)
  const active = (input.activeProvider ?? '').trim()

  const choices: Array<MemoryChoice> = MEMORY_PROVIDER_CATALOG.map((info) => ({
    id: info.id,
    label: info.label,
    desc: info.desc,
    setup: info.setup,
    local: info.local,
    recommended: info.recommended === true,
    isActive: info.id === active,
    status: statuses.get(info.id) ?? 'unknown',
    requirement: REQUIREMENT_BY_SETUP[info.setup],
  }))

  // A provider the config names but the catalog has never heard of still has
  // to appear, or the step repeats the bug the catalog was widened to fix: a
  // machine whose active provider is invisible in the one picker meant to
  // show it. It gets no description it cannot honestly give.
  if (active && !choices.some((choice) => choice.isActive)) {
    choices.push({
      id: active,
      label: active,
      desc: 'Installed on this machine but not described by this workspace.',
      setup: 'none',
      local: false,
      recommended: false,
      isActive: true,
      status: statuses.get(active) ?? 'unknown',
      requirement: null,
    })
  }

  return choices
    .map((choice, index) => ({ choice, index }))
    .sort(
      (left, right) =>
        rankOf(left.choice) - rankOf(right.choice) || left.index - right.index,
    )
    .map((entry) => entry.choice)
}

export function activeMemoryLabel(choices: Array<MemoryChoice>): string | null {
  return choices.find((choice) => choice.isActive)?.label ?? null
}
