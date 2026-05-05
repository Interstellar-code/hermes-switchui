import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { usePageTitle } from '@/hooks/use-page-title'
import { TasksScreen } from '@/screens/tasks/tasks-screen'
import { useIsFeatureAvailable } from '@/hooks/use-gateway-caps'
import { BackendUnavailableState } from '@/components/backend-unavailable-state'

const searchSchema = z.object({
  assignee: z.string().optional(),
})

export const Route = createFileRoute('/tasks')({
  ssr: false,
  validateSearch: searchSchema,
  component: TasksRoute,
})

function TasksRoute() {
  usePageTitle('Tasks')
  const kanbanAvailable = useIsFeatureAvailable('kanban')

  // null = still probing; show skeleton, not error
  if (kanbanAvailable === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--theme-hover)]" />
      </div>
    )
  }

  if (kanbanAvailable === false) {
    return (
      <BackendUnavailableState
        feature="Hermes Kanban"
        description="The Tasks board requires the Hermes Agent Dashboard Kanban plugin. Start the Agent dashboard on port 9119 with the Kanban plugin enabled."
      />
    )
  }

  return <TasksScreen />
}
