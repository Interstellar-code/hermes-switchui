import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'
import { isAuthenticated } from '../../server/auth-middleware'

const DOCS_ROOT = path.join(process.cwd(), 'docs')

const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
}

// Extensions that must be forced to download rather than rendered inline.
// - HTML/HTM: inline event handlers (onclick, onerror, onload) and javascript:
//   URIs still execute even with CSP script-src 'none', so we cannot safely
//   serve them as text/html on the API origin.
// - SVG: inline <script> executes in Firefox when served as image/svg+xml
//   without Content-Disposition: attachment (CVE class). Force download.
const FORCE_DOWNLOAD_EXTENSIONS = new Set(['.html', '.htm', '.svg'])

const HTML_EXTENSIONS = new Set(['.html', '.htm'])

export const Route = createFileRoute('/api/docs-asset')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const rawPath = url.searchParams.get('path')

        if (!rawPath || rawPath.trim() === '') {
          return Response.json(
            { ok: false, error: 'Missing required parameter: path' },
            { status: 400 },
          )
        }

        // Normalize and check for traversal
        const normalized = path.posix.normalize(rawPath)
        if (normalized.includes('..') || path.isAbsolute(normalized)) {
          return Response.json(
            { ok: false, error: 'Invalid path' },
            { status: 400 },
          )
        }

        // Check extension
        const ext = path.extname(normalized).toLowerCase()
        const contentType = ALLOWED_EXTENSIONS[ext]
        if (!contentType) {
          return Response.json(
            { ok: false, error: 'Unsupported media type' },
            { status: 415 },
          )
        }

        // Resolve to absolute path and confirm it's inside DOCS_ROOT
        const resolved = path.join(DOCS_ROOT, normalized)
        if (!resolved.startsWith(DOCS_ROOT + path.sep) && resolved !== DOCS_ROOT) {
          return Response.json(
            { ok: false, error: 'Invalid path' },
            { status: 400 },
          )
        }

        if (!fs.existsSync(resolved)) {
          return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
        }

        const stat = fs.statSync(resolved)
        if (!stat.isFile()) {
          return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
        }

        const buffer = fs.readFileSync(resolved)
        const headers: Record<string, string> = {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        }

        if (FORCE_DOWNLOAD_EXTENSIONS.has(ext)) {
          // Force download to prevent inline execution on the API origin.
          // - HTML: inline event handlers / javascript: URIs bypass script-src 'none'.
          // - SVG: <script> inside SVG executes in Firefox when served as image/svg+xml.
          const filename = path.basename(normalized)
          headers['Content-Disposition'] = `attachment; filename="${filename}"`
        }

        if (HTML_EXTENSIONS.has(ext)) {
          headers['Content-Security-Policy'] =
            "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'"
          headers['X-Frame-Options'] = 'SAMEORIGIN'
        }

        return new Response(buffer, { status: 200, headers })
      },
    },
  },
})
