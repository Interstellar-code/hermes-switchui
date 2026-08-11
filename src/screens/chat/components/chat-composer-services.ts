import type {
  ModelInfoApiResponse,
  ProfileSummary,
  ProfilesListResponse,
  ScopeStatusResponse,
  ThinkingLevel,
  WorkspaceDetectionResponse,
} from './chat-composer-types'
import type { ModelSwitchResponse } from '@/lib/model-types'
import { useSessionModelStore } from '@/stores/session-model-store'

type GatewayStatusApiResponse = {
  mode?: string
  scope?: ScopeStatusResponse
}

/**
 * Dispatched by `/model` (bare, no argument) to open the model picker in
 * the meta bar. Listened for by `SessionSelectorsV2` — unlike
 * `CHAT_OPEN_SETTINGS_EVENT`, which has no listener anywhere in the app
 * (see chat-composer-services.ts `switchModel` doc comment and
 * use-slash-commands.ts).
 */
export const CHAT_OPEN_MODEL_PICKER_EVENT = 'claude:chat-open-model-picker'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>
    if (typeof payload.error === 'string') return payload.error
    if (typeof payload.message === 'string') return payload.message
    return JSON.stringify(payload)
  } catch {
    const text = await response.text().catch(() => '')
    return text || response.statusText || 'Request failed'
  }
}

export function nextThinkingLevel(level: ThinkingLevel): ThinkingLevel {
  if (level === 'off') return 'low'
  if (level === 'low') return 'medium'
  if (level === 'medium') return 'high'
  return 'off'
}

export function getResolvedModelKey(model: string, provider?: string): string {
  const normalizedModel = model.trim()
  const normalizedProvider = typeof provider === 'string' ? provider.trim() : ''

  if (!normalizedModel) return ''
  if (!normalizedProvider) return normalizedModel
  if (normalizedModel.startsWith(`${normalizedProvider}/`)) {
    return normalizedModel
  }
  return `${normalizedProvider}/${normalizedModel}`
}

/**
 * Switch the model for one chat session.
 *
 * This is purely client-local — there is no gateway endpoint for a genuine
 * per-session model switch. Two candidates were checked against the running
 * hermes-agent gateway (`gateway/platforms/api_server.py`, port 8642) before
 * settling on this:
 *
 *  - `POST /api/model-switch` (formerly called from src/lib/gateway-api.ts):
 *    404s. It's not in `_http_route_table()`; nothing on the gateway ever
 *    implemented it.
 *  - `PATCH /api/claude-proxy/api/config` (this function's old body): also
 *    404s through the proxy. `/api/config` only exists on a *different*
 *    process — `hermes_cli/web_server.py` (the `hermes dashboard` command) —
 *    not on the agent gateway `CLAUDE_API` points at. Even if it had
 *    resolved, it would have PATCHed `model.default` globally, retargeting
 *    every session/channel the gateway serves, with no profile scoping
 *    (PROFILE_HEADER is never sent) — the opposite of "this session only".
 *
 * So instead of wiring up a fake network call, the per-session model lives
 * entirely in `useSessionModelStore` (browser-local, keyed by sessionKey)
 * and rides along as the `model` field in the chat-completion request body
 * on every send (see use-thinking-level.ts's `currentModel` and
 * routes/api/send-stream.ts). Local providers (ollama, atomic-chat, ...)
 * need no special-casing here: send-stream.ts already detects a local
 * provider purely from the `model` string it receives per-request, so
 * writing the pick into the same per-session store is sufficient — no
 * separate global override needed (the old `local-model-override.ts` module
 * was deleted; it was non-reactive and leaked across every session since it
 * was never keyed by sessionKey at all).
 */
export function switchModel(
  model: string,
  provider?: string,
  sessionKey?: string,
): ModelSwitchResponse {
  const modelId = model.trim()
  const modelProvider =
    typeof provider === 'string' && provider.trim()
      ? provider.trim()
      : modelId.includes('/')
        ? modelId.split('/')[0]
        : undefined

  if (sessionKey) {
    useSessionModelStore
      .getState()
      .setModel(sessionKey, getResolvedModelKey(modelId, modelProvider))
  }

  return {
    ok: true,
    resolved: {
      modelProvider: modelProvider || 'hermes-agent',
      model: modelId,
    },
  }
}

/**
 * Move a session's persisted model override from a temporary key to its
 * real one once a new chat resolves to an actual session id.
 *
 * A model picked before the first message is sent has nowhere to live but
 * the temporary key the composer was rendering under at the time (typically
 * the `'new'` sentinel — see chat-screen.tsx's `modelSessionKey`). Once the
 * gateway assigns a real session id, the store entry has to move with it or
 * the pick is silently dropped (#348 task 5) — and the stale `'new'` entry
 * has to be cleared or it leaks into the *next* new chat.
 *
 * Never overwrites an override already explicitly set on `newKey`.
 */
export function rekeySessionModel(
  staleKey: string | undefined,
  newKey: string,
): void {
  if (!staleKey || !newKey || staleKey === newKey) return
  const store = useSessionModelStore.getState()
  const staleModel = store.getModel(staleKey)
  if (!staleModel) return
  if (!store.getModel(newKey)) {
    store.setModel(newKey, staleModel)
  }
  store.clearModel(staleKey)
}

export async function fetchGatewayMode(): Promise<string | null> {
  const response = await fetch('/api/gateway-status')
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  const payload = (await response.json()) as GatewayStatusApiResponse
  return typeof payload.mode === 'string' ? payload.mode : null
}

export async function fetchModelInfo(): Promise<ModelInfoApiResponse | null> {
  const response = await fetch('/api/model/info')
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as ModelInfoApiResponse
}

export async function fetchProfiles(): Promise<ProfilesListResponse> {
  const response = await fetch('/api/profiles/list')
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as ProfilesListResponse
}

export async function fetchScopeStatus(): Promise<ScopeStatusResponse> {
  const response = await fetch('/api/gateway-status')
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  const payload = (await response.json()) as GatewayStatusApiResponse
  return (
    payload.scope ?? { mode: 'single', servedProfiles: null, sessionCounts: {} }
  )
}

/**
 * The FILES-BROWSER root. Despite the name this has never had any effect on
 * where the agent runs — see `fetchAgentCwd` for that. The two are surfaced
 * separately in the composer so they can't be conflated again.
 */
export async function fetchWorkspaceContext(): Promise<WorkspaceDetectionResponse> {
  const response = await fetch('/api/workspace')
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as WorkspaceDetectionResponse
}

// ─── agent working directory (/api/agent-cwd) ──────────────────────────────
//
// Mirrors `ResolvedCwd` in src/server/agent-cwd.ts. Structurally typed rather
// than imported so the composer never pulls a node: module into the bundle.

export type AgentCwdSource =
  | 'explicit-config'
  | 'home-sentinel'
  | 'container-default'
  | 'unknown'

export type ResolvedAgentCwd = {
  path: string | null
  source: AgentCwdSource
  backend: string
  profile: string
  warnings: Array<string>
}

export type AgentCwdStatusResponse = {
  ok?: boolean
  resolved: ResolvedAgentCwd
  activeProfile: string
  launch: {
    multiplex: boolean
    launchProfile: string | null
    reachable: boolean
  }
  configuredCwd: string
  hasTerminalBlock: boolean
  /** False when this profile's `terminal.cwd` would be ignored (multiplex). */
  editable: boolean
  suggestedCwd: string | null
  homeDir: string
}

export type AgentCwdWriteResponse = {
  ok: boolean
  dryRun: boolean
  profile: string
  written?: string
  before: ResolvedAgentCwd
  after: ResolvedAgentCwd
  needsGatewayRestart: boolean
}

/** Where the AGENT will actually run, and why. */
export async function fetchAgentCwd(): Promise<AgentCwdStatusResponse> {
  const response = await fetch('/api/agent-cwd')
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as AgentCwdStatusResponse
}

/**
 * Write `terminal.cwd` into the active profile, or preview the change.
 *
 * This is the only Switch UI control that changes where commands actually
 * execute, so callers MUST run `dryRun: true` first and show the user the
 * before → after directory before committing.
 */
export async function setAgentCwd(
  targetPath: string,
  options: { dryRun?: boolean } = {},
): Promise<AgentCwdWriteResponse> {
  const response = await fetch('/api/agent-cwd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: targetPath,
      dryRun: options.dryRun === true,
    }),
  })
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as AgentCwdWriteResponse
}

/** Short provenance label for the composer chip. */
export function agentCwdSourceLabel(source: AgentCwdSource): string {
  if (source === 'explicit-config') return 'from terminal.cwd'
  if (source === 'home-sentinel') return '$HOME fallback'
  if (source === 'container-default') return 'sandbox default'
  return 'undetermined'
}

/** Longer one-liner for the popover header. */
export function agentCwdSourceDetail(
  resolved: Pick<ResolvedAgentCwd, 'source' | 'backend' | 'profile'>,
): string {
  switch (resolved.source) {
    case 'explicit-config':
      return `terminal.cwd in the "${resolved.profile}" profile`
    case 'home-sentinel':
      return `terminal.cwd is unset or a sentinel, so the ${resolved.backend} backend falls back to $HOME`
    case 'container-default':
      return `no TERMINAL_CWD reaches the ${resolved.backend} sandbox, so its built-in default applies`
    default:
      return 'not determinable from config alone'
  }
}

export function shortPathLabel(pathValue: string): string {
  if (!pathValue) return 'Workspace'
  const parts = pathValue.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.at(-1) || pathValue
}

export function thinkingLabel(level: ThinkingLevel): string {
  if (level === 'off') return 'None'
  if (level === 'low') return 'Low'
  if (level === 'medium') return 'Medium'
  if (level === 'high') return 'High'
  return 'Adaptive'
}

export function profileMeta(profile: ProfileSummary): string {
  return [profile.model, profile.provider]
    .map((value) => readText(value))
    .filter(Boolean)
    .join(' · ')
}
