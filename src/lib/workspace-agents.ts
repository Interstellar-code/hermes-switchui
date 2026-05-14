import { BUILTIN_AGENTS } from '@/lib/builtin-agents'
import { workspaceRequestJson } from '@/lib/workspace-checkpoints'

export type WorkspaceAgentDirectory = {
  id: string
  name: string
  role: string
  adapter_type: string
  model: string | null
  provider: string
  status: 'online' | 'away' | 'offline'
  avatar: string
  avatar_tone: 'accent' | 'green' | 'yellow' | 'primary'
  description: string
  system_prompt: string
  prompt_updated_at: string
  limits: {
    max_tokens: number
    cost_label: string
    concurrency_limit: number
    memory_scope: string
  }
  capabilities: {
    repo_write: boolean
    shell_commands: boolean
    git_operations: boolean
    browser: boolean
    network: boolean
  }
  assigned_projects: Array<string>
  skills: Array<string>
}

export type WorkspaceAgentStats = {
  agent_id: string
  runs_today: number
  tokens_today: number
  cost_cents_today: number
  success_rate: number
  avg_response_ms: number | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function asStringArray(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : []
}

function normalizeAgent(value: unknown): WorkspaceAgentDirectory | null {
  const record = asRecord(value)
  const limits = asRecord(record?.limits)
  const capabilities = asRecord(record?.capabilities)
  const status = asString(record?.status)
  const avatarTone = asString(record?.avatar_tone)

  const id = asString(record?.id)
  const name = asString(record?.name)
  const role = asString(record?.role)
  const adapterType = asString(record?.adapter_type)

  if (!id || !name || !role || !adapterType) return null

  return {
    id,
    name,
    role,
    adapter_type: adapterType,
    model: asString(record?.model),
    provider: asString(record?.provider) ?? 'Unknown',
    status:
      status === 'online' || status === 'away' || status === 'offline'
        ? status
        : 'offline',
    avatar: asString(record?.avatar) ?? '🤖',
    avatar_tone:
      avatarTone === 'accent' ||
      avatarTone === 'green' ||
      avatarTone === 'yellow' ||
      avatarTone === 'primary'
        ? avatarTone
        : 'primary',
    description: asString(record?.description) ?? '',
    system_prompt: asString(record?.system_prompt) ?? '',
    prompt_updated_at:
      asString(record?.prompt_updated_at) ?? new Date().toISOString(),
    limits: {
      max_tokens: asNumber(limits?.max_tokens),
      cost_label: asString(limits?.cost_label) ?? 'Unknown',
      concurrency_limit: asNumber(limits?.concurrency_limit),
      memory_scope: asString(limits?.memory_scope) ?? 'Unknown',
    },
    capabilities: {
      repo_write: asBoolean(capabilities?.repo_write),
      shell_commands: asBoolean(capabilities?.shell_commands),
      git_operations: asBoolean(capabilities?.git_operations),
      browser: asBoolean(capabilities?.browser),
      network: asBoolean(capabilities?.network),
    },
    assigned_projects: asStringArray(record?.assigned_projects),
    skills: asStringArray(record?.skills),
  }
}

export function extractWorkspaceAgents(
  payload: unknown,
): Array<WorkspaceAgentDirectory> {
  if (Array.isArray(payload)) {
    return payload
      .map(normalizeAgent)
      .filter((value): value is WorkspaceAgentDirectory => Boolean(value))
  }

  const record = asRecord(payload)
  const candidates = [record?.agents, record?.data, record?.items]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(normalizeAgent)
        .filter((value): value is WorkspaceAgentDirectory => Boolean(value))
    }
  }
  return []
}

const BUILTIN_AGENT_BY_ID = new Map(
  BUILTIN_AGENTS.map((agent) => [agent.id, agent]),
)

type CrewStatusMember = {
  id: string
  displayName: string
  role: string
  profileFound: boolean
  gatewayState: string
  processAlive: boolean
  model: string
  provider: string
  lastSessionTitle: string | null
  lastSessionAt: number | null
  sessionCount: number
  totalTokens: number
  cronJobCount: number
  assignedTaskCount: number
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(
      value < 1_000_000_000_000 ? value * 1000 : value,
    ).toISOString()
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return new Date(0).toISOString()
}

function normalizeCrewMember(value: unknown): CrewStatusMember | null {
  const record = asRecord(value)
  const id = asString(record?.id)
  const displayName = asString(record?.displayName)
  if (!id || !displayName) return null

  return {
    id,
    displayName,
    role: asString(record?.role) ?? 'Profile',
    profileFound: asBoolean(record?.profileFound),
    gatewayState: asString(record?.gatewayState) ?? 'unknown',
    processAlive: asBoolean(record?.processAlive),
    model: asString(record?.model) ?? 'unknown',
    provider: asString(record?.provider) ?? 'Hermes',
    lastSessionTitle: asString(record?.lastSessionTitle),
    lastSessionAt:
      typeof record?.lastSessionAt === 'number' ? record.lastSessionAt : null,
    sessionCount: asNumber(record?.sessionCount),
    totalTokens: asNumber(record?.totalTokens),
    cronJobCount: asNumber(record?.cronJobCount),
    assignedTaskCount: asNumber(record?.assignedTaskCount),
  }
}

function crewStatusToWorkspaceStatus(
  member: CrewStatusMember,
): WorkspaceAgentDirectory['status'] {
  if (!member.profileFound) return 'offline'
  if (
    member.processAlive ||
    member.gatewayState === 'running' ||
    member.assignedTaskCount > 0
  ) {
    return 'online'
  }
  return 'away'
}

function crewMemberToWorkspaceAgent(
  member: CrewStatusMember,
): WorkspaceAgentDirectory {
  const builtin = BUILTIN_AGENT_BY_ID.get(member.id)
  const role = builtin?.role ?? member.role
  const description =
    member.lastSessionTitle ??
    builtin?.description ??
    `${member.displayName} Hermes profile`

  return {
    id: member.id,
    name: member.displayName,
    role,
    adapter_type: 'local',
    model: member.model === 'unknown' ? null : member.model,
    provider: member.provider === 'unknown' ? 'Hermes' : member.provider,
    status: crewStatusToWorkspaceStatus(member),
    avatar: builtin?.glyph ?? member.displayName.slice(0, 2).toUpperCase(),
    avatar_tone:
      member.id === 'workspace'
        ? 'accent'
        : member.id === 'neo'
          ? 'green'
          : member.id === 'trinity'
            ? 'yellow'
            : 'primary',
    description,
    system_prompt: description,
    prompt_updated_at: normalizeTimestamp(member.lastSessionAt),
    limits: {
      max_tokens: 0,
      cost_label: 'local',
      concurrency_limit: member.id === 'workspace' ? 4 : 1,
      memory_scope: member.id === 'workspace' ? 'workspace' : 'agent',
    },
    capabilities: {
      repo_write: member.id !== 'morpheus',
      shell_commands: true,
      git_operations: member.id === 'workspace' || member.id === 'neo',
      browser: member.id === 'trinity',
      network: true,
    },
    assigned_projects: [],
    skills: builtin?.tags ?? [],
  }
}

function extractCrewAgents(payload: unknown): Array<WorkspaceAgentDirectory> {
  const record = asRecord(payload)
  if (!Array.isArray(record?.crew)) return []
  return record.crew
    .map(normalizeCrewMember)
    .filter((member): member is CrewStatusMember => Boolean(member))
    .map(crewMemberToWorkspaceAgent)
}

export function normalizeWorkspaceAgentStats(
  payload: unknown,
): WorkspaceAgentStats {
  const record = asRecord(payload)
  const stats = asRecord(record?.stats) ?? record
  return {
    agent_id: asString(stats?.agent_id) ?? '',
    runs_today: asNumber(stats?.runs_today),
    tokens_today: asNumber(stats?.tokens_today),
    cost_cents_today: asNumber(stats?.cost_cents_today),
    success_rate: asNumber(stats?.success_rate),
    avg_response_ms:
      typeof stats?.avg_response_ms === 'number' &&
      Number.isFinite(stats.avg_response_ms)
        ? stats.avg_response_ms
        : null,
  }
}

export async function listWorkspaceAgents(): Promise<
  Array<WorkspaceAgentDirectory>
> {
  const crewPayload = await workspaceRequestJson('/api/crew-status')
  const crewAgents = extractCrewAgents(crewPayload)
  if (crewAgents.length > 0) return crewAgents

  const payload = await workspaceRequestJson('/api/workspace/agents')
  return extractWorkspaceAgents(payload)
}

export async function getWorkspaceAgentStats(
  agentId: string,
): Promise<WorkspaceAgentStats> {
  const payload = await workspaceRequestJson(
    `/api/workspace/agents?stats_for=${encodeURIComponent(agentId)}`,
  )
  return normalizeWorkspaceAgentStats(payload)
}
