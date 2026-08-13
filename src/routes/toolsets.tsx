import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { ToolsetsScreen } from '@/screens/toolsets/toolsets-screen'

export const Route = createFileRoute('/toolsets')({
  ssr: false,
  component: function ToolsetsRoute() {
    usePageTitle('Toolsets')
    return <ToolsetsScreen />
  },
})
