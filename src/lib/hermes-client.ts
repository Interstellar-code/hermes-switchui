/**
 * hermes-client.ts — Client-safe Hermes Dashboard API helpers.
 *
 * This module is intentionally free of any server-only imports (no
 * gateway-capabilities, no node:fs, no node:path).  It targets the
 * same-origin /api/dashboard-proxy/* route which the TanStack Start
 * server injects the dashboard bearer token into before forwarding.
 *
 * Settings sections and other React components MUST import from here,
 * not from @/server/hermes-api, to avoid bundling Node-only modules
 * into the browser chunk.
 */

// ── Proxy helper ──────────────────────────────────────────────────

function proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  const proxyPath = `/api/dashboard-proxy${path.startsWith('/') ? path : `/${path}`}`
  return fetch(proxyPath, init)
}

async function proxyGet<T>(path: string): Promise<T> {
  const res = await proxyFetch(path)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Hermes Dashboard API ${path}: ${res.status} ${body}`)
  }
  return res.json() as Promise<T>
}

async function proxySend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await proxyFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes Dashboard API ${method} ${path}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function proxyDelete(path: string): Promise<void> {
  const res = await proxyFetch(path, { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes Dashboard API DELETE ${path}: ${res.status} ${text}`)
  }
}

// ── Types (duplicated from hermes-api to stay server-free) ────────

export type ClaudeSession = {
  id: string
  source?: string
  user_id?: string | null
  model?: string | null
  title?: string | null
  started_at?: number
  ended_at?: number | null
  end_reason?: string | null
  message_count?: number
  tool_call_count?: number
  input_tokens?: number
  output_tokens?: number
  parent_session_id?: string | null
  last_active?: number | null
  preview?: string | null
}

export type ClaudeConfig = {
  model?: string
  provider?: string
  [key: string]: unknown
}

export type ModelInfo = {
  model: string
  provider: string
  [key: string]: unknown
}

export type ModelOptions = {
  providers: Array<{
    slug: string
    name?: string
    is_current?: boolean
    models: Array<string>
    total_models?: number
    [key: string]: unknown
  }>
  model: string
  provider: string
  [key: string]: unknown
}

export type ModelAuxiliary = {
  tasks: Array<{ task: string; provider: string; model: string; base_url?: string }>
  main: { provider: string; model: string }
  [key: string]: unknown
}

export type ConfigSchema = {
  fields: Record<string, unknown>
  category_order: Array<string>
  [key: string]: unknown
}

export type EnvVarInfo = {
  is_set: boolean
  redacted_value: string
  description?: string
  category?: string
  is_password?: boolean
  advanced?: boolean
  url?: string
}

export type OAuthProvider = {
  id: string
  name: string
  logged_in: boolean
  token_preview?: string
  expires_at?: string
  status?: string
}

export type AnalyticsUsage = {
  total_sessions?: number
  total_messages?: number
  total_input_tokens?: number
  total_output_tokens?: number
  total_tokens?: number
  total_calls?: number
  total_estimated_cost?: number
  sessions?: number
  days?: number
  by_day?: Array<{ date: string; sessions: number; messages: number; input_tokens: number; output_tokens: number }>
}

export type AnalyticsModelRow = {
  model: string
  provider?: string
  sessions?: number
  messages?: number
  input_tokens?: number
  output_tokens?: number
  [key: string]: unknown
}

export type AnalyticsModels = {
  models: Array<AnalyticsModelRow>
  days: number
  [key: string]: unknown
}

export type GatewayStatus = {
  status?: string
  version?: string
  uptime?: number
  gateway_running?: boolean
  pid?: number
  cpu?: number
  rss?: number
}

// ── Skills ────────────────────────────────────────────────────────

export async function listSkills(): Promise<unknown> {
  return proxyGet('/api/skills')
}

export async function getSkill(name: string): Promise<unknown> {
  return proxyGet(`/api/skills/${encodeURIComponent(name)}`)
}

export async function getSkillCategories(): Promise<unknown> {
  return proxyGet('/api/skills/categories')
}

export async function toggleSkill(name: string, enabled: boolean): Promise<unknown> {
  return proxySend('POST', '/api/skills/toggle', { name, enabled })
}

export async function listToolsets(): Promise<unknown> {
  return proxyGet('/api/tools/toolsets')
}

// ── Dashboard plugins ─────────────────────────────────────────────

export async function listDashboardPlugins(): Promise<unknown> {
  return proxyGet('/api/dashboard/plugins')
}

export async function installAgentPlugin(body: {
  identifier: string
  force?: boolean
  enable?: boolean
}): Promise<unknown> {
  return proxySend('POST', '/api/dashboard/agent-plugins/install', body)
}

export async function enableAgentPlugin(name: string): Promise<unknown> {
  return proxySend('POST', `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/enable`)
}

export async function disableAgentPlugin(name: string): Promise<unknown> {
  return proxySend('POST', `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/disable`)
}

export async function updateAgentPlugin(name: string): Promise<unknown> {
  return proxySend('POST', `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/update`)
}

export async function deleteAgentPlugin(name: string): Promise<void> {
  return proxyDelete(`/api/dashboard/agent-plugins/${encodeURIComponent(name)}`)
}

export async function setPluginVisibility(name: string, hidden: boolean): Promise<unknown> {
  return proxySend('POST', `/api/dashboard/plugins/${encodeURIComponent(name)}/visibility`, { hidden })
}

// ── Config ───────────────────────────────────────────────────────

export async function getConfig(): Promise<ClaudeConfig> {
  return proxyGet<ClaudeConfig>('/api/config')
}

export async function patchConfig(
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return proxySend<Record<string, unknown>>('PATCH', '/api/config', patch)
}

export async function getConfigSchema(): Promise<ConfigSchema> {
  return proxyGet<ConfigSchema>('/api/config/schema')
}

export async function getConfigRaw(): Promise<{ yaml: string }> {
  return proxyGet<{ yaml: string }>('/api/config/raw')
}

export async function putConfigRaw(yamlText: string): Promise<{ yaml: string }> {
  return proxySend<{ yaml: string }>('PUT', '/api/config/raw', { yaml: yamlText })
}

// ── Model / Provider APIs ────────────────────────────────────────

export async function modelInfo(): Promise<ModelInfo> {
  return proxyGet<ModelInfo>('/api/model/info')
}

export async function modelOptions(): Promise<ModelOptions> {
  return proxyGet<ModelOptions>('/api/model/options')
}

export async function modelAuxiliary(): Promise<ModelAuxiliary> {
  return proxyGet<ModelAuxiliary>('/api/model/auxiliary')
}

export async function setModelAssignment(body: {
  scope: 'main' | string
  provider: string
  model: string
  task?: string
}): Promise<Record<string, unknown>> {
  return proxySend<Record<string, unknown>>('POST', '/api/model/set', body)
}

// ── Env vars ─────────────────────────────────────────────────────

export async function getEnv(): Promise<Record<string, EnvVarInfo>> {
  return proxyGet('/api/env')
}

export async function putEnv(key: string, value: string): Promise<void> {
  const res = await proxyFetch('/api/env', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes Dashboard API PUT /api/env: ${res.status} ${text}`)
  }
}

export async function deleteEnv(key: string): Promise<void> {
  const res = await proxyFetch('/api/env', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes Dashboard API DELETE /api/env: ${res.status} ${text}`)
  }
}

export async function revealEnv(key: string): Promise<{ key: string; value: string }> {
  const res = await proxyFetch('/api/env/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (res.status === 429) {
    throw new Error('Rate limited. Please wait before revealing again.')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes Dashboard API POST /api/env/reveal: ${res.status} ${text}`)
  }
  return res.json() as Promise<{ key: string; value: string }>
}

// ── OAuth providers ───────────────────────────────────────────────

export async function listOAuthProviders(): Promise<Array<OAuthProvider>> {
  const res = await proxyGet<{ providers?: Array<OAuthProvider> } | Array<OAuthProvider>>('/api/providers/oauth')
  if (Array.isArray(res)) return res
  return res.providers ?? []
}

export async function deleteOAuth(providerId: string): Promise<void> {
  return proxyDelete(`/api/providers/oauth/${providerId}`)
}

// ── Analytics ─────────────────────────────────────────────────────

export async function analyticsUsage(days = 30): Promise<AnalyticsUsage> {
  return proxyGet(`/api/analytics/usage?days=${days}`)
}

export async function analyticsModels(days = 30): Promise<AnalyticsModels> {
  return proxyGet(`/api/analytics/models?days=${days}`)
}

// ── Gateway status / ops ──────────────────────────────────────────

export async function gatewayStatus(): Promise<GatewayStatus> {
  return proxyGet('/api/status')
}

export async function gatewayRestart(): Promise<unknown> {
  return proxySend('POST', '/api/gateway/restart')
}

export async function getLogs(params?: { lines?: number; file?: string; level?: string; component?: string }): Promise<unknown> {
  const search = new URLSearchParams()
  if (params?.lines) search.set('lines', String(params.lines))
  if (params?.file) search.set('file', params.file)
  if (params?.level) search.set('level', params.level)
  if (params?.component) search.set('component', params.component)
  const suffix = search.toString()
  const res = await fetch(`/api/logs${suffix ? `?${suffix}` : ''}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Hermes Logs API /api/logs: ${res.status} ${body}`)
  }
  return res.json() as Promise<unknown>
}
