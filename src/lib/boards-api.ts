import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BoardMeta,
  CreateBoardInput,
  KanbanBoardsListResponse,
  UpdateBoardInput,
} from './hermes-kanban-types'

async function boardsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
    throw new Error(body.error ?? body.detail ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const boardsKeys = {
  all: ['hermes-kanban', 'boards'] as const,
  list: (includeArchived: boolean) =>
    ['hermes-kanban', 'boards', 'list', { includeArchived }] as const,
}

export async function fetchBoards(includeArchived = false): Promise<KanbanBoardsListResponse> {
  const q = new URLSearchParams()
  if (includeArchived) q.set('include_archived', 'true')
  const qs = q.toString()
  return boardsJson<KanbanBoardsListResponse>(`/api/hermes-kanban/boards${qs ? `?${qs}` : ''}`)
}

export async function fetchCreateBoard(
  input: CreateBoardInput,
): Promise<{ board: BoardMeta; current: string }> {
  return boardsJson<{ board: BoardMeta; current: string }>('/api/hermes-kanban/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function fetchUpdateBoard(
  slug: string,
  input: UpdateBoardInput,
): Promise<{ board: BoardMeta }> {
  return boardsJson<{ board: BoardMeta }>(`/api/hermes-kanban/boards/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function fetchDeleteBoard(
  slug: string,
  hardDelete = false,
): Promise<{ result: Record<string, unknown>; current: string }> {
  const q = new URLSearchParams({ delete: hardDelete ? 'true' : 'false' })
  return boardsJson<{ result: Record<string, unknown>; current: string }>(
    `/api/hermes-kanban/boards/${encodeURIComponent(slug)}?${q.toString()}`,
    { method: 'DELETE' },
  )
}

export async function fetchSwitchBoard(slug: string): Promise<{ current: string }> {
  return boardsJson<{ current: string }>(
    `/api/hermes-kanban/boards/${encodeURIComponent(slug)}/switch`,
    { method: 'POST' },
  )
}

export function useBoards(includeArchived = false) {
  return useQuery({
    queryKey: boardsKeys.list(includeArchived),
    queryFn: () => fetchBoards(includeArchived),
  })
}

export function useCreateBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fetchCreateBoard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all })
    },
  })
}

export function useUpdateBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: UpdateBoardInput }) =>
      fetchUpdateBoard(slug, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all })
    },
  })
}

export function useDeleteBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, hardDelete }: { slug: string; hardDelete?: boolean }) =>
      fetchDeleteBoard(slug, hardDelete),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all })
    },
  })
}

export function useSwitchBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fetchSwitchBoard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['hermes-kanban'] })
    },
  })
}
