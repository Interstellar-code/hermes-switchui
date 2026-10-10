/**
 * save-review-dialog.tsx — what the user sees between "Save changes" and the
 * write: pending edits grouped by when they take effect, a YAML diff of
 * persisted vs draft, an honest backup note, and an optional gateway restart.
 */

import { useMemo, useState } from 'react'
import YAML from 'yaml'
import { getKeyMeta } from '../lib/key-meta'
import { ConfirmDialog } from './confirm-dialog'
import type { KeyApplies } from '../lib/key-meta-types'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Verified against hermes-agent (`PUT /api/config` in web_routers/config_env.py
 * calls `save_config`, which does an atomic write and never `backup_config`).
 * The only automatic copies are the "good" snapshots `load_config` keeps in
 * `backups/config/` (newest 5) — taken when a config is *read*, so the exact
 * pre-save file may not be among them.
 */
export const BACKUP_NOTE =
  'Saving does not back up config.yaml. Hermes keeps up to 5 automatic copies of previously loaded configs in ~/.hermes/backups/config/, but the file as it is right now may not be one of them.'

const GROUPS: Array<{ id: KeyApplies | 'other'; label: string }> = [
  { id: 'live', label: 'Applies immediately' },
  { id: 'next-session', label: 'Applies to new sessions' },
  { id: 'restart', label: 'Needs a gateway restart' },
  { id: 'other', label: 'Other' },
]

const SECRET_KEY = /(key|token|secret|password)/i

function show(key: string, value: unknown): unknown {
  return SECRET_KEY.test(key) && value ? '••••••' : value
}

function nest(key: string, value: unknown): Record<string, unknown> {
  const parts = key.replace(/^config\./, '').split('.')
  return parts.reduceRight<Record<string, unknown>>(
    (acc, part, i) => ({ [part]: i === parts.length - 1 ? value : acc }),
    {},
  )
}

export function groupChanges(keys: Iterable<string>) {
  const out = new Map<string, Array<string>>()
  for (const key of keys) {
    const id = getKeyMeta(key)?.applies ?? 'other'
    out.set(id, [...(out.get(id) ?? []), key])
  }
  return GROUPS.filter((g) => out.has(g.id)).map((g) => ({
    ...g,
    keys: out.get(g.id)!.sort(),
  }))
}

/** `-` lines (persisted) then `+` lines (draft) for each changed key. */
export function buildDiff(
  keys: Array<string>,
  committed: Record<string, unknown>,
  draft: Record<string, unknown>,
): Array<{ sign: '-' | '+'; text: string }> {
  const lines: Array<{ sign: '-' | '+'; text: string }> = []
  for (const key of [...keys].sort()) {
    if (key in committed) {
      for (const text of YAML.stringify(nest(key, show(key, committed[key])))
        .trimEnd()
        .split('\n'))
        lines.push({ sign: '-', text })
    }
    for (const text of YAML.stringify(nest(key, show(key, draft[key])))
      .trimEnd()
      .split('\n'))
      lines.push({ sign: '+', text })
  }
  return lines
}

type Props = {
  open: boolean
  onCancel: () => void
  /** `restart` is true when the box was ticked. */
  onConfirm: (restart: boolean) => void
}

export function SaveReviewDialog({ open, onCancel, onConfirm }: Props) {
  const dirty = useSettingsStore((s) => s.dirty)
  const committed = useSettingsStore((s) => s.committed)
  const draft = useSettingsStore((s) => s.draft)

  const keys = useMemo(() => [...dirty], [dirty])
  const groups = useMemo(() => groupChanges(keys), [keys])
  const diff = useMemo(
    () => buildDiff(keys, committed, draft),
    [keys, committed, draft],
  )
  const needsRestart = groups.some((g) => g.id === 'restart')

  // `null` = untouched: follow whether a restart-only change is pending.
  const [choice, setChoice] = useState<boolean | null>(null)
  const restart = choice ?? needsRestart

  return (
    <ConfirmDialog
      open={open}
      title="Review changes"
      message={`${keys.length} ${keys.length === 1 ? 'setting' : 'settings'} will be written to config.yaml.`}
      confirmLabel="Save"
      onConfirm={() => onConfirm(restart)}
      onCancel={onCancel}
    >
      <div
        className="max-h-[60vh] space-y-3 overflow-auto text-sm"
        data-testid="save-review"
      >
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h3 className="font-medium">{g.label}</h3>
            <ul className="ml-4 list-disc text-[var(--m-text-muted,var(--theme-muted))]">
              {g.keys.map((key) => (
                <li key={key}>
                  {getKeyMeta(key)?.label ?? key.replace(/^config\./, '')}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <pre
          aria-label="YAML diff"
          className="overflow-auto rounded border border-[var(--theme-border)] p-2 text-xs"
        >
          {diff.map((l, i) => (
            <div
              key={i}
              className={
                l.sign === '+'
                  ? 'text-[var(--theme-accent)]'
                  : 'text-[var(--m-text-muted,var(--theme-muted))]'
              }
            >
              {l.sign} {l.text}
            </div>
          ))}
        </pre>

        <p className="text-xs text-[var(--m-text-muted,var(--theme-muted))]">
          {BACKUP_NOTE}
        </p>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={restart}
            onChange={(e) => setChoice(e.target.checked)}
          />
          Restart gateway after save
        </label>
      </div>
    </ConfirmDialog>
  )
}
