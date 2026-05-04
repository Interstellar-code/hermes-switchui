/**
 * GET  /api/hermes-kanban/migrate-legacy-tasks → dry-run preview
 * POST /api/hermes-kanban/migrate-legacy-tasks → perform import
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  previewMigration,
  performMigration,
  readLegacyTasks,
  isMigrated,
} from '../../../server/legacy-tasks-migration'

export const Route = createFileRoute('/api/hermes-kanban/migrate-legacy-tasks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const preview = previewMigration()
          return json({ preview })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Preview failed'
          return json({ error: msg }, { status: 500 })
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const tasks = readLegacyTasks()
        if (tasks.length === 0) {
          return json({ ok: true, message: 'No legacy tasks to import', imported: 0 })
        }
        if (isMigrated()) {
          return json({
            ok: false,
            message: 'Migration already performed. Delete the .migrated marker file to re-run.',
          }, { status: 409 })
        }
        try {
          const result = await performMigration()
          return json({ ok: true, result })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Migration failed'
          return json({ error: msg }, { status: 500 })
        }
      },
    },
  },
})
