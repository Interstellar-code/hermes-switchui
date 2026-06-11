import { useQuery } from '@tanstack/react-query'

type ProfilesListResponse = {
  profiles: Array<{ name: string }>
  activeProfile?: string
}

export function useAgentProfiles(): {
  profiles: Array<string>
  activeProfile: string
  isLoading: boolean
} {
  const query = useQuery<ProfilesListResponse>({
    queryKey: ['profiles', 'list'],
    queryFn: () => fetch('/api/profiles/list').then((r) => r.json()) as Promise<ProfilesListResponse>,
    staleTime: 30_000,
  })

  const rawProfiles = Array.isArray(query.data?.profiles) ? query.data.profiles : []
  const profiles = rawProfiles.map((p) => p.name)
  const activeProfile = query.data?.activeProfile ?? (profiles.length > 0 ? profiles[0] : '')

  return { profiles, activeProfile, isLoading: query.isLoading }
}
