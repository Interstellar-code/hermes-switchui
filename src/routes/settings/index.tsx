import { createFileRoute } from '@tanstack/react-router'
import { SettingsScreen } from '@/screens/settings/settings-screen'

export const Route = createFileRoute('/settings/')({
  ssr: false,
  component: SettingsScreen,
})
