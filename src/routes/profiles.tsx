import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { ProfilesScreen } from '@/screens/profiles/profiles-screen'

export const Route = createFileRoute('/profiles')({
  ssr: false,
  component: ProfilesRoute,
})

function ProfilesRoute() {
  usePageTitle('Agents')

  return <ProfilesScreen />
}
