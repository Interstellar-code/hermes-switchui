/**
 * Server-only client for the Hermes Agent Dashboard Kanban plugin.
 *
 * All HTTP calls use dashboardFetch() from gateway-capabilities.ts — never
 * import this module in client-side code. dashboardFetch handles auth token
 * acquisition, 401 retry, and shared token cache; do not create parallel
 * fetch wrappers.
 */
import { dashboardFetch } from './gateway-capabilities'
import type {
  HermesKanbanBoard,
  HermesKanbanTask,
  HermesKanbanTaskDetail,
  CreateKanbanTaskInput,
  UpdateKanbanTaskInput,
  BulkKanbanInput,
} from '../lib/hermes-kanban-types'

const BASE = '/api/plugins/kanban'

async function kanbanFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await dashboardFetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(5_000),
  })
  if (!res.ok) {
    let detail = `Kanban API error ${res.status}`
    try {
      const body = (await res.json()) as { detail?: string; error?: string }
      detail = body.detail ?? body.error ?? detail
    } catch {
      // ignore parse failure
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export async function getKanbanBoard(params?: {
  tenant?: string
  includeArchived?: boolean
}): Promise<HermesKanbanBoard> {
  const q = new URLSearchParams()
  if (params?.tenant) q.set('tenant', params.tenant)
  if (params?.includeArchived) q.set('include_archived', 'true')
  const qs = q.toString()
  return kanbanFetch<HermesKanbanBoard>(`${BASE}/board${qs ? `?${qs}` : ''}`, {})
}

export async function getKanbanTask(taskId: string): Promise<HermesKanbanTaskDetail> {
  return kanbanFetch<HermesKanbanTaskDetail>(`${BASE}/tasks/${taskId}`, {})
}

export async function createKanbanTask(
  input: CreateKanbanTaskInput,
): Promise<{ task: HermesKanbanTask; warning?: string }> {
  return kanbanFetch<{ task: HermesKanbanTask; warning?: string }>(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updateKanbanTask(
  taskId: string,
  input: UpdateKanbanTaskInput,
): Promise<{ task: HermesKanbanTask }> {
  return kanbanFetch<{ task: HermesKanbanTask }>(`${BASE}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Permanently hard-delete a task. Only valid for archived tasks. */
export async function deleteKanbanTask(taskId: string): Promise<{ ok: boolean }> {
  return kanbanFetch<{ ok: boolean }>(`${BASE}/tasks/${taskId}`, {
    method: 'DELETE',
  })
}

export async function addKanbanComment(
  taskId: string,
  input: { body: string; author?: string },
): Promise<{ ok: true }> {
  return kanbanFetch<{ ok: true }>(`${BASE}/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function addKanbanLink(
  parentId: string,
  childId: string,
): Promise<{ ok: true }> {
  return kanbanFetch<{ ok: true }>(`${BASE}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id: parentId, child_id: childId }),
  })
}

export async function deleteKanbanLink(
  parentId: string,
  childId: string,
): Promise<{ ok: boolean }> {
  const q = new URLSearchParams({ parent_id: parentId, child_id: childId })
  return kanbanFetch<{ ok: boolean }>(`${BASE}/links?${q}`, { method: 'DELETE' })
}

export async function bulkUpdateKanbanTasks(
  input: BulkKanbanInput,
): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }> }> {
  return kanbanFetch<{ results: Array<{ id: string; ok: boolean; error?: string }> }>(
    `${BASE}/tasks/bulk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function getKanbanStats(): Promise<unknown> {
  return kanbanFetch<unknown>(`${BASE}/stats`, {})
}

export async function getKanbanAssignees(): Promise<{ assignees: unknown[] }> {
  return kanbanFetch<{ assignees: unknown[] }>(`${BASE}/assignees`, {})
}

export async function getKanbanTaskLog(
  taskId: string,
  tail?: number,
): Promise<unknown> {
  const q = tail !== undefined ? `?tail=${tail}` : ''
  return kanbanFetch<unknown>(`${BASE}/tasks/${taskId}/log${q}`, {
    signal: AbortSignal.timeout(15_000),
  })
}

export async function dispatchKanban(
  max?: number,
  dryRun?: boolean,
): Promise<unknown> {
  const q = new URLSearchParams()
  if (max !== undefined) q.set('max', String(max))
  if (dryRun) q.set('dry_run', 'true')
  const qs = q.toString()
  return kanbanFetch<unknown>(`${BASE}/dispatch${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  })
}

export async function getKanbanConfig(): Promise<unknown> {
  return kanbanFetch<unknown>(`${BASE}/config`, {})
}

export async function getKanbanHomeChannels(taskId?: string): Promise<unknown> {
  const q = taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''
  return kanbanFetch<unknown>(`${BASE}/home-channels${q}`, {})
}

export async function subscribeKanbanHomeChannel(
  taskId: string,
  platform: string,
): Promise<unknown> {
  return kanbanFetch<unknown>(`${BASE}/tasks/${taskId}/home-subscribe/${platform}`, {
    method: 'POST',
  })
}

export async function unsubscribeKanbanHomeChannel(
  taskId: string,
  platform: string,
): Promise<unknown> {
  return kanbanFetch<unknown>(`${BASE}/tasks/${taskId}/home-subscribe/${platform}`, {
    method: 'DELETE',
  })
}
