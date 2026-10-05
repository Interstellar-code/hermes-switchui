/**
 * Client fns + hooks for engine (cron) schedules — plugin >= 0.4.0.
 * Server routes: /api/workflow-schedules[/:id].
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWorkflowFeatures } from './use-workflows'

const JSON_HEADERS = { 'content-type': 'application/json' }

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }
}

export function setScheduleEnabled(id: string, enabled: boolean) {
  return send(`/api/workflow-schedules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled }),
  })
}

export function deleteSchedule(id: string) {
  return send(`/api/workflow-schedules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
  })
}

function useRefreshScheduled() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['conductor', 'scheduled'] })
}

export function useToggleSchedule() {
  const refresh = useRefreshScheduled()
  return useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      setScheduleEnabled(v.id, v.enabled),
    onSettled: refresh,
  })
}

export function useDeleteSchedule() {
  const refresh = useRefreshScheduled()
  return useMutation({ mutationFn: deleteSchedule, onSettled: refresh })
}

/** Repeat needs the engine feature + live scheduler + the hermes-switch profile. */
export const REPEAT_PROFILE = 'hermes-switch'

export function repeatBlockReason(
  f:
    | {
        features: Array<string>
        schedulerAlive: boolean
        profile: string | null
      }
    | undefined,
): string | null {
  if (!f) return 'Checking the workflow engine…'
  if (!f.features.includes('cron_schedule'))
    return 'Engine too old — the workflow engine plugin doesn’t support repeating schedules yet.'
  if (!f.schedulerAlive)
    return 'Scheduler offline — the workflow scheduler daemon isn’t running.'
  if (f.profile !== REPEAT_PROFILE)
    return `Repeating schedules only run on the ${REPEAT_PROFILE} profile (current: ${f.profile ?? 'unknown'}).`
  return null
}

export function useRepeatBlockReason(): string | null {
  const q = useWorkflowFeatures()
  return repeatBlockReason(
    q.isError ? { features: [], schedulerAlive: false, profile: null } : q.data,
  )
}

export const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays 09:00', cron: '0 9 * * 1-5' },
  { label: 'Mondays 09:00', cron: '0 9 * * 1' },
]

const FIELD_RE = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/

/** Standard aliases (no @reboot: it has no next fire time). */
const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
}

const FIELDS: Array<{ name: string; lo: number; hi: number }> = [
  { name: 'minute', lo: 0, hi: 59 },
  { name: 'hour', lo: 0, hi: 23 },
  { name: 'day', lo: 1, hi: 31 },
  { name: 'month', lo: 1, hi: 12 },
  { name: 'weekday', lo: 0, hi: 7 },
]

/** Allowed values of one field, or null when a range or step is out of bounds. */
function expand(f: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of f.split(',')) {
    const [range, stepS] = part.split('/')
    const step = stepS ? Number(stepS) : 1
    let a = lo
    let b = hi
    if (range !== '*') {
      const [x, y] = range.split('-').map(Number)
      a = x
      b = range.includes('-') ? y : stepS ? hi : x
    }
    if (step < 1 || a < lo || b > hi || a > b) return null
    for (let v = a; v <= b; v += step) out.add(v)
  }
  return out
}

/** 5 fields with aliases expanded, or null for an alias we do not accept. */
function fieldsOf(expr: string): Array<string> | null {
  const t = expr.trim()
  if (!t.startsWith('@')) return t.split(/\s+/)
  const a = ALIASES[t.toLowerCase()]
  return a ? a.split(' ') : null
}

/** Tiny client check; the server validates authoritatively. */
export function cronError(expr: string): string | null {
  const t = expr.trim()
  if (!t) return 'Enter a cron expression.'
  if (t.length > 128) return 'Too long (128 characters max).'
  const parts = fieldsOf(t)
  if (!parts)
    return 'Supported aliases: @hourly, @daily, @weekly, @monthly, @yearly.'
  if (parts.length !== 5) return 'Use 5 fields: minute hour day month weekday.'
  if (!parts.every((p) => FIELD_RE.test(p)))
    return 'Fields may use numbers, *, ranges (1-5), lists (1,3) and steps (*/5).'
  for (let i = 0; i < 5; i++) {
    const { name, lo, hi } = FIELDS[i]
    if (!expand(parts[i], lo, hi))
      return `${name} must be ${lo}-${hi} (steps 1 or more).`
  }
  return null
}

/** Years scanned for the next fire; long enough for Feb 29. */
export const CRON_PREVIEW_YEARS = 5

/**
 * Next local fire time, or null when none within CRON_PREVIEW_YEARS. Skips
 * whole months / days / hours that cannot match, so the worst case is a few
 * thousand steps.
 */
export function nextCronFire(expr: string, from = new Date()): Date | null {
  if (cronError(expr)) return null
  const parts = fieldsOf(expr)!
  const [mi, ho, dm, mo, dw] = parts.map((p, i) =>
    expand(p, FIELDS[i].lo, FIELDS[i].hi),
  ) as Array<Set<number>>
  if (dw.has(7)) dw.add(0)
  // cron: when both day fields are restricted, either may match.
  const either = !parts[2].startsWith('*') && !parts[4].startsWith('*')
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const end = new Date(from)
  end.setFullYear(end.getFullYear() + CRON_PREVIEW_YEARS)
  while (d < end) {
    if (!mo.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    const domOk = dm.has(d.getDate())
    const dowOk = dw.has(d.getDay())
    if (!(either ? domOk || dowOk : domOk && dowOk)) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!ho.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!mi.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d
  }
  return null
}
