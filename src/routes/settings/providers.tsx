import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { ProvidersScreen } from '@/screens/providers/providers-screen'

export const Route = createFileRoute('/settings/providers')({
  ssr: false,
  component: function SettingsProvidersRoute() {
    usePageTitle('Providers')
    return <ProvidersScreen />
  },
})
