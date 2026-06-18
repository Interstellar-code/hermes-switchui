import type { SkillStatusEntry } from '@/lib/skills/types'

type GithubImmersiveScreenProps = {
  agentName: string | null
  githubSkill: SkillStatusEntry | null
  onOpenSetup?: () => void
}

export function GithubImmersiveScreen(_props: GithubImmersiveScreenProps) {
  return null
}
