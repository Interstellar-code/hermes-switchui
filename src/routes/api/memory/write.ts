import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { resolveMemoryFilePath } from '../../../server/memory-browser'
import { requireJsonContentType } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/memory/write')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        // Memory writes go directly to local fs ($HERMES_HOME/memory/...).
        // No remote gateway endpoint is involved.
        try {
          const body = (await request.json().catch(() => ({}))) as {
            path?: unknown
            content?: unknown
          }
          const { relativePath, fullPath } = resolveMemoryFilePath(
            typeof body.path === 'string' ? body.path : '',
          )
          const content = typeof body.content === 'string' ? body.content : ''

          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          // Temp file + rename: rename replaces a symlink planted at fullPath
          // after validation instead of following it; 'wx' refuses to follow
          // one planted at the temp name.
          const tmpPath = `${fullPath}.${process.pid}.${Date.now()}.tmp`
          try {
            fs.writeFileSync(tmpPath, content, {
              encoding: 'utf-8',
              flag: 'wx',
            })
            fs.renameSync(tmpPath, fullPath)
          } catch (err) {
            fs.rmSync(tmpPath, { force: true })
            throw err
          }
          return Response.json({ success: true, path: relativePath })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to write memory file'
          const status = /not a memory file|outside workspace/i.test(message)
            ? 403
            : /required|not allowed|Only Markdown/i.test(message)
              ? 400
              : 500
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
