import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { WorkflowsScreen } from '@/screens/workflows/workflows-screen'

export const Route = createFileRoute('/workflows')({
  ssr: false,
  component: function WorkflowsRoute() {
    usePageTitle('Workflows')
    return <WorkflowsScreen />
  },
})
