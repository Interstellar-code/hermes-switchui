import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readMemoryFile, resolveMemoryFilePath } from '../../../server/memory-browser'
import fs from 'node:fs'

export const Route = createFileRoute('/api/memory/get')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const rawPath = url.searchParams.get('path')
        if (!rawPath) {
          return json({ error: 'Missing path parameter' }, { status: 400 })
        }

        let relativePath: string
        try {
          // URL-decode before passing to the resolver (memory list encodes names)
          relativePath = decodeURIComponent(rawPath)
        } catch {
          return json({ error: 'Invalid path encoding' }, { status: 400 })
        }

        try {
          // resolveMemoryFilePath enforces:
          //   - no absolute paths
          //   - no path traversal (..)
          //   - only .md files
          //   - path must be within workspace root (MEMORY.md | memory/ | memories/)
          const { fullPath } = resolveMemoryFilePath(relativePath)
          const content = readMemoryFile(relativePath)
          const stat = fs.statSync(fullPath)
          const name = relativePath.split('/').pop() ?? relativePath
          return json({
            content,
            name,
            updatedAt: stat.mtimeMs,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to read memory file'
          // Path validation errors should be 400; filesystem errors 500
          const isValidationError =
            message.includes('not allowed') ||
            message.includes('traversal') ||
            message.includes('required') ||
            message.includes('outside workspace') ||
            message.includes('Only Markdown')
          return json({ error: message }, { status: isValidationError ? 400 : 500 })
        }
      },
    },
  },
})
