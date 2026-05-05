/**
 * Media endpoint.
 *
 * Serves local image/media files from disk so that `MEDIA:<local_path>` tokens
 * emitted by Hermes Agent can render as <img> in the Workspace chat.
 *
 * Reuses the same auth + path-allowlist pattern as preview-file.ts but with
 * broader prefixes that cover the directories Hermes Agent typically writes
 * media to (tmp, cache, home).
 */
import { statSync, readFileSync } from 'node:fs'
import { extname, resolve as resolvePath } from 'node:path'
import * as os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { requireLocalOrAuth } from '../../server/auth-middleware'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB ceiling for media files

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
}

function allowedPrefixes(): string[] {
  const home = os.homedir()
  const hermesHome =
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? resolvePath(home, '.hermes')

  return [
    '/tmp',
    `${home}/tmp`,
    resolvePath(hermesHome),
    resolvePath(hermesHome, 'tmp'),
    resolvePath(hermesHome, 'cache'),
    resolvePath(hermesHome, 'audio_cache'),
    resolvePath(home, 'dispatch'),
    resolvePath(home, 'projects'),
    resolvePath(hermesHome, 'projects'),
    resolvePath(home, '.claude', 'projects'),
    resolvePath(home, '.ocplatform', 'workspace', 'projects'),
  ]
}

function isAllowed(absPath: string): boolean {
  return allowedPrefixes().some(
    (prefix) => absPath === prefix || absPath.startsWith(`${prefix}/`),
  )
}

export const Route = createFileRoute('/api/media')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        try {
          const url = new URL(request.url)
          const rawPath = url.searchParams.get('path') || ''
          if (!rawPath) {
            return new Response('path required', { status: 400 })
          }

          // Only accept absolute paths
          if (!rawPath.startsWith('/')) {
            return new Response('Only absolute paths are accepted', { status: 400 })
          }

          const abs = resolvePath(rawPath)
          if (!isAllowed(abs)) {
            return new Response('Forbidden path', { status: 403 })
          }

          let stat
          try {
            stat = statSync(abs)
          } catch {
            return new Response('Not found', { status: 404 })
          }

          if (!stat.isFile()) {
            return new Response('Not a file', { status: 400 })
          }

          if (stat.size > MAX_BYTES) {
            return new Response('File too large', { status: 413 })
          }

          const body = readFileSync(abs)
          const mime = MIME_BY_EXT[extname(abs).toLowerCase()] ?? 'application/octet-stream'
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': mime,
              'Cache-Control': 'private, max-age=60',
              'Referrer-Policy': 'no-referrer',
            },
          })
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : 'Media serve failed',
            { status: 500 },
          )
        }
      },
    },
  },
})

function isPasswordEnabled(): boolean {
  const pw = process.env.HERMES_PASSWORD ?? process.env.CLAUDE_PASSWORD ?? ''
  return pw.length > 0
}
