/**
 * use-conductor-queries.ts — TanStack Query hooks for Conductor API.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RunSessions } from '../../../server/workflow-engine/interface'
import type {
  ConductorSnapshot,
  Mission,
  ScheduledResponse,
} from '../../../server/conductor-store'

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchSnapshot(): Promise<ConductorSnapshot> {
  const res = await fetch('/api/conductor/missions')
  if (!res.ok) throw new Error(`conductor/missions: ${res.status}`)
  return res.json() as Promise<ConductorSnapshot>
}

async function fetchScheduled(): Promise<ScheduledResponse> {
  const res = await fetch('/api/conductor/scheduled')
  if (!res.ok) throw new Error(`conductor/scheduled: ${res.status}`)
  return res.json() as Promise<ScheduledResponse>
}

async function fetchMission(id: string): Promise<Mission> {
  const res = await fetch(`/api/conductor/missions/${id}`)
  if (!res.ok) throw new Error(`conductor/missions/${id}: ${res.status}`)
  return res.json() as Promise<Mission>
}

export interface RunSessionsResponse {
  available: boolean
  data: RunSessions | null
}

async function fetchRunSessions(id: string): Promise<RunSessionsResponse> {
  const res = await fetch(
    `/api/conductor/runs/${encodeURIComponent(id)}/sessions`,
  )
  if (!res.ok) throw new Error(`conductor/runs/${id}/sessions: ${res.status}`)
  return res.json() as Promise<RunSessionsResponse>
}

async function postAbortMission(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/conductor/missions/${id}/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error(`abort ${id}: ${res.status}`)
  return res.json() as Promise<{ ok: boolean }>
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** 2s while any run is live/waiting/queued, 10s when idle. */
function adaptiveInterval(missions: Array<Mission> | undefined): number {
  return missions?.some(
    (m) =>
      m.status === 'live' || m.status === 'waiting' || m.status === 'queued',
  )
    ? 2000
    : 10_000
}

export function useConductorSnapshot() {
  return useQuery({
    queryKey: ['conductor', 'missions'],
    queryFn: fetchSnapshot,
    refetchInterval: (query) => adaptiveInterval(query.state.data?.missions),
  })
}

export function useConductorMissions() {
  return useQuery({
    queryKey: ['conductor', 'missions'],
    queryFn: fetchSnapshot,
    refetchInterval: (query) => adaptiveInterval(query.state.data?.missions),
    select: (snapshot) => snapshot.missions,
  })
}

export function useConductorState() {
  return useQuery({
    queryKey: ['conductor', 'missions'],
    queryFn: fetchSnapshot,
    refetchInterval: (query) => adaptiveInterval(query.state.data?.missions),
    select: (snapshot) => snapshot.stats,
  })
}

export function useConductorScheduled() {
  return useQuery({
    queryKey: ['conductor', 'scheduled'],
    queryFn: fetchScheduled,
    refetchInterval: 60_000,
  })
}

export function useConductorMission(id: string | null | undefined) {
  return useQuery({
    queryKey: ['conductor', 'mission', id],
    queryFn: () => fetchMission(id!),
    enabled: Boolean(id),
  })
}

/** Sessions linked to the focused run; 10s poll (plan §7), never for other runs. */
export function useRunSessions(runId: string | null | undefined) {
  return useQuery({
    queryKey: ['conductor', 'sessions', runId],
    queryFn: () => fetchRunSessions(runId!),
    enabled: Boolean(runId),
    refetchInterval: 10_000,
  })
}

export function useAbortMission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => postAbortMission(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conductor'] })
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
    },
  })
}

export type { Mission }
