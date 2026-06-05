import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'

// Serves website/dist/index.html at the bare /website/ route. The rest of the
// built Astro site (assets + nested pages) is served by the website.$ splat
// route. Public — the marketing site has no auth gate.
const INDEX_FILE = path.join(process.cwd(), 'website', 'dist', 'index.html')

export const Route = createFileRoute('/website/')({
  server: {
    handlers: {
      GET: () => {
        try {
          const html = fs.readFileSync(INDEX_FILE)
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        } catch {
          return new Response(
            'Website not built — run `pnpm build:website`.',
            { status: 404, headers: { 'Content-Type': 'text/plain' } },
          )
        }
      },
    },
  },
})
