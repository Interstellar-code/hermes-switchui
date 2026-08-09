import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  PathContainmentError,
  resolveContainedPath,
} from '../../server/path-containment'

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
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
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

        // Resolve to a real, symlink-followed path and confirm it's inside
        // DOCS_ROOT (also symlink-followed). A plain string-prefix check on
        // the un-resolved path — what this route used to do — misses a
        // symlink (file or directory) planted inside docs/ that points
        // outside it: the joined path *looks* contained even though the
        // filesystem resolves it elsewhere. See `path-containment.ts`,
        // established in `server/hermes-docs.ts`. A missing DOCS_ROOT
        // (fresh checkout with no docs/ built yet) degrades to the same 404
        // rather than throwing.
        let resolved: string
        try {
          resolved = resolveContainedPath(DOCS_ROOT, normalized)
        } catch (err) {
          if (
            err instanceof PathContainmentError &&
            err.reason === 'escapes-root'
          ) {
            return Response.json(
              { ok: false, error: 'Invalid path' },
              { status: 400 },
            )
          }
          return Response.json(
            { ok: false, error: 'Not found' },
            { status: 404 },
          )
        }

        const stat = fs.statSync(resolved)
        if (!stat.isFile()) {
          return Response.json(
            { ok: false, error: 'Not found' },
            { status: 404 },
          )
        }

        const buffer = fs.readFileSync(resolved)
        const headers: Record<string, string> = {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        }

        // First-party flow diagrams (docs/diagrams/*.html) are authored in-repo
        // and embedded inline via a sandboxed <iframe> (docs-render injects
        // sandbox=""). They are exempt from the force-download rule so the frame
        // renders instead of downloading, but are still locked down: no scripts
        // of any kind, only inline + Google Fonts styling. The iframe sandbox is
        // the primary control; this CSP is defense-in-depth. The exemption is
        // scoped to the diagrams/ subtree so arbitrary uploaded HTML elsewhere
        // is unaffected.
        const isInlineDiagram =
          HTML_EXTENSIONS.has(ext) && normalized.startsWith('diagrams/')

        if (isInlineDiagram) {
          headers['Content-Security-Policy'] =
            "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'self'"
          headers['X-Frame-Options'] = 'SAMEORIGIN'
        } else if (FORCE_DOWNLOAD_EXTENSIONS.has(ext)) {
          // Force download to prevent inline execution on the API origin.
          // - HTML: inline event handlers / javascript: URIs bypass script-src 'none'.
          // - SVG: <script> inside SVG executes in Firefox when served as image/svg+xml.
          const filename = path.basename(normalized)
          headers['Content-Disposition'] = `attachment; filename="${filename}"`
          // Defense-in-depth: tight CSP + framing controls even for attachment
          // responses in case the client ignores Content-Disposition or opens
          // the file inline.
          headers['Content-Security-Policy'] =
            "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'"
          headers['X-Frame-Options'] = 'SAMEORIGIN'
        }

        return new Response(buffer, { status: 200, headers })
      },
    },
  },
})
