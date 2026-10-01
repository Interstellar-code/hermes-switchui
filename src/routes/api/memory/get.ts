import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readMemoryFile, resolveMemoryFilePath } from '../../../server/memory-browser'

export const Route = createFileRoute('/api/memory/get')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const rawPath = url.searchParams.get('path')
        if (!rawPath) {
          return Response.json({ error: 'Missing path parameter' }, { status: 400 })
        }

        let relativePath: string
        try {
          // URL-decode before passing to the resolver (memory list encodes names)
          relativePath = decodeURIComponent(rawPath)
        } catch {
          return Response.json({ error: 'Invalid path encoding' }, { status: 400 })
        }

        try {
          // resolveMemoryFilePath enforces:
          //   - no absolute paths
          //   - no path traversal (..)
          //   - only .md files
          //   - path must be MEMORY.md | memory/ | memories/ and realpath-contained
          const { fullPath } = resolveMemoryFilePath(relativePath)
          const content = readMemoryFile(relativePath)
          const stat = fs.statSync(fullPath)
          const name = relativePath.split('/').pop() ?? relativePath
          return Response.json({
            content,
            name,
            updatedAt: stat.mtimeMs,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to read memory file'
          // Outside the memory allowlist → 403; malformed → 400; fs errors 500
          if (/not a memory file|outside workspace/i.test(message)) {
            return Response.json({ error: message }, { status: 403 })
          }
          const isValidationError =
            message.includes('not allowed') ||
            message.includes('traversal') ||
            message.includes('required') ||
            message.includes('Only Markdown')
          return Response.json({ error: message }, { status: isValidationError ? 400 : 500 })
        }
      },
    },
  },
})
