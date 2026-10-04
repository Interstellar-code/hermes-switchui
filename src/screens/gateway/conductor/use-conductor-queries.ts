/**
 * use-conductor-queries.ts — TanStack Query hooks for Conductor API.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ConductorSnapshot,
  Mission,
} from '../../../server/conductor-store'

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchSnapshot(): Promise<ConductorSnapshot> {
  const res = await fetch('/api/conductor/missions')
  if (!res.ok) throw new Error(`conductor/missions: ${res.status}`)
  return res.json() as Promise<ConductorSnapshot>
}

async function fetchMission(id: string): Promise<Mission> {
  const res = await fetch(`/api/conductor/missions/${id}`)
  if (!res.ok) throw new Error(`conductor/missions/${id}: ${res.status}`)
  return res.json() as Promise<Mission>
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

export function useConductorMission(id: string | null | undefined) {
  return useQuery({
    queryKey: ['conductor', 'mission', id],
    queryFn: () => fetchMission(id!),
    enabled: Boolean(id),
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
