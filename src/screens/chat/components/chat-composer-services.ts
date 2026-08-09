import type {
  ModelInfoApiResponse,
  ProfileSummary,
  ProfilesListResponse,
  ScopeStatusResponse,
  ThinkingLevel,
  WorkspaceDetectionResponse,
} from './chat-composer-types'
import type { ModelSwitchResponse } from '@/lib/model-types'
import { setLocalModelOverride } from '@/screens/chat/local-model-override'

type GatewayStatusApiResponse = {
  mode?: string
  scope?: ScopeStatusResponse
}

const LOCAL_PROVIDERS_SET = new Set(['ollama', 'atomic-chat'])

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

export async function switchModel(
  model: string,
  provider?: string,
  _sessionKey?: string,
): Promise<ModelSwitchResponse> {
  const modelId = model.trim()
  const modelProvider =
    typeof provider === 'string' && provider.trim()
      ? provider.trim()
      : modelId.includes('/')
        ? modelId.split('/')[0]
        : undefined

  if (modelProvider && LOCAL_PROVIDERS_SET.has(modelProvider)) {
    setLocalModelOverride(`${modelProvider}/${modelId}`)
    return {
      ok: true,
      resolved: {
        modelProvider,
        model: modelId,
      },
    }
  }

  setLocalModelOverride('')

  const patch: Record<string, string> = { model: modelId }
  if (modelProvider) patch.provider = modelProvider

  const response = await fetch('/api/claude-proxy/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  return {
    ok: true,
    resolved: {
      modelProvider: modelProvider || 'hermes-agent',
      model: modelId,
    },
  }
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
