import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

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
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const mediaPath = url.searchParams.get('path')?.trim() ?? ''
        if (!mediaPath || !path.isAbsolute(mediaPath)) {
          return json(
            { ok: false, error: 'Expected an absolute file path' },
            { status: 400 },
          )
        }

        try {
          const fileStat = await stat(mediaPath)
          if (!fileStat.isFile()) {
            return json({ ok: false, error: 'Not a file' }, { status: 400 })
          }

          return new Response(
            Readable.toWeb(createReadStream(mediaPath)) as unknown as BodyInit,
            {
              status: 200,
              headers: {
                'Content-Type': getMediaContentType(mediaPath),
                'Content-Length': String(fileStat.size),
                'Content-Disposition': `inline; filename="${path.basename(mediaPath)}"`,
              },
            },
          )
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to read media file'
          return json({ ok: false, error: message }, { status: 404 })
        }
      },
    },
  },
})
