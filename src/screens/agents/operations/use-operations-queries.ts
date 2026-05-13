/**
 * use-operations-queries.ts — TanStack Query hooks for Operations API (M6).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import type { Agent, FocusData, OperationsState, TeamOutput } from '../../../server/operations-store'

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchState(): Promise<OperationsState> {
  const res = await fetch('/api/operations/state')
  if (!res.ok) throw new Error(`operations/state: ${res.status}`)
  return res.json() as Promise<OperationsState>
}

async function fetchAgents(): Promise<Array<Agent>> {
  const res = await fetch('/api/operations/agents')
  if (!res.ok) throw new Error(`operations/agents: ${res.status}`)
  return res.json() as Promise<Array<Agent>>
}

async function fetchAgent(id: string): Promise<FocusData> {
  const res = await fetch(`/api/operations/agents/${id}`)
  if (!res.ok) throw new Error(`operations/agents/${id}: ${res.status}`)
  return res.json() as Promise<FocusData>
}

async function fetchOutputs(): Promise<Array<TeamOutput>> {
  const res = await fetch('/api/operations/outputs')
  if (!res.ok) throw new Error(`operations/outputs: ${res.status}`)
  return res.json() as Promise<Array<TeamOutput>>
}

async function postPauseAgent(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/operations/agents/${id}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error(`pause ${id}: ${res.status}`)
  return res.json() as Promise<{ ok: true }>
}

async function postResumeAgent(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/operations/agents/${id}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error(`resume ${id}: ${res.status}`)
  return res.json() as Promise<{ ok: true }>
}

async function postCreateAgent(input: {
  name: string
  role: 'orchestrator' | 'worker'
  task: string
}): Promise<Agent> {
  const res = await fetch('/api/operations/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`create agent: ${res.status}`)
  return res.json() as Promise<Agent>
}

async function postDispatch(input: {
  prompt: string
  mode?: string
  priority?: string
  budget?: string
  deadline?: string
  tags?: Array<string>
}): Promise<{ ok: true; dispatchId: string }> {
  const res = await fetch('/api/operations/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`dispatch: ${res.status}`)
  return res.json() as Promise<{ ok: true; dispatchId: string }>
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useOperationsState() {
  const autoRefresh = useOperationsUIStore((s) => s.autoRefresh)
  return useQuery({
    queryKey: ['operations', 'state'],
    queryFn: fetchState,
    refetchInterval: autoRefresh ? 2000 : false,
  })
}

export function useOperationsAgents() {
  const autoRefresh = useOperationsUIStore((s) => s.autoRefresh)
  return useQuery({
    queryKey: ['operations', 'agents'],
    queryFn: fetchAgents,
    refetchInterval: autoRefresh ? 2000 : false,
  })
}

export function useOperationsAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ['operations', 'agent', id],
    queryFn: () => fetchAgent(id!),
    enabled: Boolean(id),
  })
}

export function useOperationsOutputs() {
  const autoRefresh = useOperationsUIStore((s) => s.autoRefresh)
  return useQuery({
    queryKey: ['operations', 'outputs'],
    queryFn: fetchOutputs,
    refetchInterval: autoRefresh ? 4000 : false,
  })
}

export function usePauseAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => postPauseAgent(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operations', 'agents'] })
      void queryClient.invalidateQueries({ queryKey: ['operations', 'state'] })
    },
  })
}

export function useResumeAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => postResumeAgent(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operations', 'agents'] })
      void queryClient.invalidateQueries({ queryKey: ['operations', 'state'] })
    },
  })
}

export function useCreateAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: postCreateAgent,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operations', 'agents'] })
      void queryClient.invalidateQueries({ queryKey: ['operations', 'state'] })
    },
  })
}

export function useDispatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: postDispatch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operations', 'agents'] })
      void queryClient.invalidateQueries({ queryKey: ['operations', 'state'] })
    },
  })
}

export type { Agent, FocusData, OperationsState, TeamOutput }
