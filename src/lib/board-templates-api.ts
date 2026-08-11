import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  InstantiateInput,
  InstantiateResult,
  KanbanTemplate,
  KanbanTemplateSummary,
  SaveAsTemplateInput,
} from './hermes-kanban-types'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import { scopeSegments } from '@/lib/session-scope'

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

/**
 * Default client-side request timeout. Without it a wedged/slow gateway leaves
 * the page spinning indefinitely (the BFF route can stall behind the dashboard
 * token scrape). 20s comfortably exceeds the server-side 12s kanbanFetch cap so
 * the real backend error surfaces first; a true hang aborts here instead.
 */
const TEMPLATES_FETCH_TIMEOUT_MS = 20_000

async function templatesJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(TEMPLATES_FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError; surface it as a clean 504.
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new TemplateRequestError(
        'Request timed out — the Hermes Agent dashboard is slow or unavailable.',
        504,
      )
    }
    throw new TemplateRequestError('Network error reaching the Hermes Agent dashboard.', 0)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
    throw new TemplateRequestError(
      body.detail ?? body.error ?? `Request failed: ${res.status}`,
      res.status,
    )
  }
  return res.json() as Promise<T>
}

/**
 * Template query keys. `list`/`detail` are profile-keyed the same way as
 * `boardsKeys.list` in `boards-api.ts`: `/api/hermes-kanban/templates*` has
 * no `?profile=` support, so this is a client-cache-only mitigation — a
 * profile switch re-keys the cache instead of serving another profile's
 * templates from memory. `scopeSegments` is `[]` when unscoped, so
 * single-profile / pre-selector behaviour is byte-identical to before.
 *
 * `all` stays unscoped on purpose — it is only an `invalidateQueries`
 * prefix, and an unscoped, shorter prefix still matches every profile's
 * `list`/`detail` keys (the profile segment is appended after `'list'` /
 * `'detail', slug`, not right after `'templates'`). Invalidating every
 * profile's cached templates on a mutation is the safe direction.
 */
export const templatesKeys = {
  all: ['hermes-kanban', 'templates'] as const,
  list: (profile: string | null) =>
    ['hermes-kanban', 'templates', 'list', ...scopeSegments(profile)] as const,
  detail: (slug: string, profile: string | null) =>
    ['hermes-kanban', 'templates', 'detail', slug, ...scopeSegments(profile)] as const,
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
  const profile = useResolvedProfile()
  return useQuery({
    queryKey: templatesKeys.list(profile),
    queryFn: fetchTemplates,
    enabled,
    retry: false,
    // Serve cached templates instantly on revisit; no spinner for ~30s.
    staleTime: 30_000,
  })
}

export function useTemplate(slug: string | null, enabled = true) {
  const profile = useResolvedProfile()
  return useQuery({
    queryKey: templatesKeys.detail(slug ?? '', profile),
    queryFn: () => fetchTemplate(slug as string),
    enabled: enabled && !!slug,
  })
}

/**
 * Per-template task counts. The list endpoint omits tasks, so fetch each
 * template's detail (shares the useTemplate cache via templatesKeys.detail).
 * Pass only the visible/paginated slugs to bound the request fan-out.
 */
export function useTemplateTaskCounts(slugs: Array<string>): Record<string, number | undefined> {
  const profile = useResolvedProfile()
  const results = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: templatesKeys.detail(slug, profile),
      queryFn: () => fetchTemplate(slug),
      staleTime: 60_000,
      retry: false,
      select: (t: KanbanTemplate) => t.tasks.length,
    })),
  })
  const counts: Record<string, number | undefined> = {}
  slugs.forEach((slug, i) => {
    counts[slug] = results[i]?.data
  })
  return counts
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
