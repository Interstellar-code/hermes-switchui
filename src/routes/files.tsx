import { createFileRoute } from '@tanstack/react-router'
import { FilesScreen } from '@/screens/files/files-screen'

export const Route = createFileRoute('/files')({
  ssr: false,
  component: FilesRoute,
})

function FilesRoute() {
  return <FilesScreen />
}
