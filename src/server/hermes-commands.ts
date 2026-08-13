/**
 * Normalized Hermes agent command catalog, backed by the `commands.catalog`
 * JSON-RPC method on the dashboard's `/api/ws` sidecar.
 *
 * `commands.catalog` is unusual among the tui_gateway RPCs in that it needs no
 * session: unlike `slash.exec` it never calls `_sess_nowait`, it just reads
 * `COMMAND_REGISTRY` (+ `_TUI_EXTRA`, `quick_commands`, and `scan_skill_commands`)
 * and returns. Verified against `tui_gateway/server.py`. So there is no
 * tui_gateway session lifecycle to manage here — connect, ask, done.
 *
 * Raw shape (`_ok` payload), re-read from the live agent (v0.19.16) on
 * 2026-08-13 — the last two keys are new in that build:
 *   { pairs: [[cmd, desc], …],
 *     sub:   { "/reasoning": ["low", …] },
 *     canon: { "/fork": "/branch", … },
 *     categories: [{ name, pairs }],
 *     skill_count: number,
 *     bundles: [{ command, name, description, skills }],
 *     bundle_count: number,
 *     warning: string }
 *
 * Three live-behaviour details the normalizer has to absorb:
 *   • Skill commands are appended to `pairs` but to NO category. That absence
 *     is the only signal distinguishing them from registry commands, and the
 *     tier policy keys off it.
 *   • `pairs` can contain duplicates — `/sessions` appears both in the registry
 *     and in `_TUI_EXTRA`. First occurrence wins.
 *   • Skill-bundle slugs arrive **twice over**: once in the top-level `bundles`
 *     list, and again in `pairs` / `canon` / `categories` under a "Bundles"
 *     bucket the agent appends only when at least one bundle exists (the same
 *     pattern as its "User commands" bucket). See `bundleCommandSet` for how
 *     that is absorbed without double-counting or mis-tiering.
 *
 *   • Every description may carry a trailing `(usage: /cmd …)` — the registry's
 *     `args_hint`. It is split out here (`splitUsageHint`) and then CORRECTED
 *     against the exec policy (`slashUsageHint`), because the agent's hint
 *     describes its own CLI, not what this transport will run: `/reasoning`
 *     advertises five subcommands and a `--global` flag, all six refused.
 *
 * Measured live on 2026-08-13: 156 pairs, `skill_count: 78`, 6 categories,
 * `bundles: []` and `bundle_count: 0` — the keys exist, the arrays are empty,
 * and no "Bundles" bucket is present because there is nothing to put in it. So
 * the empty path is this install's reality and the populated path is exercised
 * by fixture only.
 */

import { resolveCommandTier } from './hermes-command-tiers'
import {
  isBareOnlySlashCommand,
  isSlashCommandRunnable,
  slashArgumentCompletions,
  slashUsageHint,
} from './hermes-slash-policy'
import { getAgentVersion } from './hermes-agent-version'
import { hermesRpc } from './hermes-rpc'
import type { HermesCommandTier } from './hermes-command-tiers'

/** Bucket used for skill commands, which arrive without a category. */
export const SKILL_CATEGORY = 'Skills'

/**
 * The category the agent files bundle slugs under, and the fallback this
 * module uses for a bundle that somehow reached `bundles` without reaching any
 * `categories[]` bucket. Kept as a constant so the picker's facet and the
 * agent's own bucket name cannot drift apart silently.
 */
export const BUNDLE_CATEGORY = 'Bundles'

const CATALOG_TTL_MS = 60_000
const CATALOG_RPC_TIMEOUT_MS = 15_000

export type HermesCommand = {
  /** Canonical command including the leading slash, e.g. `/background`. */
  command: string
  /**
   * The prose, with the trailing `(usage: …)` the agent embeds in it split off
   * into `usage`. See `splitUsageHint`.
   */
  description: string
  /**
   * The argument shape the picker renders beside the command token, derived
   * from the exec policy (`slashUsageHint`) rather than copied from the agent.
   *
   * This is the third policy-derived field on this type, alongside `runnable`
   * and `subcommands`, and it is here for the same reason both of those are:
   * the picker and the exec route must read one answer. It was the last piece
   * of the catalog the policy did not touch, and it advertised refused forms
   * for **seven** commands, measured against the live catalog — `/reasoning
   * [level|show|hide|full|clamp] [--global]` next to a command that accepts
   * nothing at all, `/memory`, `/suggestions`, `/curator`, `/compress`,
   * `/debug` and `/goal`. Absent ⇒ render no hint.
   */
  usage?: string
  category: string
  subcommands?: Array<string>
  tier: HermesCommandTier
  /**
   * Whether `POST /api/hermes-commands/exec` would actually run this — i.e.
   * whether it is on the server-side allowlist (`hermes-slash-policy.ts`) or is
   * a skill command. Computed here so the picker and the exec route read one
   * answer and the menu can never advertise something the server refuses (§8a).
   *
   * Also carries the agent-version floor: below
   * `MIN_AGENT_VERSION_FOR_SLASH_EXEC` every allowlist entry is `false` here
   * while skills and bundle slugs stay `true`, so an old agent yields a picker
   * with its skills intact and no registry commands. This is a *hint*, not the
   * control — the exec route re-derives the same answer, from its own read of
   * the version, on every request.
   */
  runnable: boolean
  /** True for the uncategorized skill-command tail. */
  skill: boolean
  /**
   * True for a skill-bundle slug — a command that loads several skills at
   * once. Deliberately a second flag rather than a widening of `skill`:
   * bundles arrive categorized (so the skill signal cannot express them), they
   * have no `/api/skills` row to join against, and the picker keys three
   * user-visible behaviours off `skill`. See `hermes-slash-policy.ts`'s bundle
   * section for the full argument.
   */
  bundle: boolean
}

export type HermesCommandCatalog = {
  commands: Array<HermesCommand>
  /** Category names in the order the agent returned them. */
  categories: Array<string>
  /** Alias → canonical, e.g. `/fork` → `/branch`. Self-mappings dropped. */
  aliases: Record<string, string>
  skillCount: number
  /**
   * How many bundle slugs the catalog served. 0 on an agent older than
   * v0.19.16, which sends no `bundles` key at all — indistinguishable from a
   * v0.19.16 install with no bundles, and correctly so: both mean "nothing to
   * advertise".
   */
  bundleCount: number
  /** Non-fatal agent-side warning (skill or quick_commands discovery failure). */
  warning: string
}

type RawPair = [string, string] | Array<string>

/**
 * What the agent puts in each `bundles` element:
 * `{command, name, description, skills}`. Documented rather than declared on
 * `RawCatalog`, because the element type there is `unknown` on purpose — this
 * is an untrusted wire payload and every field has to be re-proved.
 */
type RawBundle = {
  command?: unknown
  name?: unknown
  description?: unknown
  skills?: unknown
}

type RawCatalog = {
  pairs?: Array<RawPair>
  sub?: Record<string, Array<string>>
  canon?: Record<string, string>
  categories?: Array<{ name?: unknown; pairs?: Array<RawPair> }>
  skill_count?: number
  bundles?: ReadonlyArray<unknown>
  bundle_count?: number
  warning?: unknown
}

/**
 * `commands.catalog` embeds the registry's `args_hint` inside the description
 * as a trailing `(usage: /cmd …)`. Split it back out so the hint can be
 * rendered next to the command token instead of buried in prose.
 *
 * This used to live in `slash-command-menu.tsx` and ran on the client. It moved
 * here because the *policy* correction applied to the hint
 * (`slashUsageHint`) needs the raw hint, and a client that re-parsed the
 * description would be a second place the "which forms are advertised?"
 * question is answered — the exact shape of the bug this pass removed. The
 * picker now renders `usage` verbatim.
 */
export function splitUsageHint(description: string): {
  description: string
  usage?: string
} {
  const match = /\s*\(usage:\s*(.+)\)\s*$/i.exec(description)
  if (!match) return { description: description.trim() }
  // The hint repeats the command name — drop it, the token is right there.
  const usage = match[1].replace(/^\/\S+\s*/, '').trim()
  const rest = description.slice(0, match.index).trim()
  return {
    description: rest || description.trim(),
    ...(usage ? { usage } : {}),
  }
}

function pairOf(entry: unknown): { command: string; description: string } | null {
  if (!Array.isArray(entry)) return null
  const command = typeof entry[0] === 'string' ? entry[0].trim() : ''
  if (!command) return null
  const description = typeof entry[1] === 'string' ? entry[1].trim() : ''
  return { command, description }
}

/**
 * The lowercased slugs named by the payload's top-level `bundles` list.
 *
 * ── Why this is a marker set and not a second source of commands ──────────
 * A bundle appears in BOTH `bundles` and `pairs`, so building entries from
 * each would list every bundle twice. `pairs` stays the single source of the
 * command list — the same "first occurrence wins" discipline that already
 * handles `/sessions` appearing in both the registry and `_TUI_EXTRA` — and
 * `bundles` is read only for the one fact `pairs` cannot carry: which of the
 * categorized entries is a bundle rather than a registry command.
 *
 * That fact is load-bearing twice over. Bundles land in a real
 * `categories[]` bucket, so `categorized` is true for them, and without this
 * set `resolveCommandTier` would fail them closed as `excluded` unknown
 * registry commands and `isSlashCommandRunnable` would want an allowlist entry
 * per slug. Both would hide a command the agent has already proved
 * dispatchable.
 *
 * A slug present in `bundles` but absent from `pairs` yields no entry at all.
 * That is the safe direction and it matches the agent's own stance: it would
 * rather hide a bundle than advertise one it cannot dispatch.
 */
function bundleCommandSet(payload: RawCatalog): Set<string> {
  const slugs = new Set<string>()
  for (const raw of Array.isArray(payload.bundles) ? payload.bundles : []) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as RawBundle
    const command = typeof entry.command === 'string' ? entry.command.trim() : ''
    if (!command.startsWith('/')) continue
    slugs.add(command.toLowerCase())
  }
  return slugs
}

/**
 * Turn a raw `commands.catalog` payload into the shape SwitchUI serves.
 * Pure and total — a malformed payload yields an empty catalog rather than
 * throwing, so a partially-broken agent degrades to "no agent commands".
 *
 * `agentVersion` is the version the agent reports, or null when it could not
 * be read; it decides `runnable` for the allowlisted commands and nothing
 * else. It is a required argument rather than an option with a permissive
 * default because `runnable` is not answerable without it, and a default that
 * guessed "new enough" would be the failure this floor exists to prevent.
 */
export function normalizeCommandCatalog(
  raw: unknown,
  options: { agentVersion: string | null },
): HermesCommandCatalog {
  const payload = (raw ?? {}) as RawCatalog
  const bundleSlugs = bundleCommandSet(payload)

  // command (lowercased) → category name. First category wins.
  const categoryOf = new Map<string, string>()
  const categories: Array<string> = []
  for (const bucket of Array.isArray(payload.categories) ? payload.categories : []) {
    const name = typeof bucket.name === 'string' ? bucket.name.trim() : ''
    if (!name) continue
    if (!categories.includes(name)) categories.push(name)
    for (const entry of Array.isArray(bucket.pairs) ? bucket.pairs : []) {
      const pair = pairOf(entry)
      if (!pair) continue
      const key = pair.command.toLowerCase()
      if (!categoryOf.has(key)) categoryOf.set(key, name)
    }
  }

  const sub = payload.sub && typeof payload.sub === 'object' ? payload.sub : {}

  const commands: Array<HermesCommand> = []
  const seen = new Set<string>()
  let sawSkillCommand = false

  for (const entry of Array.isArray(payload.pairs) ? payload.pairs : []) {
    const pair = pairOf(entry)
    if (!pair) continue
    const key = pair.command.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const category = categoryOf.get(key)
    const categorized = category !== undefined
    const bundle = bundleSlugs.has(key)
    // A bundle is categorized, so it can never be mistaken for the
    // uncategorized skill tail and can never inflate the Skills bucket.
    if (!categorized && !bundle) sawSkillCommand = true

    const rawSub = sub[pair.command] ?? sub[key]
    // Strip subcommands the exec route would refuse. `/tools` advertises
    // `[list|disable|enable]`, so the picker used to hold its menu open to
    // complete one, insert `/tools list`, and get a refusal for carrying
    // arguments — the UI walking the user into a guaranteed rejection.
    // Serving them at all is the bug; the picker is right to offer whatever
    // the catalog hands it.
    // An argument-restricted command supplies its own completions, because the
    // agent's catalog serves none for it: `sub` has no `/compress` key, so the
    // picker would otherwise insert `"/compress "`, dismiss, and leave the user
    // one Enter away from the refusal. The policy's permitted forms are the
    // only completions that can succeed, so they replace the catalog's.
    const allowedArgs = slashArgumentCompletions(pair.command)
    const subcommands =
      allowedArgs.length > 0
        ? allowedArgs
        : Array.isArray(rawSub) && !isBareOnlySlashCommand(pair.command)
          ? rawSub.filter((s): s is string => typeof s === 'string' && s.length > 0)
          : []

    // The agent's own hint, and then the policy's answer to it. A bare-only
    // command loses the hint entirely, an argument-restricted one has it
    // replaced by the permitted forms, and `/goal` keeps its own minus the four
    // phantom subcommands. Skills, bundles and everything not on the allowlist
    // keep the agent's wording — see `slashUsageHint`.
    const split = splitUsageHint(pair.description)
    const usage = slashUsageHint(pair.command, split.usage)

    commands.push({
      command: pair.command,
      description: split.description,
      ...(usage ? { usage } : {}),
      category: category ?? (bundle ? BUNDLE_CATEGORY : SKILL_CATEGORY),
      ...(subcommands.length > 0 ? { subcommands } : {}),
      tier: resolveCommandTier(pair.command, { categorized, bundle }),
      runnable: isSlashCommandRunnable(pair.command, {
        isSkillCommand: !categorized && !bundle,
        isBundleCommand: bundle,
        agentVersion: options.agentVersion,
      }),
      skill: !categorized && !bundle,
      bundle,
    })
  }

  if (sawSkillCommand && !categories.includes(SKILL_CATEGORY)) {
    categories.push(SKILL_CATEGORY)
  }
  // Normally redundant — the agent appends its own "Bundles" bucket to
  // `categories` whenever it emits a bundle, so this only fires for the
  // degenerate payload where `bundles` named a slug that reached `pairs` but no
  // bucket. Cheap insurance against a section header the picker would otherwise
  // render with no entry in the category list behind it.
  if (
    commands.some((entry) => entry.bundle) &&
    !categories.includes(BUNDLE_CATEGORY)
  ) {
    categories.push(BUNDLE_CATEGORY)
  }

  const aliases: Record<string, string> = {}
  const canon = payload.canon && typeof payload.canon === 'object' ? payload.canon : {}
  for (const [alias, canonical] of Object.entries(canon)) {
    if (typeof canonical !== 'string' || !canonical) continue
    if (alias.toLowerCase() === canonical.toLowerCase()) continue
    aliases[alias] = canonical
  }

  return {
    commands,
    categories,
    aliases,
    skillCount:
      typeof payload.skill_count === 'number' && Number.isFinite(payload.skill_count)
        ? payload.skill_count
        : 0,
    // Counted from the entries actually emitted, NOT from the agent's
    // `bundle_count` and not from the parsed `bundles` list. All three agree in
    // the live payload (0, and the agent computes its count as `len(bundles)`),
    // but they can diverge — a bundle named in `bundles` that never reached
    // `pairs` yields no entry — and only an emitted entry can be dispatched.
    // Reporting either of the other numbers would be the "advertise what you
    // cannot run" defect in miniature: a UI saying "3 bundles" over a menu
    // holding one.
    bundleCount: commands.reduce((total, entry) => total + (entry.bundle ? 1 : 0), 0),
    warning: typeof payload.warning === 'string' ? payload.warning : '',
  }
}

// ── TTL cache ─────────────────────────────────────────────────────
// Only successes are cached; a failure must be retried on the next request so
// starting the dashboard is picked up immediately rather than after the TTL.
//
// The raw payload is kept alongside the normalized value so a *version* change
// can be absorbed without a second RPC. Without that, `runnable` would be
// pinned to whatever version was current when the catalog was fetched and
// could disagree with the exec route for up to the 60s catalog TTL — the
// picker offering a command the server has just started refusing. The version
// read is itself cached for 10s in `hermes-agent-version.ts`, so the check
// below is a no-op in the common case.

let cached: {
  at: number
  raw: unknown
  agentVersion: string | null
  value: HermesCommandCatalog
} | null = null
let inflight: Promise<HermesCommandCatalog> | null = null

export function invalidateHermesCommandCatalog(): void {
  cached = null
  inflight = null
}

/** Timestamp of the cached catalog, or 0 when nothing is cached. */
export function hermesCommandCatalogCachedAt(): number {
  return cached?.at ?? 0
}

export async function getHermesCommandCatalog(options?: {
  force?: boolean
}): Promise<HermesCommandCatalog> {
  const force = options?.force === true
  if (!force && cached && Date.now() - cached.at < CATALOG_TTL_MS) {
    const agentVersion = await getAgentVersion()
    if (agentVersion === cached.agentVersion) return cached.value
    // The agent was restarted onto a different build under us. Re-derive
    // `runnable` from the payload already in hand rather than serving an
    // answer computed against a version that is no longer running.
    const value = normalizeCommandCatalog(cached.raw, { agentVersion })
    cached = { ...cached, agentVersion, value }
    return value
  }
  if (!force && inflight) return inflight

  inflight = (async () => {
    const [raw, agentVersion] = await Promise.all([
      hermesRpc<unknown>('commands.catalog', {}, {
        timeoutMs: CATALOG_RPC_TIMEOUT_MS,
      }),
      getAgentVersion(),
    ])
    const value = normalizeCommandCatalog(raw, { agentVersion })
    cached = { at: Date.now(), raw, agentVersion, value }
    return value
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/**
 * The three catalog-derived inputs the exec policy needs: the alias map (so
 * `/fork` cannot smuggle `/branch` past the allowlist), the set of skill
 * commands and the set of bundle slugs (both of which dispatch rather than
 * exec).
 *
 * Derived rather than hardcoded because all three are installation-specific —
 * the live agent here has 79 skill commands and none of them appear in any
 * static table, and a bundle slug appears the moment a user writes a YAML file
 * into `~/.hermes/profiles/<p>/skill-bundles`.
 *
 * This function is the **only** producer of those two sets, and the catalog is
 * its only input. That is the trust boundary: dispatch eligibility is decided
 * by what the agent said about itself, never by anything a client sent.
 */
export function catalogPolicyInputs(catalog: HermesCommandCatalog): {
  aliases: Record<string, string>
  skillCommands: Set<string>
  bundleCommands: Set<string>
} {
  const aliases: Record<string, string> = {}
  for (const [alias, canonical] of Object.entries(catalog.aliases)) {
    aliases[alias.trim().toLowerCase()] = canonical.trim().toLowerCase()
  }
  const skillCommands = new Set<string>()
  const bundleCommands = new Set<string>()
  for (const entry of catalog.commands) {
    const key = entry.command.trim().toLowerCase()
    // Mutually exclusive by construction in `normalizeCommandCatalog`, so the
    // two sets never overlap and the order of these branches cannot matter.
    if (entry.bundle) bundleCommands.add(key)
    else if (entry.skill) skillCommands.add(key)
  }
  return { aliases, skillCommands, bundleCommands }
}
