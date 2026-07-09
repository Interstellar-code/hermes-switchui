import { createFileRoute } from '@tanstack/react-router'
import BackendUnavailableState from '@/components/backend-unavailable-state'
import { usePageTitle } from '@/hooks/use-page-title'
import { getUnavailableReason } from '@/lib/feature-gates'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { BackupsScreen } from '@/screens/backups/backups-screen'

export const Route = createFileRoute('/backups')({
  ssr: false,
  component: BackupsRoute,
})

function BackupsRoute() {
  usePageTitle('Backups')
  const available = useFeatureAvailable('config')
  if (!available) {
    return (
      <BackendUnavailableState
        feature="Backups"
        description={getUnavailableReason('config')}
      />
    )
  }
  return <BackupsScreen />
}
