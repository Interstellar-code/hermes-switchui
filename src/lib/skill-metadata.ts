import { useQuery } from '@tanstack/react-query'

/**
 * Per-skill metadata for the slash picker, read from `GET /api/skills`.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 * `commands.catalog` gives skill commands **no category** — that absence is the
 * only thing marking them as skills (`HermesAgentCommand.skill`), and it is why
 * the picker's Skills facet was one flat alphabetical list of 79 entries. The
 * groupable metadata lives one endpoint over, on `/api/skills`, which SwitchUI
 * already serves: category, Hermes' own `provenance`, and an invocation counter.
 *
 * The two sides are joined **by slug** (`skillSlug`), client-side. Nothing here
 * is load-bearing for correctness: a command that finds no row keeps the flat
 * `Skills` category it has today. Never drop a command because the join missed —
 * that hides working functionality, which is strictly worse than an ungrouped
 * entry.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 * `fields=summary` drops each row's `content` (the whole SKILL.md body). On this
 * machine that is 55 KB instead of 1.0 MB for the same 88 rows. Do not remove it
 * — the picker needs four fields per skill and none of them is the body.
 */

export type SkillProvenance = 'agent' | 'bundled' | 'unknown'

export type SkillMetadata = {
  /** Join key: the slugified skill name. */
  slug: string
  /** Display category, already normalized by the route (e.g. `Git & GitHub`). */
  category: string
  /**
   * `agent` marks a skill this install produced — `/learn` and the curator wrote
   * these, and they are the only ones with a personal story. Rows the local
   * filesystem scan found, which the agent does not know about, are `unknown`.
   */
  provenance: SkillProvenance
  /** Hermes' invocation counter. Near-zero for most skills; see the ranking note. */
  invocations: number
}

export type SkillMetadataIndex = ReadonlyMap<string, SkillMetadata>

export const EMPTY_SKILL_METADATA_INDEX: SkillMetadataIndex = new Map()

/**
 * The join key on both sides.
 *
 * Lowercase, drop a leading slash, spaces and underscores become `-`, and every
 * remaining non-alphanumeric is stripped. `/GIF Search` and `gif_search` both
 * land on `gif-search`.
 */
export function skillSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readProvenance(value: unknown, origin: unknown): SkillProvenance {
  const raw = readString(value).toLowerCase()
  if (raw === 'agent') return 'agent'
  if (raw) return 'bundled'
  // Older payloads carry no `provenance`; SwitchUI's own derived `origin` says
  // the same thing for the agent-authored case, so fall back to it rather than
  // silently badging nothing.
  return readString(origin) === 'agent-created' ? 'agent' : 'unknown'
}

/**
 * Build the slug → metadata index. Total: any shape it does not recognize
 * yields an empty index, which degrades the picker to today's flat list.
 *
 * Every spelling a row offers (`name`, `id`, `slug`) is indexed, because the
 * command name matches whichever the agent happened to register. First row to
 * claim a key keeps it, so the result does not depend on row order.
 */
export function buildSkillMetadataIndex(payload: unknown): SkillMetadataIndex {
  const rows =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).skills
      : payload
  if (!Array.isArray(rows)) return EMPTY_SKILL_METADATA_INDEX

  const index = new Map<string, SkillMetadata>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const category = readString(record.category)
    if (!category) continue

    const meta: SkillMetadata = {
      slug: skillSlug(readString(record.slug) || readString(record.id)),
      category,
      provenance: readProvenance(record.provenance, record.origin),
      invocations:
        typeof record.usage === 'number' && Number.isFinite(record.usage)
          ? Math.max(0, record.usage)
          : 0,
    }

    for (const spelling of [record.name, record.id, record.slug]) {
      const key = skillSlug(readString(spelling))
      if (!key || index.has(key)) continue
      index.set(key, meta)
    }
  }
  return index
}

export const skillMetadataKeys = {
  all: ['skill-metadata'] as const,
  index: () => ['skill-metadata', 'index'] as const,
}

export const SKILL_METADATA_URL =
  '/api/skills?tab=installed&limit=1000&fields=summary'

/** Never throws: a degraded or unauthorized answer is an empty index. */
export async function fetchSkillMetadataIndex(): Promise<SkillMetadataIndex> {
  try {
    const response = await fetch(SKILL_METADATA_URL)
    if (!response.ok) return EMPTY_SKILL_METADATA_INDEX
    return buildSkillMetadataIndex(await response.json())
  } catch {
    return EMPTY_SKILL_METADATA_INDEX
  }
}

/**
 * Skill metadata for the picker. `enabled: false` (no skill commands in the
 * catalog) answers an empty index without spending the request.
 */
export function useSkillMetadataIndex(options?: {
  enabled?: boolean
}): SkillMetadataIndex {
  const query = useQuery({
    queryKey: skillMetadataKeys.index(),
    queryFn: fetchSkillMetadataIndex,
    enabled: options?.enabled !== false,
    // The list changes only when a skill is installed or written; the picker can
    // hold a five-minute-old view of it without anyone noticing.
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  return query.data ?? EMPTY_SKILL_METADATA_INDEX
}
