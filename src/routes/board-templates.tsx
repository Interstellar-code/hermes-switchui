import { createFileRoute } from '@tanstack/react-router'
import { useIsFeatureAvailable } from '@/hooks/use-gateway-caps'
import { BackendUnavailableState } from '@/components/backend-unavailable-state'
import { BoardTemplatesScreen } from '@/screens/board-templates/board-templates-screen'

export const Route = createFileRoute('/board-templates')({
  ssr: false,
  component: BoardTemplatesRoute,
})

function BoardTemplatesRoute() {
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
        feature="Hermes Board Templates"
        description="Board Templates require the Hermes Agent Dashboard Kanban plugin. Start the Agent dashboard on port 9119 with the Kanban plugin enabled."
      />
    )
  }

  // The screen itself handles the finer-grained degraded state (templates API
  // returns 404 on older Agents that have Kanban but not the templates endpoint).
  return <BoardTemplatesScreen />
}
