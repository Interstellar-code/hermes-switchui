import type { AgentAvatarProfile } from '@/lib/avatars/profile'

export type AgentState = {
  agentId: string
  name: string
  role?: string | null
  status?: string
  runId?: string | null
  avatarProfile?: AgentAvatarProfile | null
}
