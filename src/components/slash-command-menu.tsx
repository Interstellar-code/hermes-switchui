'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import type { Ref } from 'react'

import type {
  HermesCommandCatalog,
  HermesCommandTier,
} from '@/lib/hermes-commands-api'
import type { SkillMetadataIndex, SkillProvenance } from '@/lib/skill-metadata'
import { useHermesCommandCatalog } from '@/lib/hermes-commands-api'
import { LOCAL_COMMAND_HANDLERS } from '@/screens/chat/hooks/use-slash-commands'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import { Button } from '@/components/shadcn/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useEnabledUserCommands } from '@/lib/commands-api'
import { skillSlug, useSkillMetadataIndex } from '@/lib/skill-metadata'
import { cn } from '@/lib/utils'

/**
 * The slash-command picker.
 *
 * ── What it offers, and why ───────────────────────────────────────────────
 * Two sources, merged and deduped by canonical name with **local winning**
 * (`docs/plans/hermes-slash-commands-in-switchui.md` §5 step 8):
 *
 *   1. `agent` — the live Hermes catalog, filtered to commands that **can
 *                actually run**: `runnable` is computed server-side from the
 *                exec allowlist (`server/hermes-slash-policy.ts`), and entries
 *                a SwitchUI handler shadows are dropped on top of that.
 *   2. `user`  — the workspace's own user-defined commands.
 *
 * The `local` source is now **empty**. Every one of the ten conversation
 * commands it used to advertise (`/new /clear /model /title /reasoning
 * /interrupt /branch /usage /save /copy`) still has a live handler in
 * `use-slash-commands.ts` and still routes when typed — that is what keeps it
 * from reaching the model as prose — it is simply no longer *advertised*, now
 * that agent commands execute for real and the picker's job is to surface
 * them. See §8a: the picker exists to show what the agent can do, not to
 * duplicate buttons that are already on screen.
 *
 * ── The filter is doubled on purpose ──────────────────────────────────────
 * `tier: 'excluded'` and `runnable: false` are both dropped here **and**
 * refused by `POST /api/hermes-commands/exec`. Hiding a command is not a
 * control; the allowlist on the server is. This filter only exists so the menu
 * does not advertise something the server would turn down.
 *
 * ── Facets, not sources ───────────────────────────────────────────────────
 * What the list is filtered *by* is a facet (`slashCommandFacet`), which is not
 * the same axis as `source`: the ~79-entry skill tail is agent-sourced, so it
 * cannot be separated from `/history` and `/tools` by source alone. See
 * `CommandFacetTabs` for why the bar exists at all.
 *
 * ── Inside the Skills facet ───────────────────────────────────────────────
 * A tab holding one flat alphabetical list of seventy-nine entries is a tab you
 * scroll, not one you use. The catalog gives skills no category to group by, so
 * the categories are joined in from `/api/skills` by slug
 * (`lib/skill-metadata.ts`) and the sections are ordered largest-first, with
 * whatever the join could not resolve left in the flat `Skills` bucket at the
 * bottom. The join is advisory throughout: it can only ever *add* a heading, and
 * a command it misses is still listed and still runs.
 */

export type SlashCommandSource = 'local' | 'agent' | 'user'

export type SlashCommandDefinition = {
  /** Canonical command including the leading slash. */
  command: string
  description: string
  /** User-defined commands only: the prompt body to expand. */
  prompt?: string
  source?: SlashCommandSource
  /** Section header this entry sorts under. */
  category?: string
  /**
   * `args_hint`-style usage, e.g. `[name]`. Rendered after the command token.
   * For agent entries it is computed server-side from the exec allowlist
   * (`HermesAgentCommand.usage`) and carried through verbatim — this component
   * must not derive one, or the picker starts advertising forms the server
   * refuses again.
   */
  usage?: string
  subcommands?: Array<string>
  tier?: HermesCommandTier
  /**
   * Agent entries only: this came from the uncategorized skill tail
   * (`HermesAgentCommand.skill`). Propagated because it is the only honest
   * signal for the Skills facet — skills are agent-sourced, so `source` cannot
   * tell them apart. Absent ⇒ not a skill.
   */
  skill?: boolean
  /**
   * Agent entries only: a skill-*bundle* slug — one command that loads several
   * skills at once (`HermesAgentCommand.bundle`). Mutually exclusive with
   * `skill`, and the axis the Bundles facet filters on. Absent ⇒ not a bundle.
   */
  bundle?: boolean
  /**
   * Skill entries only, joined from `/api/skills` by slug. `agent` means this
   * install produced the skill (`/learn`, the curator) — see the "Yours" badge.
   * Absent when the join found no row.
   */
  provenance?: SkillProvenance
  /**
   * Skill entries only: Hermes' invocation counter. A *tie-breaker*, never the
   * primary sort — the backend counters are near-zero on a fresh install, so
   * local recents are the real frequency signal.
   */
  invocations?: number
  /** Listed in the resting (no-query) view. Every picker entry is, since §8a. */
  featured?: boolean
  /** Transitional / secondary spellings that must resolve to this entry. */
  aliases?: Array<string>
}

/**
 * The axis the tab bar filters on.
 *
 * Deliberately *not* `SlashCommandSource`. The 79 skill commands, the bundle
 * slugs and the dozen ordinary agent commands all share one source (`agent`)
 * and are told apart by `SlashCommandDefinition.skill` / `.bundle`, so a
 * source-keyed filter cannot express the split the user actually needs.
 */
export type SlashCommandFacet = 'agent' | 'skill' | 'bundle' | 'user'

export type SlashCommandTab = 'all' | SlashCommandFacet

/**
 * Which facet an entry belongs to.
 *
 * The fallback is `agent` rather than a catch-all facet on purpose: every entry
 * must be reachable from some tab, and an entry that only ever appeared under
 * `All` would be invisible the moment a tab is selected. `source: 'local'`
 * lands here, which is sound while `LOCAL_SLASH_COMMANDS` is empty (§8b) and is
 * the thing to revisit first if it is ever refilled.
 *
 * ── Why bundles are their own facet rather than folded into Skills ────────
 * A bundle looks like a skill — same route, same argument shape, same "the
 * message goes down the send path" behaviour — and folding it in was the
 * tempting answer. Three things say no:
 *
 *   1. **The Skills tab is built on a join a bundle cannot satisfy.**
 *      `applySkillMetadata` looks each skill up in `/api/skills` by slug to
 *      give it a category heading; a bundle has no row there, so every bundle
 *      would land in the fail-soft `Skills` bucket that
 *      `orderSlashCommandSections` deliberately pins *last*. Worse, that bucket
 *      would then hold a mix of skills and non-skills, so `isSkillSection`
 *      would go false for it and the size-ordering band would misfile it.
 *   2. **The counts would stop being honest.** The bar's whole job is to say
 *      where things are; "Skills 81" over a list containing three things that
 *      are not skills is the small lie this file keeps being rewritten to
 *      avoid.
 *   3. **It costs nothing when empty.** `visibleSlashCommandTabs` drops a facet
 *      with no entries, so on an install with no bundles — which is every
 *      install until someone writes a bundle YAML — the bar is byte-identical
 *      to before. The tab appears exactly when there is something in it.
 */
export function slashCommandFacet(
  item: SlashCommandDefinition,
): SlashCommandFacet {
  if (item.source === 'user') return 'user'
  // Checked before `skill`: the two are mutually exclusive in the catalog, and
  // ordering the test makes that explicit rather than incidental.
  if (item.bundle) return 'bundle'
  if (item.skill) return 'skill'
  return 'agent'
}

export const FACET_ORDER: ReadonlyArray<SlashCommandFacet> = [
  'agent',
  'skill',
  'bundle',
  'user',
]

export const TAB_LABEL: Record<SlashCommandTab, string> = {
  all: 'All',
  agent: 'Agent',
  skill: 'Skills',
  bundle: 'Bundles',
  user: 'Custom',
}

export type SlashCommandTabCounts = Record<SlashCommandTab, number>

export function countSlashCommandTabs(
  items: Array<SlashCommandDefinition>,
): SlashCommandTabCounts {
  const counts: SlashCommandTabCounts = {
    all: items.length,
    agent: 0,
    skill: 0,
    bundle: 0,
    user: 0,
  }
  for (const item of items) counts[slashCommandFacet(item)] += 1
  return counts
}

/**
 * Which tabs to render, given the counts over the **unfiltered** command set.
 *
 * Two rules, and they answer different questions:
 *
 *   - A facet with no commands at all is *omitted*. `Custom` is empty for a
 *     user who has defined no commands, `Bundles` is empty until someone
 *     creates one, and a tab that can only ever show nothing is noise.
 *   - Fewer than two non-empty facets means the bar has nothing to switch
 *     between, so there is no bar. This is the same judgement that removed the
 *     old source tabs — it just no longer holds, because the catalog came back.
 *
 * A facet that merely has no *matches for the current query* keeps its tab (see
 * `CommandFacetTabs`), so the bar does not reflow while the user types.
 */
export function visibleSlashCommandTabs(
  totals: SlashCommandTabCounts,
): Array<SlashCommandTab> {
  const present = FACET_ORDER.filter((facet) => totals[facet] > 0)
  if (present.length < 2) return []
  return ['all', ...present]
}

export type SlashCommandMenuProps = {
  open: boolean
  query: string
  onSelect: (command: SlashCommandDefinition) => void
}

export type SlashCommandMenuHandle = {
  moveSelection: (step: number) => void
  selectActive: () => boolean
  /**
   * Whether the menu is actually showing anything. The composer keeps the menu
   * "open" for `/<token> <partial>` so subcommands can be completed, but that
   * same state is reached by typing prose after a slash token — and while it is
   * open the composer routes arrows and Enter into the menu. Without this the
   * arrow keys would be swallowed with nothing on screen to move through.
   */
  hasItems: () => boolean
}

export type SlashCommandPickerProps = {
  disabled?: boolean
  onSelect: (command: SlashCommandDefinition) => void
}

/** Fired by `/help`; opens the picker, which now lists everything it knows. */
export const OPEN_SLASH_COMMAND_MENU_EVENT = 'claude:open-slash-command-menu'

export const LOCAL_CATEGORY = 'SwitchUI'
export const USER_CATEGORY = 'Your commands'
const RECENT_CATEGORY = 'Recent'

/**
 * The category the catalog gives **every** skill command, because the agent
 * gives them none and the normalizer has to put them somewhere.
 *
 * After `applySkillMetadata` this is the *fail-soft bucket*: a skill whose
 * `/api/skills` row could not be found keeps it, and `orderSlashCommandSections`
 * pins it last. It is not an error state — it is the honest answer for a command
 * whose metadata we do not have, and it is why the join can never drop a row.
 */
export const SKILLS_FALLBACK_CATEGORY = 'Skills'

/**
 * The argument shape a skill accepts, standing in for the `args_hint` the agent
 * does not send for skills.
 *
 * Not decorative: whatever follows the skill name is appended verbatim to the
 * skill prompt as *"The user has provided the following instruction alongside
 * the skill invocation: …"*, so it is the difference between running a skill and
 * aiming it.
 *
 * A bundle slug takes the same hint, and for the same reason:
 * `build_bundle_invocation_message` interpolates its argument into the bundle
 * header as a *"User instruction: …"* line (installed
 * `agent/skill_bundles.py`). Applied in `CommandRow`.
 */
export const SKILL_ARGUMENT_HINT = '[instructions]'

/**
 * The one-line explanation the composer keeps on screen for a skill invocation.
 *
 * The picker inserts `"/skill "` and dismisses (skills have no `subcommands` to
 * complete), and the menu closes for good at the second space — so every hint it
 * showed disappears exactly when the user starts typing the argument. This is
 * what replaces it, anchored to the composer instead of the popover.
 */
export function skillArgumentNotice(command: string): string {
  return `Anything after ${command} is passed to the skill as an instruction — say what you want it to do, or send it bare.`
}

/**
 * The skill entry the composer's current text invokes, if any.
 *
 * Matches on the first token alone (`/arxiv`, `/arxiv `, `/arxiv quantum error
 * correction`), so the answer survives the whole argument being typed. Returns
 * `null` for anything that is not a known skill command — including a bare `/`,
 * a non-skill command, and ordinary prose.
 */
export function findSkillInvocation(
  value: string,
  commands: Array<SlashCommandDefinition>,
): SlashCommandDefinition | null {
  const match = /^\/(\S+)(?:\s|$)/.exec(value)
  if (!match) return null
  const token = `/${match[1]}`.toLowerCase()
  return (
    commands.find(
      (item) =>
        item.skill === true &&
        (item.command.toLowerCase() === token ||
          (item.aliases ?? []).some((alias) => alias.toLowerCase() === token)),
    ) ?? null
  )
}

/**
 * Commands SwitchUI advertises on its own behalf: **none**.
 *
 * This used to hold ten conversation commands (`/new /clear /model /title
 * /reasoning /interrupt /branch /usage /save /copy`). Every one of them still
 * works when typed — the handlers in `LOCAL_COMMAND_HANDLERS` are untouched and
 * the routing layer still refuses to let any of them reach the model as prose.
 * They are only unadvertised, because each one duplicates a control that is
 * already on screen (the New-chat button, the model picker, the Stop button,
 * the header's usage meter, the message action bar's copy) and the picker's job
 * from Phase 3 onward is to surface what the *agent* can do.
 *
 * Do not repopulate this list to "fix" a missing entry — check that the handler
 * still exists in `use-slash-commands.ts` instead. The asserted invariant is
 * one-directional and still holds vacuously: advertised ⊆ handled.
 */
export const LOCAL_SLASH_COMMANDS: Array<SlashCommandDefinition> = []

const RECENTS_KEY = 'hermes-recent-slash-commands-v1'
const RECENTS_LIMIT = 5

export function readRecentSlashCommands(): Array<string> {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .slice(0, RECENTS_LIMIT)
  } catch {
    return []
  }
}

export function recordRecentSlashCommand(command: string): Array<string> {
  const trimmed = command.trim()
  if (!trimmed.startsWith('/')) return readRecentSlashCommands()
  const next = [
    trimmed,
    ...readRecentSlashCommands().filter(
      (entry) => entry.toLowerCase() !== trimmed.toLowerCase(),
    ),
  ].slice(0, RECENTS_LIMIT)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
    } catch {
      // localStorage unavailable; recents are best-effort.
    }
  }
  return next
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase()
}

export function slashCommandMatches(
  item: SlashCommandDefinition,
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return true

  return normalizeSearchValue(
    [
      item.command,
      ...(item.aliases ?? []),
      item.description,
      item.category ?? '',
      item.source ?? '',
    ].join(' '),
  ).includes(normalizedQuery)
}

/**
 * Merge the three sources, deduping by canonical name with local winning, then
 * user, then agent. Aliases claimed by a higher-precedence source also suppress
 * the lower one — that is what keeps the agent's `/stop` (a background-process
 * killer) from shadowing SwitchUI's `/interrupt`.
 *
 * `local` is empty today, so in practice this is user-then-agent precedence: a
 * user command named `/status` wins over the agent's.
 */
export function mergeSlashCommands(sources: {
  local: Array<SlashCommandDefinition>
  user: Array<SlashCommandDefinition>
  agent: Array<SlashCommandDefinition>
}): Array<SlashCommandDefinition> {
  const merged: Array<SlashCommandDefinition> = []
  const claimed = new Set<string>()

  const claim = (item: SlashCommandDefinition) => {
    const key = item.command.toLowerCase()
    if (claimed.has(key)) return
    claimed.add(key)
    for (const alias of item.aliases ?? []) claimed.add(alias.toLowerCase())
    merged.push(item)
  }

  for (const item of sources.local) claim(item)
  for (const item of sources.user) claim(item)
  for (const item of sources.agent) {
    // `excluded` never reaches the menu and never reaches dispatch (§4.4).
    if (item.tier === 'excluded') continue
    claim(item)
  }

  return merged
}

/**
 * Turn the live catalog into picker entries.
 *
 * Two filters, in this order:
 *
 *   1. `runnable` — computed server-side from the exec allowlist. This is what
 *      stops the picker becoming the 129-entry list of which 117 could only
 *      answer "not wired up yet" that §8a was written about.
 *   2. **not shadowed by a SwitchUI handler** — `/help` is on the exec
 *      allowlist *and* has a local handler that intercepts it first (it opens
 *      this picker, which is the better help surface: the agent's own `/help`
 *      prints ~18KB of ASCII listing CLI commands that mostly do not work
 *      here). An entry badged "Agent" that a local handler quietly answers
 *      instead is a lie in the other direction, so it is dropped.
 *
 * ── Filter 2 is a loaded gun, and this is its safety catch ────────────────
 * Dropping a shadowed entry is right for `/help` and wrong for everything
 * else so far: a command that is allowlisted *and* shadowed is neither
 * advertised nor executed, so the allowlist entry — and every measurement in
 * its `why` — is dead. `/status` hit exactly that (deep-linked to `/dashboard`,
 * which shows gateway health rather than the session facts it reports), was
 * fixed, and the fix was then un-generalised: the 3 → 12 allowlist pass
 * re-created the bug four times over with `/insights`, `/profile`, `/reasoning`
 * and `/version`, all four buried under screens that lack the very thing each
 * was allowlisted to report.
 *
 * So the permitted overlap is now a named table —
 * `INTENTIONALLY_SHADOWED_COMMANDS` in `server/hermes-slash-policy.ts`,
 * currently `/help` alone — and `slash-command-menu.test.tsx` fails if the real
 * intersection differs from it in either direction. Do not add a shadow to
 * "clean up" the picker; the bar is that SwitchUI's answer is *better*, not
 * that a screen exists.
 */
export function agentCatalogEntries(
  catalog: HermesCommandCatalog,
  shadowed: ReadonlySet<string>,
): Array<SlashCommandDefinition> {
  const entries: Array<SlashCommandDefinition> = []
  for (const item of catalog.commands) {
    if (!item.runnable) continue
    if (item.tier === 'excluded') continue
    if (shadowed.has(item.command.toLowerCase())) continue
    entries.push({
      command: item.command,
      description: item.description,
      // Rendered, not decided: `usage` arrives already reconciled with the exec
      // allowlist (`server/hermes-slash-policy.ts`'s `slashUsageHint`). The
      // picker used to split it out of the description itself, which made it
      // the one advertised field no policy had ever seen — so it offered
      // `/reasoning [level|show|hide|full|clamp] [--global]` for a command that
      // runs bare or not at all, and kept offering `/goal show` for months
      // after `phantomArgs` was written to refuse exactly that.
      ...(item.usage ? { usage: item.usage } : {}),
      source: 'agent',
      category: item.category,
      ...(item.subcommands?.length ? { subcommands: item.subcommands } : {}),
      tier: item.tier,
      // Carried through so the Skills and Bundles facets can be derived per
      // entry rather than guessed from the category string the agent happened
      // to send — which for bundles would be indistinguishable from a registry
      // category, since the agent files them in a real "Bundles" bucket.
      ...(item.skill ? { skill: true } : {}),
      ...(item.bundle ? { bundle: true } : {}),
      featured: true,
    })
  }
  return entries
}

/**
 * Fold `/api/skills` metadata onto the skill entries, joined by slug.
 *
 * This is what turns the Skills facet from one 79-row alphabetical list into
 * ~12 sections of 1–20. Three rules, and the third is the important one:
 *
 *   1. Only entries flagged `skill` are touched. `/history` keeps its `Session`
 *      category no matter what a same-named skill row says.
 *   2. A match replaces the flat `Skills` category with the skill's own, and
 *      carries `provenance` (for the "Yours" badge) and the invocation counter
 *      (a ranking tie-breaker) alongside it.
 *   3. **A miss changes nothing.** The entry keeps `Skills` and stays in the
 *      list. Dropping a command because a client-side join missed would hide
 *      working functionality — always worse than an ungrouped row. An empty
 *      index (capability off, request failed, still loading) therefore
 *      reproduces exactly today's behaviour.
 */
export function applySkillMetadata(
  items: Array<SlashCommandDefinition>,
  index: SkillMetadataIndex,
): Array<SlashCommandDefinition> {
  if (index.size === 0) return items
  return items.map((item) => {
    if (!item.skill) return item
    const meta = index.get(skillSlug(item.command))
    if (!meta) return item
    return {
      ...item,
      category: meta.category,
      provenance: meta.provenance,
      invocations: meta.invocations,
    }
  })
}

/**
 * Commands a SwitchUI handler answers before the agent ever sees them.
 *
 * Derived from `LOCAL_COMMAND_HANDLERS` rather than hand-listed, so adding a
 * handler cannot silently leave a misleading "Agent" badge behind in the
 * picker.
 *
 * Built lazily on first use, not at module scope: `use-slash-commands.ts`
 * imports `OPEN_SLASH_COMMAND_MENU_EVENT` from this file, so the two modules
 * form an import cycle and reading the other side's binding during module
 * initialization would depend on which one the bundler happened to evaluate
 * first.
 */
let shadowedCache: ReadonlySet<string> | null = null

function shadowedByLocalHandler(): ReadonlySet<string> {
  shadowedCache ??= new Set(
    LOCAL_COMMAND_HANDLERS.map((command) => command.toLowerCase()),
  )
  return shadowedCache
}

/**
 * The picker's command set: the runnable slice of the agent catalog, plus the
 * user's own commands.
 *
 * Degrades to just the user's commands when the `agentCommands` capability is
 * off — `useHermesCommandCatalog` answers an empty catalog rather than
 * throwing, so there is no extra branch here.
 */
export function useSlashCommandDefinitions(): Array<SlashCommandDefinition> {
  const userCommandsQuery = useEnabledUserCommands()
  const userCommands = userCommandsQuery.data
  const catalog = useHermesCommandCatalog().data
  // No skill tail ⇒ nothing to group, so the metadata request is not spent.
  const skillMetadata = useSkillMetadataIndex({
    enabled: catalog.commands.some((entry) => entry.skill),
  })

  return useMemo<Array<SlashCommandDefinition>>(() => {
    const local = LOCAL_SLASH_COMMANDS.map((item) => ({
      ...item,
      source: 'local' as const,
      category: LOCAL_CATEGORY,
      tier: 'local' as const,
    }))

    const user = userCommands.map((command) => ({
      command: command.slash,
      description: command.description || command.name,
      prompt: command.prompt,
      source: 'user' as const,
      category: USER_CATEGORY,
      featured: true,
    }))

    const agent = applySkillMetadata(
      agentCatalogEntries(catalog, shadowedByLocalHandler()),
      skillMetadata,
    )

    return mergeSlashCommands({ local, user, agent })
  }, [catalog, skillMetadata, userCommands])
}

// ── Subcommand completion ────────────────────────────────────────────────
// The composer keeps the menu open for `/<token> <partial>` (one argument, no
// further whitespace). In that state the menu stops listing commands and lists
// the token's subcommands instead.

export function splitSubcommandQuery(
  query: string,
): { token: string; partial: string } | null {
  const match = /^(\S+)\s+(\S*)$/.exec(query)
  if (!match) return null
  return { token: `/${match[1]}`, partial: match[2] }
}

function subcommandEntries(
  commands: Array<SlashCommandDefinition>,
  query: string,
): Array<SlashCommandDefinition> | null {
  const split = splitSubcommandQuery(query)
  if (!split) return null

  const token = split.token.toLowerCase()
  const parent = commands.find(
    (item) =>
      item.command.toLowerCase() === token ||
      (item.aliases ?? []).some((alias) => alias.toLowerCase() === token),
  )
  if (!parent?.subcommands?.length) return []

  const partial = normalizeSearchValue(split.partial)
  return parent.subcommands
    .filter((sub) => !partial || normalizeSearchValue(sub).startsWith(partial))
    .map((sub) => ({
      command: `${parent.command} ${sub}`,
      description: `${parent.command} ${sub}`,
      source: parent.source,
      category: `${parent.command} options`,
      tier: parent.tier,
      ...(parent.skill ? { skill: true } : {}),
      ...(parent.bundle ? { bundle: true } : {}),
    }))
}

const SOURCE_LABEL: Record<SlashCommandSource, string> = {
  local: 'SwitchUI',
  agent: 'Agent',
  user: 'Custom',
}

/**
 * The resting view: recents first, then the featured set in its own categories.
 *
 * Since §8a everything the picker knows about is featured, so this no longer
 * hides anything — it only lifts recents to the top. The entries keep their own
 * category, which is what puts "SwitchUI" and "Your commands" headers on screen
 * instead of one flat "Suggested" block.
 */
export function curatedSlashCommands(
  commands: Array<SlashCommandDefinition>,
  recents: Array<string>,
): Array<SlashCommandDefinition> {
  const recent = recents
    .map((name) => {
      const key = name.toLowerCase()
      return commands.find(
        (item) =>
          item.command.toLowerCase() === key ||
          (item.aliases ?? []).some((alias) => alias.toLowerCase() === key),
      )
    })
    .filter((item): item is SlashCommandDefinition => Boolean(item))
    // Two spellings of one command (`/stop` and `/interrupt`) resolve to the
    // same entry — list it once, or the rows collide on their React key.
    .filter(
      (item, index, all) =>
        all.findIndex((other) => other.command === item.command) === index,
    )
    .map((item) => ({ ...item, category: RECENT_CATEGORY }))

  // A recent entry is *moved* to the top, not copied: everything is featured
  // now, so dropping the recent instead (the old rule) would have left the
  // Recent section permanently empty.
  const recentKeys = new Set(recent.map((item) => item.command.toLowerCase()))
  const featured = commands.filter(
    (item) => item.featured && !recentKeys.has(item.command.toLowerCase()),
  )

  return [...recent, ...featured]
}

/**
 * Narrow a list to one facet. `all` is the identity.
 *
 * Exported so the pipeline the menu runs — filter, then curate, then group —
 * can be asserted end to end without standing up the popover.
 */
export function filterSlashCommandsByTab(
  items: Array<SlashCommandDefinition>,
  tab: SlashCommandTab,
): Array<SlashCommandDefinition> {
  if (tab === 'all') return items
  return items.filter((item) => slashCommandFacet(item) === tab)
}

export type SlashCommandSection = {
  title: string
  items: Array<SlashCommandDefinition>
}

/** Group into ordered sections, preserving first-seen category order. */
export function groupByCategory(
  items: Array<SlashCommandDefinition>,
): Array<SlashCommandSection> {
  const sections: Array<SlashCommandSection> = []
  const byTitle = new Map<string, SlashCommandSection>()
  for (const item of items) {
    const title = item.category ?? 'Other'
    let section = byTitle.get(title)
    if (!section) {
      section = { title, items: [] }
      byTitle.set(title, section)
      sections.push(section)
    }
    section.items.push(item)
  }
  return sections
}

/** A section built entirely of skills — the ones the size ordering applies to. */
function isSkillSection(section: SlashCommandSection): boolean {
  return (
    section.title !== RECENT_CATEGORY &&
    section.items.length > 0 &&
    section.items.every((item) => item.skill === true)
  )
}

/**
 * Order the sections.
 *
 * Four bands, in this order:
 *
 *   0. `Recent` — pinned first wherever it appears. It can mix skills with
 *      anything else, so it is matched by title, not by content.
 *   1. everything that is not a skill section, in **first-seen order**. This is
 *      what keeps `/history` and the user's own commands above the skill tail on
 *      the All tab; sorting them by size would sink two-entry sections below a
 *      twenty-entry one.
 *   2. skill categories, **largest first**, ties broken alphabetically so the
 *      list does not reshuffle between renders.
 *   3. the fail-soft `Skills` bucket, last. Whatever the join could not resolve
 *      sits at the bottom rather than pretending to be a category.
 */
export function orderSlashCommandSections(
  sections: Array<SlashCommandSection>,
): Array<SlashCommandSection> {
  const band = (section: SlashCommandSection): number => {
    if (section.title === RECENT_CATEGORY) return 0
    if (!isSkillSection(section)) return 1
    return section.title === SKILLS_FALLBACK_CATEGORY ? 3 : 2
  }

  return sections
    .map((section, index) => ({ section, index, band: band(section) }))
    .sort((left, right) => {
      if (left.band !== right.band) return left.band - right.band
      if (left.band === 2) {
        const bySize = right.section.items.length - left.section.items.length
        if (bySize !== 0) return bySize
        return left.section.title.localeCompare(right.section.title)
      }
      return left.index - right.index
    })
    .map((entry) => entry.section)
}

/**
 * Order the entries inside one skill section: recents first, then the agent's
 * invocation counter, then alphabetically.
 *
 * Recents lead deliberately. The counter is the *backend's* view of frequency
 * and reads 0 for most skills on a fresh install, so ranking on it alone would
 * be close to alphabetical with a few arbitrary winners; the local recents list
 * is the signal that actually reflects this user. Alphabetical is the final tie-
 * break, which is what makes the whole order stable.
 */
export function rankSkillSectionItems(
  items: Array<SlashCommandDefinition>,
  recents: Array<string>,
): Array<SlashCommandDefinition> {
  const recentRank = new Map<string, number>()
  recents.forEach((command, position) => {
    const key = command.trim().toLowerCase()
    if (key && !recentRank.has(key)) recentRank.set(key, position)
  })

  const rankOf = (item: SlashCommandDefinition): number =>
    recentRank.get(item.command.toLowerCase()) ?? Number.MAX_SAFE_INTEGER

  return [...items].sort((left, right) => {
    const byRecency = rankOf(left) - rankOf(right)
    if (byRecency !== 0) return byRecency
    const byUse = (right.invocations ?? 0) - (left.invocations ?? 0)
    if (byUse !== 0) return byUse
    return left.command.localeCompare(right.command)
  })
}

/**
 * Group, rank within skill sections, and order the sections.
 *
 * Exported as one function because the three steps are not independent: the
 * menu's keyboard navigation indexes into the *flattened* result, so whatever
 * produces the render order has to produce the arrow-key order too.
 */
export function buildSlashCommandSections(
  items: Array<SlashCommandDefinition>,
  recents: Array<string>,
): Array<SlashCommandSection> {
  const sections = groupByCategory(items).map((section) =>
    isSkillSection(section)
      ? { ...section, items: rankSkillSectionItems(section.items, recents) }
      : section,
  )
  return orderSlashCommandSections(sections)
}

function useMenuState(query: string) {
  const commands = useSlashCommandDefinitions()
  const [recents, setRecents] = useState<Array<string>>([])
  const [tab, setTab] = useState<SlashCommandTab>('all')

  // localStorage is read on mount only — reading it during render would drive
  // the server and client trees apart under SSR.
  useEffect(() => {
    setRecents(readRecentSlashCommands())
  }, [])

  const subcommands = useMemo(
    () => subcommandEntries(commands, query),
    [commands, query],
  )

  /**
   * The query filter, applied **before** the facet filter.
   *
   * Search is scoped to the active tab — the list you are looking at is the
   * list you are searching — but the counts on the bar are computed from this
   * unscoped set, so a query that matches nothing here still shows you where
   * its matches went ("Agent 1" while you sit on an empty Skills tab).
   */
  const matching = useMemo(() => {
    if (!query.trim()) return commands
    return commands.filter((item) => slashCommandMatches(item, query))
  }, [commands, query])

  const totals = useMemo(() => countSlashCommandTabs(commands), [commands])
  const counts = useMemo(() => countSlashCommandTabs(matching), [matching])
  const tabs = useMemo(() => visibleSlashCommandTabs(totals), [totals])

  // The catalog arrives after first paint, and can shrink on a refetch. A tab
  // that stops existing must not leave the list filtered by something the user
  // can no longer see or undo.
  useEffect(() => {
    if (tab !== 'all' && !tabs.includes(tab)) setTab('all')
  }, [tab, tabs])

  const listed = useMemo(() => {
    if (subcommands) return subcommands
    const scoped = filterSlashCommandsByTab(matching, tab)
    // No query: recents on top, then everything. There is no "show all" any
    // more because nothing is held back (§8a). Recents are curated *after* the
    // facet filter, so the Skills tab pins recently-used skills and nothing
    // else — a recent `/history` never leaks into it.
    if (!query.trim()) return curatedSlashCommands(scoped, recents)
    return scoped
  }, [matching, query, recents, subcommands, tab])

  const sections = useMemo(
    () => buildSlashCommandSections(listed, recents),
    [listed, recents],
  )

  // Flattened *from the sections*, not from `listed`. The menu renders section
  // by section but navigates by a flat index, so the two must be one order —
  // otherwise the arrow keys walk a different list than the eye does.
  const visible = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  )

  const recordSelection = useCallback((command: string) => {
    setRecents(recordRecentSlashCommand(command))
  }, [])

  return {
    counts,
    isSubcommandMode: subcommands !== null,
    recordSelection,
    sections,
    setTab,
    tab,
    tabs,
    visible,
  }
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wider select-none"
      style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
    >
      {title}
    </div>
  )
}

function SourceBadge({ source }: { source?: SlashCommandSource }) {
  const resolved = source ?? 'local'
  const accent = resolved === 'user' || resolved === 'local'
  return (
    <span
      className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
      style={{
        borderColor: accent
          ? 'var(--m-green-30, rgba(74,222,128,0.30))'
          : 'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
        color: accent
          ? 'var(--m-green,#4ade80)'
          : 'var(--m-muted,var(--theme-muted,#6b7280))',
      }}
    >
      {SOURCE_LABEL[resolved]}
    </span>
  )
}

/**
 * Marks a skill this install produced — `/learn` and the curator wrote these.
 * Ten of the seventy-nine here, and the only ones with a personal story, which
 * is why they are worth a word of chrome in a list this long.
 */
function ProvenanceBadge() {
  return (
    <span
      className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
      style={{
        borderColor: 'var(--m-green-30, rgba(74,222,128,0.30))',
        color: 'var(--m-green,#4ade80)',
      }}
      title="Created on this machine — by /learn or the skill curator"
    >
      Yours
    </span>
  )
}

function CommandRow({
  item,
  showSource = true,
}: {
  item: SlashCommandDefinition
  /**
   * Suppressed inside a facet tab. The badge answers "where did this come
   * from?", which is worth a column in `All` where three answers are
   * interleaved; in a filtered tab every row would carry the same word — and on
   * the Skills tab that word is "Agent", which reads as a contradiction of the
   * tab the user just clicked.
   */
  showSource?: boolean
}) {
  // Skills and bundles carry no `args_hint`, so the picker had nothing to
  // render where every other command shows its argument shape — yet their
  // argument is real and meaningful (it is appended to the prompt as an
  // explicit instruction). Stand in for the missing hint so the affordance is
  // visible at the point of choice. Note the composer's follow-on notice
  // (`skillArgumentNotice`, driven by `findSkillInvocation`) is skills-only —
  // its copy names the skill — so for a bundle this row is the whole
  // affordance.
  const argumentHint =
    item.usage ?? (item.skill || item.bundle ? SKILL_ARGUMENT_HINT : undefined)
  return (
    <>
      <span className="flex w-full items-center gap-2">
        <span className="text-sm font-semibold font-mono">{item.command}</span>
        {argumentHint ? (
          <span
            className="text-[11px] font-mono truncate"
            style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
          >
            {argumentHint}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {item.provenance === 'agent' ? <ProvenanceBadge /> : null}
          {showSource ? <SourceBadge source={item.source} /> : null}
        </span>
      </span>
      <span className="text-xs text-primary-600">{item.description}</span>
    </>
  )
}

/**
 * The facet tab bar.
 *
 * ── Why this exists, and why removing it was right once and is wrong now ──
 * This bar was deleted on purpose, and the reasoning was sound *for that
 * moment*: the picker then held ten SwitchUI commands plus the user's own, so
 * tabs bought nothing. The very next change inverted the premise — it emptied
 * `LOCAL_SLASH_COMMANDS` and restored the agent catalog (§8b), and the resting
 * list is now ~81 entries **of which 79 are skills**. Without this bar,
 * `/history` and `/tools` sit below seventy-nine skill rows in a 15rem
 * scroller.
 *
 * So: the bar is load-bearing because of *skill volume*, not because there are
 * several sources. Before deleting it again, check `catalog.skillCount` — if
 * the skill tail is gone, `visibleSlashCommandTabs` already hides the bar on
 * its own and there is nothing to delete.
 *
 * Counts are query-scoped; membership is not. A tab is dropped entirely when
 * its facet is empty in the whole catalog (`Custom`, for a user with no custom
 * commands), and merely disabled when the current query leaves it with nothing
 * — otherwise the bar would reflow under the cursor on every keystroke.
 */
function CommandFacetTabs({
  active,
  counts,
  onSelect,
  tabs,
}: {
  active: SlashCommandTab
  counts: SlashCommandTabCounts
  onSelect: (tab: SlashCommandTab) => void
  tabs: Array<SlashCommandTab>
}) {
  if (tabs.length === 0) return null

  return (
    <div
      aria-label="Filter slash commands"
      className="flex items-center gap-1 border-b px-2 py-1.5"
      role="tablist"
      style={{
        borderColor:
          'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
      }}
    >
      {tabs.map((tab) => {
        const count = counts[tab]
        const isActive = tab === active
        // The active tab stays clickable even at zero so it never looks broken
        // under the cursor that selected it.
        const isEmpty = count === 0 && !isActive
        return (
          // No `aria-controls`: cmdk assigns the listbox its own generated id
          // and drops ours, so any static reference here would dangle.
          <button
            key={tab}
            aria-selected={isActive}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
              isEmpty && 'cursor-default opacity-40',
            )}
            disabled={isEmpty}
            // Keeps focus in the composer's textarea: this menu is anchored to
            // it, and a blur would tear the menu down mid-click.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(tab)}
            role="tab"
            style={{
              background: isActive
                ? 'var(--m-green-10, rgba(74,222,128,0.10))'
                : 'transparent',
              border: `1px solid ${
                isActive
                  ? 'var(--m-green-30, rgba(74,222,128,0.30))'
                  : 'transparent'
              }`,
              color: isActive
                ? 'var(--m-green,#4ade80)'
                : 'var(--m-muted,var(--theme-muted,#6b7280))',
            }}
            type="button"
          >
            <span>{TAB_LABEL[tab]}</span>
            <span className="tabular-nums opacity-70">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Shown when the query matches nothing *in the active tab* while the bar is up.
 * Names the tab, because that is the whole explanation: the matches exist, they
 * are one click away, and the counts on the bar say where.
 */
function ScopedEmptyState({ tab }: { tab: SlashCommandTab }) {
  return (
    <div
      className="px-3 py-6 text-center text-xs"
      style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
    >
      No {TAB_LABEL[tab]} commands match this search.
    </div>
  )
}

const SlashCommandMenu = forwardRef(function SlashCommandMenuInner(
  { open, query, onSelect }: SlashCommandMenuProps,
  ref: Ref<SlashCommandMenuHandle>,
) {
  const [activeIndex, setActiveIndex] = useState(0)
  const {
    counts,
    isSubcommandMode,
    recordSelection,
    sections,
    setTab,
    tab,
    tabs,
    visible,
  } = useMenuState(query)

  useEffect(() => {
    setActiveIndex(0)
  }, [open, query, tab])

  // A filter the user set for one `/`-token should not still be in force the
  // next time the menu comes up.
  useEffect(() => {
    if (!open) setTab('all')
  }, [open, setTab])

  useEffect(() => {
    if (visible.length === 0) {
      setActiveIndex(0)
      return
    }
    setActiveIndex((previous) =>
      Math.max(0, Math.min(previous, visible.length - 1)),
    )
  }, [visible.length])

  const handleSelect = useCallback(
    (item: SlashCommandDefinition) => {
      recordSelection(item.command)
      onSelect(item)
    },
    [onSelect, recordSelection],
  )

  useImperativeHandle(
    ref,
    () => ({
      moveSelection(step: number) {
        if (!open || visible.length === 0) return
        const direction = step >= 0 ? 1 : -1
        setActiveIndex((previous) => {
          const next = previous + direction
          if (next < 0) return visible.length - 1
          if (next >= visible.length) return 0
          return next
        })
      },
      selectActive() {
        if (!open || visible.length === 0) return false
        const selectedIndex = Math.max(
          0,
          Math.min(activeIndex, visible.length - 1),
        )
        handleSelect(visible[selectedIndex])
        return true
      },
      hasItems() {
        return open && visible.length > 0
      },
    }),
    [activeIndex, handleSelect, open, visible],
  )

  if (!open) return null
  // Subcommand mode with nothing to complete means the user is typing prose
  // after a slash token — get out of the way rather than showing "no results".
  if (isSubcommandMode && visible.length === 0) return null

  // Facets mean nothing while completing one command's subcommands.
  const facetTabs = isSubcommandMode ? [] : tabs
  const scopedEmpty = facetTabs.length > 0 && visible.length === 0

  let flatIndex = -1

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-[calc(100%+0.5rem)] z-[70]">
      <Popover modal={false} open={open}>
        <PopoverAnchor asChild>
          <span aria-hidden="true" className="block h-px w-full" />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="pointer-events-auto overflow-hidden rounded-xl border p-0 shadow-lg"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
          sideOffset={8}
          style={{
            background: 'var(--color-surface, var(--theme-card, #1a1f2e))',
            borderColor:
              'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
            maxWidth: 'calc(100vw - 1rem)',
            minWidth: '16rem',
            width:
              'var(--radix-popover-trigger-width, min(28rem, calc(100vw - 1rem)))',
          }}
        >
          <Command
            autoHighlight={false}
            keepHighlight={false}
            mode="none"
            shouldFilter={false}
            value={query}
            onValueChange={() => {}}
          >
            <CommandFacetTabs
              active={tab}
              counts={counts}
              onSelect={setTab}
              tabs={facetTabs}
            />
            <CommandList
              id="slash-command-list"
              className="max-h-60 min-h-0 px-1 pb-1"
            >
              {scopedEmpty ? (
                <ScopedEmptyState tab={tab} />
              ) : (
                <CommandEmpty>No commands found</CommandEmpty>
              )}
              {sections.map((section) => (
                <div key={section.title}>
                  <SectionHeader title={section.title} />
                  {section.items.map((item) => {
                    flatIndex += 1
                    const index = flatIndex
                    return (
                      <CommandItem
                        key={item.command}
                        value={item.command}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActiveIndex(index)}
                        onSelect={() => handleSelect(item)}
                        className={cn(
                          'flex flex-col items-start gap-0.5 rounded-md px-3 py-2 mx-1',
                          index === activeIndex &&
                            'bg-primary-100 text-primary-900',
                        )}
                      >
                        <CommandRow
                          item={item}
                          showSource={tab === 'all' || facetTabs.length === 0}
                        />
                      </CommandItem>
                    )
                  })}
                </div>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
})

function SlashCommandPicker({ disabled, onSelect }: SlashCommandPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const {
    counts,
    isSubcommandMode,
    recordSelection,
    sections,
    setTab,
    tab,
    tabs,
    visible,
  } = useMenuState(query)
  // Same rule as the composer-anchored menu: no facets while completing one
  // command's subcommands.
  const facetTabs = isSubcommandMode ? [] : tabs

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  // `/help` opens this picker. Since §8a the resting menu already lists every
  // command it knows about, so opening it *is* the help surface — there is
  // nothing left to expand.
  useEffect(() => {
    function handleOpen() {
      if (disabled) return
      setQuery('')
      setOpen(true)
    }
    window.addEventListener(OPEN_SLASH_COMMAND_MENU_EVENT, handleOpen)
    return () => {
      window.removeEventListener(OPEN_SLASH_COMMAND_MENU_EVENT, handleOpen)
    }
  }, [disabled])

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) {
      setOpen(false)
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
      setTab('all')
    }
  }

  const handleSelect = (command: SlashCommandDefinition) => {
    recordSelection(command.command)
    onSelect(command)
    setOpen(false)
    setQuery('')
    setTab('all')
  }

  return (
    <Popover modal={false} open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label="Browse slash commands"
          aria-expanded={open}
          title="Slash commands"
          className={cn(open && 'text-primary')}
        >
          <span className="text-base font-semibold leading-none">/</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw_-_1rem))] overflow-hidden rounded-xl border p-0 shadow-lg"
        onCloseAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={8}
        style={{
          background: 'var(--color-surface, var(--theme-card, #1a1f2e))',
          borderColor:
            'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
        }}
      >
        <Command
          mode="none"
          shouldFilter={false}
          value={query}
          onValueChange={setQuery}
        >
          <CommandInput placeholder="Search slash commands" />
          <CommandFacetTabs
            active={tab}
            counts={counts}
            onSelect={setTab}
            tabs={facetTabs}
          />
          <CommandList
            id="slash-command-list"
            className="max-h-72 min-h-0 px-1 pb-1"
          >
            {facetTabs.length > 0 && visible.length === 0 ? (
              <ScopedEmptyState tab={tab} />
            ) : (
              <CommandEmpty>No slash commands found</CommandEmpty>
            )}
            {sections.map((section) => (
              <div key={section.title}>
                <SectionHeader title={section.title} />
                {section.items.map((item) => (
                  <CommandItem
                    key={item.command}
                    value={`${item.command} ${item.description}`}
                    onSelect={() => handleSelect(item)}
                    className="flex flex-col items-start gap-1 rounded-md px-3 py-2 mx-1"
                  >
                    <CommandRow
                      item={item}
                      showSource={tab === 'all' || facetTabs.length === 0}
                    />
                  </CommandItem>
                ))}
              </div>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { SlashCommandMenu, SlashCommandPicker }
