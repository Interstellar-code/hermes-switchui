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

/** Tiny client check (5 fields); the server validates authoritatively. */
export function cronError(expr: string): string | null {
  const t = expr.trim()
  if (!t) return 'Enter a cron expression.'
  if (t.length > 128) return 'Too long (128 characters max).'
  if (t.startsWith('@'))
    return 'Aliases like @daily aren’t supported; use 5 fields.'
  const parts = t.split(/\s+/)
  if (parts.length !== 5) return 'Use 5 fields: minute hour day month weekday.'
  if (!parts.every((p) => FIELD_RE.test(p)))
    return 'Fields may use numbers, *, ranges (1-5), lists (1,3) and steps (*/5).'
  return null
}

/** Next local fire time for a 5-field cron, or null (scan ≤ 1 year of minutes). */
export function nextCronFire(expr: string, from = new Date()): Date | null {
  if (cronError(expr)) return null
  const [mi, ho, dm, mo, dw] = expr.trim().split(/\s+/)
  const match = (f: string, v: number, lo: number): boolean =>
    f.split(',').some((part) => {
      const [range, step] = part.split('/')
      const n = step ? Number(step) : 1
      let a = lo
      let b = Infinity
      if (range !== '*') {
        const [x, y] = range.split('-').map(Number)
        a = x
        b = range.includes('-') ? y : step ? Infinity : x
      }
      return v >= a && v <= b && (v - a) % n === 0
    })
  const d = new Date(from)
  d.setSeconds(0, 0)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    d.setMinutes(d.getMinutes() + 1)
    const dow = d.getDay()
    const domOk = match(dm, d.getDate(), 1)
    const dowOk = match(dw, dow, 0) || (dow === 0 && match(dw, 7, 0))
    // cron: when both day fields are restricted, either may match.
    const dayOk = dm !== '*' && dw !== '*' ? domOk || dowOk : domOk && dowOk
    if (
      match(mi, d.getMinutes(), 0) &&
      match(ho, d.getHours(), 0) &&
      match(mo, d.getMonth() + 1, 1) &&
      dayOk
    )
      return d
  }
  return null
}
