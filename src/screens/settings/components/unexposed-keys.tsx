/**
 * unexposed-keys.tsx — schema keys under a prefix that no curated section
 * declares (board A's "More agent.* keys" block).
 *
 * The curated sections cover a slice of what `GET /api/config/schema`
 * publishes; everything else was reachable only through raw YAML editing.
 * This lists the rest under a section whose declared keys share one dotted
 * prefix, with each key's current value and its default, and hands off to the
 * All-settings browser (filtered to that key) for editing — the same
 * section+query path the sidebar's search results use.
 *
 * Collapsed by default: board A keeps the rail on intent, not on volume.
 */

import { useMemo, useState } from 'react'
import { curatedSectionIdsForKey } from '../lib/section-registry'
import { useConfigSchema, useSchemaDefaults } from '../lib/schema-binding'
import { getKeyMeta } from '../lib/key-meta'
import { useSettingsStore } from '@/stores/settings-store'

export type UnexposedKeysProps = {
  /** Bare dotted prefix, e.g. `agent.`. */
  prefix: string
  /**
   * Jump to All-settings filtered to one key. The screen owns the section and
   * the page-wide query, so the jump is a callback rather than navigation.
   */
  onEditKey?: (key: string) => void
}

/** `null` → `null`, `'x'` → `"x"`, absent → `(unset)`. YAML values only —
 *  JSON.stringify cannot hit its symbol/function `undefined` path here. */
function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)'
  return JSON.stringify(value)
}

export function UnexposedKeys({ prefix, onEditKey }: UnexposedKeysProps) {
  const { index } = useConfigSchema()
  const draft = useSettingsStore((s) => s.draft)
  const defaults = useSchemaDefaults()
  const [expanded, setExpanded] = useState(false)

  const unexposed = useMemo(
    () =>
      index.fields
        .filter((f) => f.schemaKey.startsWith(prefix))
        .filter((f) => curatedSectionIdsForKey(f.key).length === 0)
        .sort((a, b) => a.schemaKey.localeCompare(b.schemaKey)),
    [index, prefix],
  )

  if (unexposed.length === 0) return null

  return (
    <div className="card unexposed-keys">
      <button
        type="button"
        className="unexposed-head"
        aria-expanded={expanded}
        aria-controls="unexposed-key-list"
        onClick={() => setExpanded((v) => !v)}
      >
        More {prefix}* keys · schema rows no curated control yet ·{' '}
        {unexposed.length} keys · {expanded ? 'hide' : 'show all'}
      </button>
      {expanded && (
        <div className="unexposed-list" id="unexposed-key-list">
          {unexposed.map((field) => {
            const value = draft[field.key]
            const def = defaults[field.key] ?? getKeyMeta(field.key)?.default
            return (
              <div key={field.key} className="unexposed-row">
                <span className="unexposed-key">{field.schemaKey}</span>
                <span className="unexposed-value">{formatValue(value)}</span>
                <span className="unexposed-default">
                  · default {formatValue(def)}
                </span>
                <button
                  type="button"
                  className="btn unexposed-edit"
                  onClick={() => onEditKey?.(field.schemaKey)}
                >
                  Edit
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
