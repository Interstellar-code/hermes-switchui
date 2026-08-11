/**
 * schema-binding.ts — bind the Settings screen to `GET /api/config/schema`.
 *
 * The gateway publishes 555 config fields with their type, category and — for
 * 17 of them — the exact set of legal values. Until now nothing in the app
 * called that endpoint, so every enum in the curated sections was a hand-kept
 * copy that had already drifted (Execution's Terminal backend offers two of the
 * six real values).
 *
 * ## What the schema is, and is not
 *
 * It is authoritative for **which keys exist, what type they are, and which
 * values are legal**. It is *not* a source of copy: descriptions for fields
 * without a curated override are auto-generated title-case
 * (`"Agent → Max Turns"`), and there are no min/max bounds at all. So a curated
 * section keeps its hand-written label and help text and takes only the option
 * list from here.
 *
 * ## Key namespaces
 *
 * The schema keys config fields *bare* (`terminal.backend`); the settings store
 * keys them with a `config.` prefix (`config.terminal.backend`). Everything
 * exported here speaks **store keys**; `schemaKey` is kept on each field for
 * debugging.
 *
 * ## Degradation
 *
 * Every hook here returns an empty index when the request fails or has not
 * landed yet, and every options helper takes the caller's existing hardcoded
 * list as a fallback. **Nothing on this page may block on the schema** — the
 * gateway can be down, or old enough not to serve the endpoint at all, and the
 * curated sections must still render and save.
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { flattenConfig } from './flatten-config'
import type { ConfigSchemaField } from '@/lib/hermes-client'
import { getConfigDefaults, getConfigSchema } from '@/lib/hermes-client'
import { useSettingsStore } from '@/stores/settings-store'

/** The only prefix with a persistence route — see `saver.ts`. */
export const CONFIG_PREFIX = 'config.'

export const SCHEMA_QUERY_KEY = ['config', 'schema'] as const
export const DEFAULTS_QUERY_KEY = ['config', 'defaults'] as const

/**
 * The schema changes only when the agent is upgraded, and the defaults with it.
 * An hour is generous on purpose: this is a 555-entry payload behind a proxy.
 */
const SCHEMA_STALE_TIME = 60 * 60 * 1000

export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'list' | 'select'

export type SchemaField = {
  /** Store key, `config.`-prefixed. */
  key: string
  /** The bare key as the gateway publishes it. */
  schemaKey: string
  type: SchemaFieldType
  description: string
  category: string
  /** Present on 17 fields; the legal values, in the gateway's own order. */
  options?: Array<string>
}

export type SchemaIndex = {
  byKey: Map<string, SchemaField>
  /** Every field, in the gateway's publication order. */
  fields: Array<SchemaField>
  /** Categories, `category_order` first then the rest alphabetically. */
  categories: Array<string>
  byCategory: Map<string, Array<SchemaField>>
}

export const EMPTY_SCHEMA_INDEX: SchemaIndex = {
  byKey: new Map(),
  fields: [],
  categories: [],
  byCategory: new Map(),
}

// ── Pure index construction ───────────────────────────────────────────────

const KNOWN_TYPES = new Set<SchemaFieldType>([
  'string',
  'number',
  'boolean',
  'list',
  'select',
])

/**
 * The live schema serves one field typed `bool` rather than `boolean`
 * (`updates.refresh_cua_driver`), so this normalises rather than trusting the
 * string. Anything unrecognised degrades to `string`, which is the only widget
 * that cannot corrupt a value it does not understand.
 */
export function normalizeType(raw: unknown, hasOptions = false): SchemaFieldType {
  if (hasOptions) return 'select'
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (KNOWN_TYPES.has(t as SchemaFieldType)) return t as SchemaFieldType
  if (t === 'bool') return 'boolean'
  if (t === 'int' || t === 'integer' || t === 'float') return 'number'
  if (t === 'array') return 'list'
  if (t === 'enum') return 'select'
  return 'string'
}

/**
 * `category_order` covers 15 of the 36 categories the fields actually use.
 * Ordered ones first, in the gateway's order; the remaining 21 alphabetically
 * so the browser is at least deterministic.
 */
export function orderCategories(
  present: Iterable<string>,
  order: Array<string> | undefined,
): Array<string> {
  const seen = new Set(present)
  const out: Array<string> = []
  for (const cat of order ?? []) {
    if (seen.delete(cat)) out.push(cat)
  }
  return [...out, ...Array.from(seen).sort((a, b) => a.localeCompare(b))]
}

/**
 * Build the index from a raw schema payload. Tolerant by construction: a
 * malformed or partial response yields fewer fields, never a throw, because the
 * only alternative is an unrenderable Settings page.
 */
export function buildSchemaIndex(raw: unknown): SchemaIndex {
  // Typed as `unknown` on purpose: this is network data, and the runtime guards
  // below are the point of the function.
  const payload = (raw ?? {}) as { fields?: unknown; category_order?: unknown }
  const rawFields = payload.fields
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    return EMPTY_SCHEMA_INDEX
  }

  const fields: Array<SchemaField> = []
  const byKey = new Map<string, SchemaField>()
  const byCategory = new Map<string, Array<SchemaField>>()

  for (const [schemaKey, entry] of Object.entries(
    rawFields as Record<string, unknown>,
  )) {
    if (!schemaKey || typeof entry !== 'object' || entry === null) continue
    const value = entry as ConfigSchemaField
    const options = Array.isArray(value.options)
      ? value.options.filter((o): o is string => typeof o === 'string')
      : undefined
    const field: SchemaField = {
      key: `${CONFIG_PREFIX}${schemaKey}`,
      schemaKey,
      type: normalizeType(value.type, (options?.length ?? 0) > 0),
      description: typeof value.description === 'string' ? value.description : '',
      category: typeof value.category === 'string' && value.category ? value.category : 'other',
      ...(options && options.length > 0 ? { options } : {}),
    }
    fields.push(field)
    byKey.set(field.key, field)
    const bucket = byCategory.get(field.category)
    if (bucket) bucket.push(field)
    else byCategory.set(field.category, [field])
  }

  const order = Array.isArray(payload.category_order)
    ? payload.category_order.filter((c): c is string => typeof c === 'string')
    : undefined
  const categories = orderCategories(byCategory.keys(), order)

  return { byKey, fields, categories, byCategory }
}

// ── Widgets ───────────────────────────────────────────────────────────────

export type WidgetKind = 'select' | 'boolean' | 'number' | 'list' | 'text'

/**
 * Which control to render for a field.
 *
 * The *live value* outranks the declared type when the two disagree, because
 * the schema is derived from the gateway's defaults and is demonstrably wrong
 * in places (`terminal.docker_network` is declared `boolean` but holds a
 * network name). Rendering a Toggle over a string would coerce it to `true` on
 * the first click and write that to the user's config — a widget that silently
 * corrupts data is worse than one that is merely plain.
 */
export function widgetFor(
  field: SchemaField | undefined,
  value: unknown,
): WidgetKind {
  if (field?.options?.length) return 'select'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number') return 'number'
  if (value !== undefined && value !== null) return 'text'
  switch (field?.type) {
    case 'boolean':
      return 'boolean'
    case 'number':
      return 'number'
    case 'list':
      return 'list'
    case 'select':
      return 'select'
    default:
      return 'text'
  }
}

/** `config.terminal.docker_image` → `Docker image`. */
export function humanizeKey(key: string): string {
  const leaf = key.split('.').pop() ?? key
  const words = leaf.replace(/[_-]+/g, ' ').trim()
  if (!words) return key
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** An empty-string option is the gateway's "unset"; name it so. */
export function optionLabel(value: string): string {
  return value === '' ? '(unset)' : value
}

export function toSelectOptions(
  options: Array<string>,
): Array<{ value: string; label: string }> {
  return options.map((value) => ({ value, label: optionLabel(value) }))
}

/**
 * Legal values for `key`, or `fallback` when the schema has nothing to say.
 * The fallback is what keeps a curated section working with the gateway down.
 */
export function optionsFor(
  index: SchemaIndex,
  key: string,
  fallback?: Array<{ value: string; label: string }>,
): Array<{ value: string; label: string }> | undefined {
  const options = index.byKey.get(key)?.options
  if (!options || options.length === 0) return fallback
  return toSelectOptions(options)
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export type UseConfigSchemaResult = {
  index: SchemaIndex
  isLoading: boolean
  isError: boolean
  error: Error | null
}

/**
 * The schema, cached process-wide by TanStack Query. Never suspends and never
 * throws: an error resolves to `EMPTY_SCHEMA_INDEX` and callers fall back.
 */
export function useConfigSchema(): UseConfigSchemaResult {
  const query = useQuery({
    queryKey: SCHEMA_QUERY_KEY,
    queryFn: getConfigSchema,
    staleTime: SCHEMA_STALE_TIME,
    gcTime: SCHEMA_STALE_TIME,
    retry: false,
    // A stale schema is harmless; a refetch storm on a 555-field payload is not.
    refetchOnWindowFocus: false,
  })

  // 555 fields — rebuilding the index on every keystroke in the browser's
  // search box would be the most expensive thing on the page.
  const data = query.data
  const index = useMemo(
    () => (data ? buildSchemaIndex(data) : EMPTY_SCHEMA_INDEX),
    [data],
  )

  return {
    index,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ?? null,
  }
}

export function useSchemaField(key: string): SchemaField | undefined {
  return useConfigSchema().index.byKey.get(key)
}

/**
 * Enum options for one key, schema-first. Pass the section's existing
 * hardcoded list as `fallback` and it keeps working when the schema is
 * unavailable.
 */
export function useSchemaOptions(
  key: string,
  fallback?: Array<{ value: string; label: string }>,
): Array<{ value: string; label: string }> | undefined {
  const { index } = useConfigSchema()
  return optionsFor(index, key, fallback)
}

const EMPTY_DEFAULTS: Record<string, unknown> = {}

/**
 * `GET /api/config/defaults`, flattened to `config.*` store keys. Empty on
 * failure.
 */
export function useSchemaDefaults(): Record<string, unknown> {
  const query = useQuery({
    queryKey: DEFAULTS_QUERY_KEY,
    queryFn: getConfigDefaults,
    staleTime: SCHEMA_STALE_TIME,
    gcTime: SCHEMA_STALE_TIME,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const data = query.data
  return useMemo(
    () =>
      data && typeof data === 'object'
        ? flattenConfig(data as Record<string, unknown>)
        : EMPTY_DEFAULTS,
    [data],
  )
}

/**
 * Feed the gateway's own defaults into the store's `defaults` map, so a key the
 * user's config does not define still renders its real fallback instead of an
 * inline `?? 90` guess — and so editing it and changing your mind returns the
 * row to clean.
 *
 * `registerDefaults` is additive, idempotent and may never write `status`,
 * `committed` or `dirty`, so this is safe to call from the shell on every
 * render. Defaults are deliberately excluded from Export.
 */
export function useRegisterSchemaDefaults(): void {
  const defaults = useSchemaDefaults()
  useEffect(() => {
    const keys = Object.keys(defaults)
    if (keys.length === 0) return
    useSettingsStore.getState().registerDefaults(defaults)
  }, [defaults])
}
