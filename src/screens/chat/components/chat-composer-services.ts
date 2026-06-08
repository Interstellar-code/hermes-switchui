import type {
  ActivateProfileResponse,
  ModelInfoApiResponse,
  ProfileSummary,
  ProfilesListResponse,
  ThinkingLevel,
  WorkspaceDetectionResponse,
} from './chat-composer-types'
import type { ModelSwitchResponse } from '@/lib/model-types'
import { setLocalModelOverride } from '@/screens/chat/local-model-override'

type GatewayStatusApiResponse = {
  mode?: string
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

export async function activateProfile(
  name: string,
): Promise<ActivateProfileResponse> {
  const response = await fetch('/api/profiles/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as ActivateProfileResponse
}

export async function fetchWorkspaceContext(): Promise<WorkspaceDetectionResponse> {
  const response = await fetch('/api/workspace')
  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }
  return (await response.json()) as WorkspaceDetectionResponse
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
