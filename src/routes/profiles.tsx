import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { ProfilesScreen } from '@/screens/profiles/profiles-screen'
import { profilesSearchSchema } from '@/stores/profiles-screen-store'

/**
 * `/profiles` carries its filter state in the URL (G-07): `?q=`, `?tier=`,
 * `?status=`, `?model=`, `?tag=`, `?page=`, plus the wizard deep link
 * `?edit=<name>[&step=1..9]`. Defaults are never written, so the bare
 * `/profiles` stays bare — see `filtersToSearch` in the store module, which
 * owns the encode/decode and is unit-tested there.
 *
 * View mode and page size are NOT here on purpose: they are device
 * preferences and stay in localStorage.
 */
export const Route = createFileRoute('/profiles')({
  ssr: false,
  validateSearch: profilesSearchSchema,
  component: ProfilesRoute,
})

function ProfilesRoute() {
  usePageTitle('Agents')

  return <ProfilesScreen />
}
