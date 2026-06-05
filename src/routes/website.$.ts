import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'

const WEBSITE_ROOT = path.join(process.cwd(), 'website', 'dist')

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function resolveWebsiteFile(splat: string): string {
  // Normalize: strip leading slash, collapse dots
  const cleaned = splat.replace(/^\/+/, '') || ''
  const normalized = path.posix.normalize(cleaned || '.')

  // Reject traversal
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    return ''
  }

  const candidate = normalized === '.' ? WEBSITE_ROOT : path.join(WEBSITE_ROOT, normalized)

  // Confirm still inside WEBSITE_ROOT
  const real = path.resolve(candidate)
  if (!real.startsWith(WEBSITE_ROOT + path.sep) && real !== WEBSITE_ROOT) {
    return ''
  }

  // If it's a directory, try index.html inside it
  if (fs.existsSync(real)) {
    const stat = fs.statSync(real)
    if (stat.isDirectory()) {
      const idx = path.join(real, 'index.html')
      return fs.existsSync(idx) ? idx : ''
    }
    if (stat.isFile()) return real
  }

  // Try appending .html for extension-less paths
  const withHtml = real + '.html'
  if (fs.existsSync(withHtml) && fs.statSync(withHtml).isFile()) {
    return withHtml
  }

  return ''
}

export const Route = createFileRoute('/website/$')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const splat = (params as Record<string, string | undefined>)['_splat'] ?? ''

        // Check website/dist exists
        if (!fs.existsSync(WEBSITE_ROOT)) {
          return new Response(
            "Website not built — run `pnpm build:website`.",
            { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
          )
        }

        const filePath = resolveWebsiteFile(splat)
        if (!filePath) {
          return new Response('Not found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }

        const ext = path.extname(filePath).toLowerCase()
        const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
        const buffer = fs.readFileSync(filePath)
        const stat = fs.statSync(filePath)

        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(stat.size),
            'Cache-Control': 'public, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      },
    },
  },
})
