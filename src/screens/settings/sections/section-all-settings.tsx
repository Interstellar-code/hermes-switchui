/**
 * section-all-settings.tsx — the generated browser over every config field.
 *
 * The curated sections hand-maintain 48 keys. `GET /api/config/schema`
 * publishes **555**. Everything else was reachable only by editing the raw
 * YAML, which is why raw-config became the working method for this app.
 *
 * This section closes that gap without pretending to be a curated surface: it
 * shows the dotted key path in mono next to every row, because with
 * auto-generated title-case descriptions (`"Agent → Max Turns"`) the key is the
 * only reliable identifier, and it marks the rows a curated section already
 * owns rather than silently duplicating them.
 *
 * ## Performance
 *
 * Rows subscribe to the store **per key** (`useSettingValue`), never to the
 * whole store: at this many rows a dense subscription would re-render every
 * row on every keystroke in any of them. Categories are collapsed by default,
 * so a cold open mounts ~36 headers, not 555 inputs.
 *
 * ## Degradation
 *
 * If the schema request fails, this falls back to the `config.*` keys the
 * server config itself contains, grouped by their first segment. That is
 * strictly less than 555 but it is never *nothing*, and the rest of the page is
 * unaffected — see `schema-binding.ts`.
 */

import { memo, useEffect, useMemo, useState } from 'react'
import { SettingCard } from '../components/setting-card'
import { Segmented, Toggle } from '../components/controls'
import {
  humanizeKey,
  orderCategories,
  toSelectOptions,
  useConfigSchema,
  useSchemaDefaults,
  widgetFor,
} from '../lib/schema-binding'
import {
  SECTION_SPEC_BY_ID,
  curatedSectionIdsForKey,
} from '../lib/section-registry'
import type { SchemaField } from '../lib/schema-binding'
import {
  useSetSetting,
  useSettingDirty,
  useSettingValue,
  useSettingsStore,
} from '@/stores/settings-store'

/** A page-wide search term, forwarded by the shell. Optional by design. */
export type SectionAllSettingsProps = { query?: string }

/** More than this and a segmented control stops being readable. */
const SEGMENTED_MAX_OPTIONS = 4

/** Hard cap on rows rendered for one query, so "a" cannot mount 555 inputs. */
const MAX_MATCHES = 200

const MUTED = 'var(--m-text-muted, var(--theme-muted))'
const FAINT = 'var(--m-text-faint, var(--theme-muted))'
const MONO = 'var(--m-font-mono, ui-monospace, monospace)'

// ── Fallback field set ────────────────────────────────────────────────────

/**
 * With no schema, derive a field list from the server config the store already
 * holds. Types come from the live values, which is exactly what `widgetFor`
 * trusts over the declared type anyway.
 */
export function fieldsFromValues(
  values: Record<string, unknown>,
): Array<SchemaField> {
  return Object.keys(values)
    .filter((key) => key.startsWith('config.'))
    .sort()
    .map((key) => {
      const rest = key.slice('config.'.length)
      const dot = rest.indexOf('.')
      return {
        key,
        schemaKey: rest,
        type: 'string' as const,
        description: '',
        category: dot === -1 ? 'general' : rest.slice(0, dot),
      }
    })
}

// ── Matching ──────────────────────────────────────────────────────────────

export function matchesQuery(field: SchemaField, q: string): boolean {
  if (!q) return true
  return (
    field.key.toLowerCase().includes(q) ||
    field.description.toLowerCase().includes(q) ||
    field.category.toLowerCase().includes(q)
  )
}

// ── Controls ──────────────────────────────────────────────────────────────

function NumberCell({
  value,
  onChange,
}: {
  value: unknown
  onChange: (v: number) => void
}) {
  const external = value === undefined || value === null ? '' : String(value)
  const [text, setText] = useState(external)

  // Resync when the store changes underneath — Discard, Refresh, a save.
  useEffect(() => setText(external), [external])

  return (
    <input
      className="text-input input-sm"
      type="number"
      value={text}
      style={{ width: '160px' }}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        if (raw.trim() === '') return
        const n = Number(raw)
        // An unparseable intermediate ("1e", "-") must not be written as NaN.
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

function ListCell({
  value,
  onChange,
}: {
  value: unknown
  onChange: (v: Array<string>) => void
}) {
  const lines = Array.isArray(value) ? value.map((v) => String(v)) : []
  return (
    <textarea
      className="text-input"
      rows={3}
      style={{ width: '100%', fontFamily: MONO, fontSize: '12px' }}
      value={lines.join('\n')}
      onChange={(e) =>
        onChange(
          e.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        )
      }
    />
  )
}

function SelectCell({
  options,
  value,
  onChange,
}: {
  options: Array<string>
  value: unknown
  onChange: (v: string) => void
}) {
  const current = typeof value === 'string' ? value : ''
  const opts = toSelectOptions(options)

  if (opts.length <= SEGMENTED_MAX_OPTIONS) {
    return <Segmented options={opts} value={current} onChange={onChange} />
  }
  return (
    <select
      className="select-input"
      value={current}
      style={{ minWidth: '180px' }}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* A live value the schema does not list must stay visible, not vanish
          into the first option and get written back on the next save. */}
      {current !== '' && !options.includes(current) && (
        <option value={current}>{current} (not in schema)</option>
      )}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────

type RowProps = { field: SchemaField; defaultValue: unknown }

const FieldRow = memo(function Row({ field, defaultValue }: RowProps) {
  const value = useSettingValue(field.key)
  const dirty = useSettingDirty(field.key)
  const setSetting = useSetSetting()

  const curated = curatedSectionIdsForKey(field.key)
    .map((id) => SECTION_SPEC_BY_ID.get(id)?.label ?? id)
    .join(', ')

  const shown = value === undefined ? defaultValue : value
  const widget = widgetFor(field, shown)
  const set = (v: unknown) => setSetting(field.key, v)

  return (
    <div className="row" data-dirty={dirty ? 'true' : undefined}>
      <div className="lbl">
        {humanizeKey(field.key)}
        {dirty && <span className="pill dirty">unsaved</span>}
        {curated && (
          <span className="pill" title={`Also editable under ${curated}`}>
            also in {curated}
          </span>
        )}
        {field.description && (
          <span className="desc">{field.description}</span>
        )}
        <span
          className="desc"
          style={{ fontFamily: MONO, fontSize: '11px', color: FAINT }}
        >
          {field.key}
        </span>
      </div>
      <div className="ctl">
        {widget === 'boolean' && (
          <Toggle on={shown === true} set={(v) => set(v)} />
        )}
        {widget === 'select' && (
          <SelectCell
            options={field.options ?? []}
            value={shown}
            onChange={set}
          />
        )}
        {widget === 'number' && <NumberCell value={shown} onChange={set} />}
        {widget === 'list' && <ListCell value={shown} onChange={set} />}
        {widget === 'text' && (
          <input
            className="text-input"
            type="text"
            style={{ width: '100%', fontFamily: MONO, fontSize: '12px' }}
            value={
              shown === undefined || shown === null ? '' : String(shown)
            }
            onChange={(e) => set(e.target.value)}
          />
        )}
      </div>
    </div>
  )
})

// ── Section ───────────────────────────────────────────────────────────────

export default function SectionAllSettings({
  query = '',
}: SectionAllSettingsProps) {
  const { index, isLoading, isError } = useConfigSchema()
  const defaults = useSchemaDefaults()
  const committed = useSettingsStore((s) => s.committed)

  const [text, setText] = useState(query)
  useEffect(() => setText(query), [query])
  const q = text.trim().toLowerCase()

  const fields = useMemo(
    () => (index.fields.length > 0 ? index.fields : fieldsFromValues(committed)),
    [index, committed],
  )

  const { categories, byCategory, matchCount, truncated } = useMemo(() => {
    const buckets = new Map<string, Array<SchemaField>>()
    let count = 0
    let cut = false
    for (const field of fields) {
      if (!matchesQuery(field, q)) continue
      count++
      if (count > MAX_MATCHES) {
        cut = true
        continue
      }
      const bucket = buckets.get(field.category)
      if (bucket) bucket.push(field)
      else buckets.set(field.category, [field])
    }
    return {
      categories: orderCategories(buckets.keys(), index.categories),
      byCategory: buckets,
      matchCount: count,
      truncated: cut,
    }
  }, [fields, q, index])

  // Collapsed by default; a search opens everything it matched.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const isOpen = (cat: string) => q.length > 0 || open.has(cat)

  function toggle(cat: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>All settings</h2>
          <div className="desc">
            Every field the gateway publishes, generated from{' '}
            <code style={{ fontFamily: MONO }}>/api/config/schema</code>. Rows
            here write the same draft and are applied by the same Save button as
            the curated sections.
          </div>
        </div>
        <div className="meta">{fields.length} fields</div>
      </div>

      {isError && (
        <div
          className="card"
          style={{ padding: '14px 18px', fontSize: '12px', color: MUTED }}
        >
          The gateway did not return a config schema, so this list is built from
          the keys your config file already contains. Every other section is
          unaffected.
        </div>
      )}

      <SettingCard
        title="Browse"
        sub={
          q
            ? `${matchCount} match${matchCount === 1 ? '' : 'es'}`
            : `${categories.length} categories`
        }
      >
        <div className="row">
          <div className="lbl">
            Filter
            <span className="desc">
              Matches the dotted key path, the description and the category.
            </span>
          </div>
          <div className="ctl">
            <input
              className="text-input"
              type="search"
              placeholder="docker, retention, tirith, port…"
              aria-label="Filter all settings"
              style={{ width: '100%' }}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        </div>
        {truncated && (
          <div style={{ padding: '0 18px 14px', fontSize: '11px', color: MUTED }}>
            Showing the first {MAX_MATCHES} of {matchCount} matches — narrow the
            filter to see the rest.
          </div>
        )}
        {isLoading && fields.length === 0 && (
          <div style={{ padding: '0 18px 14px', fontSize: '12px', color: MUTED }}>
            Loading the config schema…
          </div>
        )}
        {!isLoading && matchCount === 0 && (
          <div style={{ padding: '0 18px 14px', fontSize: '12px', color: MUTED }}>
            No setting matches “{text}”.
          </div>
        )}
      </SettingCard>

      {categories.map((cat) => {
        const rows = byCategory.get(cat) ?? []
        return (
          <SettingCard key={cat} title={cat} sub={`${rows.length} fields`}>
            <div className="row">
              <div className="lbl">
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-expanded={isOpen(cat)}
                  onClick={() => toggle(cat)}
                >
                  {isOpen(cat) ? 'Hide' : 'Show'} {rows.length} setting
                  {rows.length === 1 ? '' : 's'}
                </button>
              </div>
              <div className="ctl" />
            </div>
            {isOpen(cat) &&
              rows.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  defaultValue={defaults[field.key]}
                />
              ))}
          </SettingCard>
        )
      })}
    </div>
  )
}
