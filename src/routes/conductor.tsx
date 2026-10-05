import { createFileRoute } from '@tanstack/react-router'
import { Conductor } from '@/screens/gateway/conductor'

function ConductorRoute() {
  return <Conductor />
}

// Client-only: the React Flow canvas measures the DOM (same pattern as /memory).
export const Route = createFileRoute('/conductor')({
  ssr: false,
  component: ConductorRoute,
})
