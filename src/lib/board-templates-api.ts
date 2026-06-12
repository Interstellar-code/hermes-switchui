import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  InstantiateInput,
  InstantiateResult,
  KanbanTemplate,
  KanbanTemplateSummary,
  SaveAsTemplateInput,
} from './hermes-kanban-types'

/**
 * TanStack Query hooks for Kanban Board Templates.
 *
 * Mirrors `boards-api.ts`: client-side `fetch` against the BFF proxy routes at
 * `/api/hermes-kanban/templates*`. All errors surface the backend `detail`/`error`
 * string (user-safe by contract). A single stable query key is invalidated on
 * every mutation.
 */

/** Thrown by templatesJson so callers can branch on backend status (e.g. 404 degraded state). */
export class TemplateRequestError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'TemplateRequestError'
    this.status = status
  }
}

async function templatesJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
    throw new TemplateRequestError(
      body.detail ?? body.error ?? `Request failed: ${res.status}`,
      res.status,
    )
  }
  return res.json() as Promise<T>
}

export const templatesKeys = {
  all: ['hermes-kanban', 'templates'] as const,
  list: () => ['hermes-kanban', 'templates', 'list'] as const,
  detail: (slug: string) => ['hermes-kanban', 'templates', 'detail', slug] as const,
}

export async function fetchTemplates(): Promise<{ templates: Array<KanbanTemplateSummary> }> {
  return templatesJson<{ templates: Array<KanbanTemplateSummary> }>('/api/hermes-kanban/templates')
}

export async function fetchTemplate(slug: string): Promise<KanbanTemplate> {
  return templatesJson<KanbanTemplate>(
    `/api/hermes-kanban/templates/${encodeURIComponent(slug)}`,
  )
}

export async function fetchSaveTemplate(
  yaml: string,
  slug?: string,
): Promise<{ template: KanbanTemplate }> {
  return templatesJson<{ template: KanbanTemplate }>('/api/hermes-kanban/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slug ? { yaml, slug } : { yaml }),
  })
}

export async function fetchUpdateTemplate(
  slug: string,
  yaml: string,
): Promise<{ template: KanbanTemplate }> {
  return templatesJson<{ template: KanbanTemplate }>(
    `/api/hermes-kanban/templates/${encodeURIComponent(slug)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml }),
    },
  )
}

export async function fetchDeleteTemplate(slug: string): Promise<{ ok: boolean }> {
  return templatesJson<{ ok: boolean }>(
    `/api/hermes-kanban/templates/${encodeURIComponent(slug)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export async function fetchInstantiateTemplate(
  slug: string,
  input: InstantiateInput,
): Promise<InstantiateResult> {
  return templatesJson<InstantiateResult>(
    `/api/hermes-kanban/templates/${encodeURIComponent(slug)}/instantiate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function fetchSaveBoardAsTemplate(
  boardSlug: string,
  input: SaveAsTemplateInput,
): Promise<{ ok: boolean; template: KanbanTemplate }> {
  return templatesJson<{ ok: boolean; template: KanbanTemplate }>(
    `/api/hermes-kanban/boards/${encodeURIComponent(boardSlug)}/save-as-template`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: templatesKeys.list(),
    queryFn: fetchTemplates,
    enabled,
    retry: false,
  })
}

export function useTemplate(slug: string | null, enabled = true) {
  return useQuery({
    queryKey: templatesKeys.detail(slug ?? ''),
    queryFn: () => fetchTemplate(slug as string),
    enabled: enabled && !!slug,
  })
}

export function useSaveTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ yaml, slug }: { yaml: string; slug?: string }) =>
      fetchSaveTemplate(yaml, slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templatesKeys.all })
    },
  })
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, yaml }: { slug: string; yaml: string }) =>
      fetchUpdateTemplate(slug, yaml),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templatesKeys.all })
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => fetchDeleteTemplate(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templatesKeys.all })
    },
  })
}

export function useInstantiateTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: InstantiateInput }) =>
      fetchInstantiateTemplate(slug, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templatesKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'boards'] })
    },
  })
}

export function useSaveBoardAsTemplate(boardSlug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveAsTemplateInput) => fetchSaveBoardAsTemplate(boardSlug, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templatesKeys.all })
    },
  })
}
