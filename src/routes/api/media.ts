import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'

function getHermesHome(): string {
  return path.resolve(
    process.env.HERMES_HOME?.trim() ||
    process.env.CLAUDE_HOME?.trim() ||
    path.join(homedir(), '.hermes'),
  )
}

function getAllowedMediaRoots(): Array<string> {
  return [
    path.join(getHermesHome(), 'uploads'),
    path.join(process.cwd(), 'files'),
  ]
}

function isPathAllowed(resolvedPath: string, roots: Array<string>): boolean {
  return roots.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(root + path.sep),
  )
}

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

function getMediaContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MEDIA_CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export const Route = createFileRoute('/api/media')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const mediaPath = url.searchParams.get('path')?.trim() ?? ''
        if (!mediaPath) {
          return Response.json(
            { ok: false, error: 'Missing required parameter: path' },
            { status: 400 },
          )
        }

        const resolved = path.resolve(mediaPath)
        const allowedRoots = getAllowedMediaRoots()
        if (!isPathAllowed(resolved, allowedRoots)) {
          return Response.json(
            { ok: false, error: 'Path not permitted' },
            { status: 403 },
          )
        }

        try {
          const fileStat = await stat(resolved)
          if (!fileStat.isFile()) {
            return Response.json({ ok: false, error: 'Not a file' }, { status: 400 })
          }

          return new Response(
            Readable.toWeb(createReadStream(resolved)) as unknown as BodyInit,
            {
              status: 200,
              headers: {
                'Content-Type': getMediaContentType(resolved),
                'Content-Length': String(fileStat.size),
                'Content-Disposition': `inline; filename="${path.basename(resolved)}"`,
              },
            },
          )
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to read media file'
          return Response.json({ ok: false, error: message }, { status: 404 })
        }
      },
    },
  },
})
