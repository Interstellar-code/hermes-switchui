import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routes = [
  'send-stream.ts',
  'hermes-kanban/events.ts',
  'events.ts',
  'terminal-stream.ts',
  'workflow-events.ts',
  'mcp/$name.logs.ts',
  'chat-events.ts',
]

describe('SSE response headers', () => {
  it.each(routes)('%s leaves connection management to the HTTP server', (route) => {
    const source = readFileSync(
      fileURLToPath(new URL(route, import.meta.url)),
      'utf8',
    )

    expect(source).toContain("'Content-Type': 'text/event-stream")
    expect(source).toContain("'Cache-Control':")
    expect(source).not.toMatch(/Connection:\s*['"]keep-alive['"]/)
  })
})
