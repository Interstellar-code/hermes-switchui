import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { Matrix3DScreen } from '@/screens/matrix3d/matrix3d-screen'

export const Route = createFileRoute('/matrix3d')({
  ssr: false,
  component: Matrix3DRoute,
})

function Matrix3DRoute() {
  usePageTitle('Matrix3D')
  return <Matrix3DScreen />
}
