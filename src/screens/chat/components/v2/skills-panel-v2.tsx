import { memo, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { relativeTime } from './tool-panel-v2'
import { unwrapToolInput } from './tool-entries'
import type { FlatToolEntry } from './tool-entries'

export type SkillInvocation = {
  key: string
  action: string
  summary: string
  result?: string
  isError?: boolean
  ts?: number
}

export type SkillGroup = {
  name: string
  count: number
  loaded: boolean
  edited: boolean
  deleted: boolean
  hasError: boolean
  /** Latest real (display) time; omitted when none is known. */
  lastTs?: number
  /** Ordering key (entry timestamp). */
  sortTs?: number
  invocations: Array<SkillInvocation>
}

const SKILL_TOOLS = new Set(['skill', 'skill_view', 'skill_manage'])
const SEARCH_THRESHOLD = 8
const danger = 'var(--theme-danger, #ef4444)'

const argsOf = (e: FlatToolEntry): Record<string, unknown> =>
  unwrapToolInput(e.input) ?? {}

function resolveSkillName(e: FlatToolEntry): string {
  const n = e.name === 'skill' ? e.output : argsOf(e).name
  return typeof n === 'string' && n.trim()
    ? n.trim().toLowerCase()
    : 'unknown skill'
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}

function summarize(a: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(a)) {
    if (k === 'name' || k === 'action') continue
    if (typeof v === 'string' && v.trim())
      return truncate(`${k}=${v.trim()}`, 80)
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${v}`
  }
  return ''
}

/** Pure: one group per distinct skill + number of skills_list calls. */
export function groupSkills(entries: ReadonlyArray<FlatToolEntry>): {
  groups: Array<SkillGroup>
  catalogListed: number
} {
  const map = new Map<string, SkillGroup>()
  let catalogListed = 0
  for (const e of entries) {
    if (e.name === 'skills_list') {
      catalogListed++
      continue
    }
    if (!SKILL_TOOLS.has(e.name)) continue
    const name = resolveSkillName(e)
    let g = map.get(name)
    if (!g) {
      g = {
        name,
        count: 0,
        loaded: false,
        edited: false,
        deleted: false,
        hasError: false,
        invocations: [],
      }
      map.set(name, g)
    }
    const args = argsOf(e)
    let action = 'Loaded'
    if (e.name === 'skill_manage') {
      const a = args.action
      if (a === 'delete') {
        g.deleted = true
        action = 'Deleted'
      } else if (a === 'create' || a === 'update' || a === 'patch') {
        g.edited = true
        action = a === 'create' ? 'Created' : 'Updated'
      } else action = 'Managed'
    } else g.loaded = true
    // Display uses real wall-clock times only; `timestamp` may be synthetic
    // and is used for ordering.
    const ts = e.displayTs
    if (e.timestamp != null && e.timestamp > (g.sortTs ?? -Infinity))
      g.sortTs = e.timestamp
    g.count++
    if (e.isError) g.hasError = true
    if (ts != null && (g.lastTs == null || ts > g.lastTs)) g.lastTs = ts
    g.invocations.push({
      key: e.key,
      action,
      summary: summarize(args),
      result: e.output,
      isError: e.isError,
      ts,
    })
  }
  const groups = [...map.values()].sort(
    (a, b) =>
      Number(b.hasError) - Number(a.hasError) ||
      (b.sortTs ?? 0) - (a.sortTs ?? 0),
  )
  return { groups, catalogListed }
}

export function distinctSkillCount(
  entries: ReadonlyArray<FlatToolEntry>,
): number {
  return groupSkills(entries).groups.length
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}

function firstLine(s: string): string {
  return s.split('\n', 1)[0]
}

const SkillRow = memo(function SkillRowImpl({ group }: { group: SkillGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 flex-wrap items-center gap-1.5 px-2 py-1.5 text-left text-xs"
        style={{ color: 'var(--theme-text)' }}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        <span
          className="min-w-0 flex-1 truncate font-semibold"
          title={group.name}
        >
          {group.name}
        </span>
        {group.loaded ? (
          <Badge label="LOADED" color="var(--theme-accent, #6366f1)" />
        ) : null}
        {group.edited ? (
          <Badge label="EDITED" color="var(--theme-warning, #f59e0b)" />
        ) : null}
        {group.deleted ? <Badge label="DELETED" color={danger} /> : null}
        {group.hasError ? <Badge label="ERROR" color={danger} /> : null}
        <span
          className="shrink-0 tabular-nums"
          style={{ color: 'var(--theme-muted)' }}
        >
          ×{group.count}
        </span>
        {group.lastTs != null ? (
          <span
            className="shrink-0 text-[10px]"
            style={{ color: 'var(--theme-muted)' }}
          >
            {relativeTime(group.lastTs)}
          </span>
        ) : null}
      </button>
      {open ? (
        <ul className="mx-2 mb-2 space-y-1 text-[11px]">
          {group.invocations.map((inv) => (
            <li
              key={inv.key}
              className="min-w-0 break-words rounded border px-2 py-1"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              <span className="font-semibold">{inv.action}</span>
              {inv.summary ? (
                <span style={{ color: 'var(--theme-muted)' }}>
                  {' '}
                  {inv.summary}
                </span>
              ) : null}
              {inv.result ? (
                <div style={inv.isError ? { color: danger } : undefined}>
                  {truncate(
                    inv.isError ? firstLine(inv.result) : inv.result,
                    120,
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
})

export const SkillsPanelV2 = memo(function SkillsPanelImpl({
  entries,
}: {
  entries: ReadonlyArray<FlatToolEntry>
}) {
  const [query, setQuery] = useState('')
  const { groups, catalogListed } = useMemo(
    () => groupSkills(entries),
    [entries],
  )
  const q = query.trim().toLowerCase()
  const shown = q
    ? groups.filter((g) => g.name.toLowerCase().includes(q))
    : groups

  return (
    <div
      className="flex min-w-0 flex-col gap-2 p-2 text-xs"
      style={{ color: 'var(--theme-text)' }}
    >
      <div
        className="text-[10px] font-medium uppercase tracking-[0.16em]"
        style={{ color: 'var(--theme-muted)' }}
      >
        Used this session
      </div>
      {groups.length > SEARCH_THRESHOLD ? (
        <input
          type="search"
          aria-label="Search skills"
          placeholder="Search skills"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full min-w-0 rounded border bg-transparent px-2 py-1"
          style={{ borderColor: 'var(--theme-border)' }}
        />
      ) : null}
      {groups.length === 0 ? (
        <p style={{ color: 'var(--theme-muted)' }}>
          No skills used in this session
        </p>
      ) : (
        <ul>
          {shown.map((g) => (
            <SkillRow key={g.name} group={g} />
          ))}
        </ul>
      )}
      {catalogListed > 0 ? (
        <p style={{ color: 'var(--theme-muted)' }}>
          Catalog listed {catalogListed}×
        </p>
      ) : null}
      <Link
        to="/skills"
        className="underline"
        style={{ color: 'var(--theme-accent, #6366f1)' }}
      >
        Open Skills page →
      </Link>
    </div>
  )
})
