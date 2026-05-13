/**
 * use-conductor-queries.ts — TanStack Query hooks for Conductor API (M6).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Mission } from '../../../server/conductor-store'

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchConductorState() {
  const res = await fetch('/api/conductor/state')
  if (!res.ok) throw new Error(`conductor/state: ${res.status}`)
  return res.json() as Promise<{
    liveMissions: number
    elapsed: string
    workersActive: number
    tokensUsed: string
  }>
}

async function fetchMissions(): Promise<Array<Mission>> {
  const res = await fetch('/api/conductor/missions')
  if (!res.ok) throw new Error(`conductor/missions: ${res.status}`)
  return res.json() as Promise<Array<Mission>>
}

async function fetchMission(id: string): Promise<Mission> {
  const res = await fetch(`/api/conductor/missions/${id}`)
  if (!res.ok) throw new Error(`conductor/missions/${id}: ${res.status}`)
  return res.json() as Promise<Mission>
}

async function postAbortMission(id: string): Promise<{ ok: boolean; mission: Mission }> {
  const res = await fetch(`/api/conductor/missions/${id}/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error(`abort ${id}: ${res.status}`)
  return res.json() as Promise<{ ok: boolean; mission: Mission }>
}

async function postCreateMission(input: {
  title: string
  subtitle?: string
}): Promise<Mission> {
  const res = await fetch('/api/conductor/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`create mission: ${res.status}`)
  return res.json() as Promise<Mission>
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useConductorState() {
  return useQuery({
    queryKey: ['conductor', 'state'],
    queryFn: fetchConductorState,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && data.liveMissions > 0) return 2000
      return 5000
    },
  })
}

export function useConductorMissions() {
  return useQuery({
    queryKey: ['conductor', 'missions'],
    queryFn: fetchMissions,
    refetchInterval: 2000,
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
      void queryClient.invalidateQueries({ queryKey: ['conductor', 'missions'] })
      void queryClient.invalidateQueries({ queryKey: ['conductor', 'state'] })
    },
  })
}

export function useCreateMission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; subtitle?: string }) =>
      postCreateMission(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conductor', 'missions'] })
      void queryClient.invalidateQueries({ queryKey: ['conductor', 'state'] })
    },
  })
}

export type { Mission }
