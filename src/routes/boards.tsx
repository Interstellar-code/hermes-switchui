import { createFileRoute } from '@tanstack/react-router'
import { useIsFeatureAvailable } from '@/hooks/use-gateway-caps'
import { BackendUnavailableState } from '@/components/backend-unavailable-state'
import { BoardsScreen } from '@/screens/boards/boards-screen'

export const Route = createFileRoute('/boards')({
  ssr: false,
  component: BoardsRoute,
})

function BoardsRoute() {
  const kanbanAvailable = useIsFeatureAvailable('kanban')

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
        feature="Hermes Kanban Boards"
        description="The Boards workspace requires the Hermes Agent Dashboard Kanban plugin. Start the Agent dashboard on port 9119 with the Kanban plugin enabled."
      />
    )
  }

  return <BoardsScreen />
}
