import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { CommandsScreen } from '@/screens/commands/commands-screen'

export const Route = createFileRoute('/commands')({
  ssr: false,
  component: function CommandsRoute() {
    usePageTitle('Commands')
    return <CommandsScreen />
  },
})
