import { createFileRoute } from '@tanstack/react-router'
import { BackendUnavailableState } from '@/components/backend-unavailable-state'
import { usePageTitle } from '@/hooks/use-page-title'
import { useSelfImproveAvailable } from '@/hooks/use-self-improve-available'
import { SelfImproveScreen } from '@/screens/self-improve/self-improve-screen'

export const Route = createFileRoute('/self-improve')({
  ssr: false,
  component: SelfImproveRoute,
})

function SelfImproveRoute() {
  usePageTitle('Self-Improve')
  const available = useSelfImproveAvailable()

  if (available === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--theme-hover)]" />
      </div>
    )
  }

  if (available === false) {
    return (
      <BackendUnavailableState
        feature="Self-Improve"
        description="The Self-Improve workspace requires the karpathy-self-improve Hermes Agent Dashboard plugin. Start the Agent dashboard with the karpathy-self-improve plugin enabled."
      />
    )
  }

  return <SelfImproveScreen />
}
