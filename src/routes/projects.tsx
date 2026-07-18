import { createFileRoute } from '@tanstack/react-router'
import { useIsFeatureAvailable } from '@/hooks/use-gateway-caps'
import { BackendUnavailableState } from '@/components/backend-unavailable-state'
import { ProjectsScreen } from '@/screens/projects/projects-screen'

export const Route = createFileRoute('/projects')({
  ssr: false,
  component: ProjectsRoute,
})

function ProjectsRoute() {
  const projectsAvailable = useIsFeatureAvailable('projects')

  if (projectsAvailable === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--theme-hover)]" />
      </div>
    )
  }

  if (projectsAvailable === false) {
    return (
      <BackendUnavailableState
        feature="Hermes Projects"
        description="The Projects workspace requires the Hermes Agent Dashboard Projects plugin. Start the Agent dashboard on port 9119 with the Projects plugin enabled."
      />
    )
  }

  return <ProjectsScreen />
}
