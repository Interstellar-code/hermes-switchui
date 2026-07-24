import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { FilesScreen } from '@/screens/files/files-screen'

const searchSchema = z.object({
  open: z.string().trim().min(1).optional(),
})

export const Route = createFileRoute('/files')({
  ssr: false,
  validateSearch: searchSchema,
  component: FilesRoute,
})

function FilesRoute() {
  return <FilesScreen />
}
