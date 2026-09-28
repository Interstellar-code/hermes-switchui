/**
 * Backup Delete API — removes one archive from the active profile's backups
 * directory. Handled locally: the dashboard has no delete endpoint.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'
import { requireJsonContentType } from '@/server/rate-limit'
import {
  BackupDeleteError,
  activeProfileBackupDir,
  deleteBackupArchive,
} from '@/server/backup-delete'

export const Route = createFileRoute('/api/backups/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }

        const body = (await request.json().catch(() => ({}))) as {
          archive?: unknown
        }
        const archive = typeof body.archive === 'string' ? body.archive : ''

        try {
          await deleteBackupArchive(archive, activeProfileBackupDir())
          return Response.json({ ok: true })
        } catch (err) {
          if (err instanceof BackupDeleteError) {
            return Response.json(
              { ok: false, error: err.message },
              { status: err.status },
            )
          }
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : 'Delete failed',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
