/**
 * search-index.ts — real search across the Settings page.
 *
 * The sidebar used to filter 27 section *labels*. Searching "docker",
 * "tirith", "retention" or "port" — every one of them a real, editable setting
 * — returned nothing, on a page with 27 sections and 555 fields. That is the
 * single highest-value affordance missing here.
 *
 * The index is built from two sources and neither is sufficient alone:
 *
 *   - the **schema** (`GET /api/config/schema`) knows all 555 keys, their
 *     categories and their auto-generated descriptions;
 *   - the **registry** (`SECTION_SPECS`) knows which section edits which key,
 *     and carries four keys the schema does not publish at all
 *     (`config.fallback_model`, `config.gateway.multiplex_profiles`,
 *     `config.platforms.api_server.{host,port}`).
 *
 * Section titles stay searchable so today's behaviour is a strict subset of the
 * new one.
 *
 * This module is pure. It takes a `SchemaIndex` and returns data; the sidebar
 * decides how to draw it.
 */

import {
  SECTION_SPECS,
  SECTION_SPEC_BY_ID,
  sectionIdForKey,
} from './section-registry'
import { EMPTY_SCHEMA_INDEX, humanizeKey } from './schema-binding'
import type { SchemaIndex } from './schema-binding'

/** One searchable setting. */
export type SearchEntry = {
  /** Store key, `config.`-prefixed. The only reliable identifier. */
  key: string
  /** Human label — the leaf name, title-cased. */
  label: string
  /** Schema description, when there is one. Often auto-generated title-case. */
  description: string
  category: string
  /** Section that edits it; `all-settings` when no curated section claims it. */
  sectionId: string
  sectionLabel: string
  group: string
  /** Precomputed lowercase haystack — search runs on every keystroke. */
  haystack: string
}

export type SearchIndex = {
  entries: Array<SearchEntry>
  byKey: Map<string, SearchEntry>
}

export const EMPTY_SEARCH_INDEX: SearchIndex = { entries: [], byKey: new Map() }

/** Where an orphan key lands. Must match the registry's catch-all spec. */
export const CATCH_ALL_SECTION_ID = 'all-settings'

function sectionMeta(id: string): { label: string; group: string } {
  const spec = SECTION_SPEC_BY_ID.get(id)
  return { label: spec?.label ?? id, group: spec?.group ?? 'Advanced' }
}

/**
 * Build the searchable universe. Registry keys are added first so a curated
 * section's own copy of a key wins the section attribution, then every schema
 * field that is not already present.
 */
export function buildSearchIndex(
  schema: SchemaIndex = EMPTY_SCHEMA_INDEX,
): SearchIndex {
  const byKey = new Map<string, SearchEntry>()

  const add = (
    key: string,
    description: string,
    category: string,
    sectionId: string,
  ) => {
    if (byKey.has(key)) return
    const { label: sectionLabel, group } = sectionMeta(sectionId)
    const label = humanizeKey(key)
    byKey.set(key, {
      key,
      label,
      description,
      category,
      sectionId,
      sectionLabel,
      group,
      haystack:
        `${key} ${label} ${description} ${category} ${sectionLabel} ${group}`.toLowerCase(),
    })
  }

  for (const spec of SECTION_SPECS) {
    for (const key of spec.keys ?? []) {
      const field = schema.byKey.get(key)
      add(key, field?.description ?? '', field?.category ?? '', spec.id)
    }
  }

  for (const field of schema.fields) {
    // `sectionIdForKey` resolves exact-before-prefix, so a curated owner wins
    // and everything else falls through to the catch-all.
    add(
      field.key,
      field.description,
      field.category,
      sectionIdForKey(field.key) ?? CATCH_ALL_SECTION_ID,
    )
  }

  return { entries: Array.from(byKey.values()), byKey }
}

// ── Query ─────────────────────────────────────────────────────────────────

export type SearchHit = SearchEntry & { score: number }

export type SectionHits = {
  sectionId: string
  sectionLabel: string
  group: string
  /** The section title itself matched the query. */
  titleMatch: boolean
  hits: Array<SearchHit>
  /** Hits above the per-section cap, kept as a count so nothing looks lost. */
  overflow: number
}

/** Highest score wins. Exact key beats key-substring beats label beats prose. */
function scoreEntry(entry: SearchEntry, q: string): number {
  const key = entry.key.toLowerCase()
  if (key === q || key === `config.${q}`) return 100
  const leaf = key.slice(key.lastIndexOf('.') + 1)
  if (leaf === q) return 90
  if (leaf.startsWith(q)) return 80
  if (key.includes(q)) return 70
  if (entry.label.toLowerCase().includes(q)) return 60
  if (entry.description.toLowerCase().includes(q)) return 40
  if (entry.haystack.includes(q)) return 20
  return 0
}

/** Flat ranked hits. `limit` caps the total, not the per-section list. */
export function searchSettings(
  index: SearchIndex,
  query: string,
  limit = 200,
): Array<SearchHit> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Array<SearchHit> = []
  for (const entry of index.entries) {
    const score = scoreEntry(entry, q)
    if (score > 0) hits.push({ ...entry, score })
  }
  hits.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
  return hits.slice(0, limit)
}

/** A section whose *title* matches, so "safety" still finds Safety. */
function titleMatches(query: string): Set<string> {
  const out = new Set<string>()
  for (const spec of SECTION_SPECS) {
    if (
      spec.label.toLowerCase().includes(query) ||
      spec.group.toLowerCase().includes(query) ||
      spec.id.toLowerCase().includes(query)
    ) {
      out.add(spec.id)
    }
  }
  return out
}

/**
 * Search results as the sidebar wants them: matching *settings* grouped under
 * the section that owns them, plus any section whose own title matched.
 *
 * `perSection` keeps one broad term ("a") from rendering hundreds of rows into
 * the rail; the surplus is reported as `overflow` rather than dropped silently.
 */
export function searchSections(
  index: SearchIndex,
  query: string,
  perSection = 6,
): Array<SectionHits> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const titles = titleMatches(q)
  const bySection = new Map<string, SectionHits>()

  const ensure = (sectionId: string): SectionHits => {
    let bucket = bySection.get(sectionId)
    if (!bucket) {
      const { label, group } = sectionMeta(sectionId)
      bucket = {
        sectionId,
        sectionLabel: label,
        group,
        titleMatch: titles.has(sectionId),
        hits: [],
        overflow: 0,
      }
      bySection.set(sectionId, bucket)
    }
    return bucket
  }

  for (const id of titles) ensure(id)

  for (const hit of searchSettings(index, q, 500)) {
    const bucket = ensure(hit.sectionId)
    if (bucket.hits.length < perSection) bucket.hits.push(hit)
    else bucket.overflow++
  }

  // Sections ordered as the sidebar orders them, so results never jump around.
  const order = new Map(SECTION_SPECS.map((s, i) => [s.id, i]))
  return Array.from(bySection.values()).sort(
    (a, b) =>
      (order.get(a.sectionId) ?? 999) - (order.get(b.sectionId) ?? 999),
  )
}
