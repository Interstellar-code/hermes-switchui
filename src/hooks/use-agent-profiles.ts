import { useProfilesList } from './use-profiles-list'

export function useAgentProfiles(): {
  profiles: Array<string>
  activeProfile: string
  isLoading: boolean
} {
  const query = useProfilesList()

  const rawProfiles = query.data?.profiles ?? []
  const profiles = rawProfiles.map((p) => p.name)
  const activeProfile =
    query.data?.activeProfile ?? (profiles.length > 0 ? profiles[0] : '')

  return { profiles, activeProfile, isLoading: query.isLoading }
}
