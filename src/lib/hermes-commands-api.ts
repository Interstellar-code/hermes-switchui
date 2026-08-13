import { useQuery } from '@tanstack/react-query'

/**
 * Client access to the live Hermes agent command catalog served by
 * `GET /api/hermes-commands` (see `src/routes/api/hermes-commands.ts`).
 *
 * The route computes the tier policy server-side
 * (`src/server/hermes-command-tiers.ts`) so the menu, the routing layer, and any
 * future exec surface all read one answer. This module is a thin, total reader:
 * it never throws on a degraded agent and never invents a tier.
 *
 * Degradation contract: when the dashboard (:9119) is absent the `agentCommands`
 * capability is false and the route answers **503** with
 * `mode: 'agent-commands-unavailable'`. That is a *normal* state, not an error —
 * `fetchHermesCommandCatalog` maps it to an empty catalog so every caller
 * degrades to SwitchUI's own local command set with no extra branch.
 */

export type HermesCommandTier = 'local' | 'proxy' | 'prompt' | 'excluded'

export type HermesAgentCommand = {
  /** Canonical command including the leading slash, e.g. `/background`. */
  command: string
  /** Prose only — the trailing `(usage: …)` is split off into `usage`. */
  description: string
  /**
   * The argument shape to render beside the command token, e.g. `[<days
   * 1-365>]`. Derived server-side from the exec policy, NOT copied from the
   * agent's `args_hint`: the agent describes its own CLI, where `/reasoning`
   * takes five subcommands and a `--global` flag that this transport refuses.
   * Absent ⇒ the command advertises no argument form (usually because it takes
   * none).
   */
  usage?: string
  category: string
  subcommands?: Array<string>
  tier: HermesCommandTier
  /**
   * Whether `POST /api/hermes-commands/exec` would actually run this. Computed
   * server-side from the exec allowlist so the picker cannot advertise
   * something the server refuses (§8a). Absent/false ⇒ not advertised.
   */
  runnable: boolean
  /** True for the uncategorized skill-command tail. */
  skill: boolean
  /**
   * True for a skill-bundle slug — one command that loads several skills.
   * Mutually exclusive with `skill` (bundles arrive categorized, skills do
   * not), and the axis the picker's Bundles facet filters on.
   */
  bundle: boolean
}

export type HermesCommandCatalog = {
  /** False when the capability is off or the catalog RPC failed. */
  available: boolean
  commands: Array<HermesAgentCommand>
  /** Category names in the order the agent returned them. */
  categories: Array<string>
  /** Alias → canonical, lowercased keys. e.g. `/fork` → `/branch`. */
  aliases: Record<string, string>
  skillCount: number
  /** How many dispatchable bundle slugs the catalog served. 0 on older agents. */
  bundleCount: number
  /** Non-fatal agent-side warning (skill / quick_commands discovery failure). */
  warning: string
}

export const EMPTY_HERMES_COMMAND_CATALOG: HermesCommandCatalog = {
  available: false,
  commands: [],
  categories: [],
  aliases: {},
  skillCount: 0,
  bundleCount: 0,
  warning: '',
}

export const hermesCommandKeys = {
  all: ['hermes-commands'] as const,
  catalog: () => ['hermes-commands', 'catalog'] as const,
}

const TIERS: ReadonlySet<string> = new Set([
  'local',
  'proxy',
  'prompt',
  'excluded',
])

function normalizeEntry(value: unknown): HermesAgentCommand | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  if (!command.startsWith('/')) return null

  // An unrecognized tier fails closed. A menu entry with no honest tier is
  // worse than a missing one: the routing layer keys dispatch off this field.
  const tier =
    typeof raw.tier === 'string' && TIERS.has(raw.tier)
      ? (raw.tier as HermesCommandTier)
      : 'excluded'

  const subcommands = Array.isArray(raw.subcommands)
    ? raw.subcommands.filter(
        (entry): entry is string => typeof entry === 'string' && entry.length > 0,
      )
    : []

  // Absent is the common case (bare-only commands, and anything the agent gave
  // no `args_hint`), and it is also the fail-closed case: a payload with no
  // `usage` renders no hint rather than an invented one.
  const usage = typeof raw.usage === 'string' ? raw.usage.trim() : ''

  return {
    command,
    description: typeof raw.description === 'string' ? raw.description : '',
    ...(usage ? { usage } : {}),
    category: typeof raw.category === 'string' && raw.category ? raw.category : 'Other',
    ...(subcommands.length > 0 ? { subcommands } : {}),
    tier,
    // Fails closed: a payload that predates the field, or carries a non-boolean,
    // is treated as "not runnable" and therefore never advertised.
    runnable: raw.runnable === true,
    skill: raw.skill === true,
    // Same fail-closed rule: a payload from before the bundle pass carries no
    // `bundle` field and degrades to "not a bundle", which is the truth for it.
    bundle: raw.bundle === true,
  }
}

/** Total: a malformed payload yields an empty catalog rather than throwing. */
export function normalizeHermesCommandCatalog(payload: unknown): HermesCommandCatalog {
  if (!payload || typeof payload !== 'object') return EMPTY_HERMES_COMMAND_CATALOG
  const raw = payload as Record<string, unknown>
  if (raw.ok !== true) return EMPTY_HERMES_COMMAND_CATALOG

  const commands: Array<HermesAgentCommand> = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(raw.commands) ? raw.commands : []) {
    const normalized = normalizeEntry(entry)
    if (!normalized) continue
    const key = normalized.command.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    commands.push(normalized)
  }

  const categories = (Array.isArray(raw.categories) ? raw.categories : []).filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  )

  const aliases: Record<string, string> = {}
  if (raw.aliases && typeof raw.aliases === 'object') {
    for (const [alias, canonical] of Object.entries(
      raw.aliases as Record<string, unknown>,
    )) {
      if (typeof canonical !== 'string' || !canonical.startsWith('/')) continue
      const key = alias.trim().toLowerCase()
      if (!key.startsWith('/')) continue
      if (key === canonical.toLowerCase()) continue
      aliases[key] = canonical
    }
  }

  return {
    available: commands.length > 0,
    commands,
    categories,
    aliases,
    skillCount:
      typeof raw.skillCount === 'number' && Number.isFinite(raw.skillCount)
        ? raw.skillCount
        : 0,
    bundleCount:
      typeof raw.bundleCount === 'number' && Number.isFinite(raw.bundleCount)
        ? raw.bundleCount
        : 0,
    warning: typeof raw.warning === 'string' ? raw.warning : '',
  }
}

export async function fetchHermesCommandCatalog(): Promise<HermesCommandCatalog> {
  const response = await fetch('/api/hermes-commands')

  // 503 is the documented "capability off" answer, not a failure. 401 means the
  // workspace session lapsed; the rest of the app already surfaces that, so the
  // command menu just goes quiet instead of retry-storming.
  if (response.status === 503 || response.status === 401) {
    return EMPTY_HERMES_COMMAND_CATALOG
  }
  if (!response.ok) {
    throw new Error(`Command catalog request failed: ${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  return normalizeHermesCommandCatalog(payload)
}

/**
 * The live agent command catalog. Returns an empty catalog (`commands: []`)
 * whenever the `agentCommands` capability is off, so callers can merge
 * unconditionally.
 */
export function useHermesCommandCatalog() {
  const query = useQuery({
    queryKey: hermesCommandKeys.catalog(),
    queryFn: fetchHermesCommandCatalog,
    staleTime: 60_000,
    // The server already TTL-caches for 60s; a client retry loop would only add
    // load while the dashboard is down.
    retry: false,
    refetchOnWindowFocus: false,
  })

  return {
    ...query,
    data: query.data ?? EMPTY_HERMES_COMMAND_CATALOG,
  }
}

// ── Execution (`POST /api/hermes-commands/exec`) ──────────────────────────

/**
 * The discriminated union `command.dispatch` / `slash.exec` answer with, as
 * normalized by `server/hermes-slash-exec.ts`.
 */
export type AgentCommandResult =
  | { type: 'exec'; output: string; warning?: string }
  | { type: 'plugin'; output: string; warning?: string }
  | { type: 'send'; message: string; notice?: string }
  | { type: 'skill'; message: string; name?: string }
  | { type: 'prefill'; message: string; notice?: string }
  | { type: 'alias'; target: string }

/**
 * How the exec route classified a failure (`kind` in its body, from
 * `server/hermes-slash-exec.ts::classifySlashFailure`).
 *
 * The first five are the caller's problem and carry the **agent's own message**;
 * the last two are the agent's. `refusal` is this module's own label for the
 * 403 policy path, which the route reports through `reason` rather than `kind`.
 */
export type AgentCommandFailureKind =
  | 'refusal'
  | 'invalid-input'
  | 'unroutable'
  | 'session-gone'
  | 'busy'
  | 'rate-limited'
  | 'agent-error'
  | 'timeout'

/**
 * Fields shared by both failure arms.
 *
 * `guidance` is the one a renderer wants: true means "tell the user this",
 * false means "something broke". A policy refusal and a `usage: /subgoal
 * remove <n>` are both guidance; a wedged slash worker is not. Optional so a
 * response from an older server — or a test double that predates the field —
 * still type-checks; treat an absent value as false.
 */
type AgentCommandFailureInfo = {
  guidance?: boolean
  kind?: AgentCommandFailureKind
  /** The agent's raw JSON-RPC code (4004, 5030, …) when there was one. */
  agentCode?: number
}

const FAILURE_KINDS: ReadonlySet<string> = new Set([
  'refusal',
  'invalid-input',
  'unroutable',
  'session-gone',
  'busy',
  'rate-limited',
  'agent-error',
  'timeout',
])

/** An unrecognized `kind` is dropped rather than passed through as a string. */
function readFailureKind(value: unknown): AgentCommandFailureKind | undefined {
  return typeof value === 'string' && FAILURE_KINDS.has(value)
    ? (value as AgentCommandFailureKind)
    : undefined
}

export type AgentCommandOutcome =
  | { ok: true; command: string; result: AgentCommandResult }
  /** The server allowlist said no. `reason` is written for the user. */
  | ({ ok: false; command: string; reason: string; refused: true } & AgentCommandFailureInfo)
  /** Transport/agent failure — not a policy decision. */
  | ({ ok: false; command: string; reason: string; refused: false } & AgentCommandFailureInfo)

/**
 * Run an agent command. Never throws: a transport failure comes back as
 * `{ok:false, refused:false}` so the caller has exactly two branches, and a
 * failed command can never fall through to the model as prose.
 *
 * A failure also carries `guidance`/`kind`/`agentCode`, so a caller that wants
 * three branches — ran / you-typed-it-wrong / it-broke — can have them without
 * reading `response.status`.
 */
export async function execAgentCommand(payload: {
  command: string
  sessionId?: string | null
}): Promise<AgentCommandOutcome> {
  const command = payload.command.trim()
  try {
    const response = await fetch('/api/hermes-commands/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command,
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
      }),
    })
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null

    if (response.ok && body?.ok === true && body.result) {
      return {
        ok: true,
        command: typeof body.command === 'string' ? body.command : command,
        result: body.result as AgentCommandResult,
      }
    }

    const reason =
      (typeof body?.reason === 'string' && body.reason) ||
      (typeof body?.error === 'string' && body.error) ||
      `Command failed (${response.status})`

    // A 403 is the allowlist, and it has always been guidance. Everything else
    // takes the route's own classification; an unclassified body (older server,
    // a 401, a non-JSON error page) degrades to "not guidance", which is the
    // conservative direction — it shows as an error rather than as advice.
    const refused = response.status === 403
    const kind: AgentCommandFailureKind | undefined = refused
      ? 'refusal'
      : readFailureKind(body?.kind)
    return {
      ok: false,
      command,
      reason,
      refused,
      guidance: refused || body?.guidance === true,
      ...(kind ? { kind } : {}),
      ...(typeof body?.agentCode === 'number'
        ? { agentCode: body.agentCode }
        : {}),
    }
  } catch (error) {
    return {
      ok: false,
      command,
      reason:
        error instanceof Error ? error.message : 'Could not reach the agent',
      refused: false,
      guidance: false,
      kind: 'agent-error',
    }
  }
}

/** Resolve an alias (`/fork`) to its canonical name (`/branch`). */
export function resolveCommandAlias(
  catalog: HermesCommandCatalog,
  token: string,
): string {
  const key = token.trim().toLowerCase()
  return catalog.aliases[key] ?? token.trim()
}

/**
 * Look a token up in the catalog, following aliases. Returns `null` for tokens
 * the agent does not know — those are free-typed text, not commands.
 */
export function findAgentCommand(
  catalog: HermesCommandCatalog,
  token: string,
): HermesAgentCommand | null {
  const canonical = resolveCommandAlias(catalog, token).toLowerCase()
  if (!canonical.startsWith('/')) return null
  return (
    catalog.commands.find((entry) => entry.command.toLowerCase() === canonical) ??
    null
  )
}
