/**
 * GET /api/hermes-kanban/events?token=<one-time-token>&since=<event-id>
 *
 * Workspace-owned SSE proxy to the Agent Kanban WebSocket event stream.
 * The browser connects here; this handler upgrades to the dashboard WS
 * internally and forwards events as SSE text/event-stream to the browser.
 *
 * Security: requires a one-time token issued by /api/hermes-kanban/events-token.
 * Direct browser-to-dashboard WebSocket is explicitly out of scope for v1.
 */
import { createFileRoute } from '@tanstack/react-router'
import { CLAUDE_DASHBOARD_URL, fetchDashboardToken } from '../../../server/gateway-capabilities'
import { consumeEventToken } from './events-token'

export const Route = createFileRoute('/api/hermes-kanban/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const token = url.searchParams.get('token') ?? ''
        const since = url.searchParams.get('since') ?? '0'

        if (!consumeEventToken(token)) {
          return new Response(
            'data: {"error":"invalid or expired token"}\n\n',
            { status: 401, headers: { 'Content-Type': 'text/event-stream' } },
          )
        }

        // Build dashboard WS URL with auth token
        let dashToken = ''
        try {
          dashToken = await fetchDashboardToken()
        } catch {
          // If we can't get a token, we'll try without (localhost dashboard may not need it)
        }

        const dashWsBase = CLAUDE_DASHBOARD_URL.replace(/^http/, 'ws')
        const dashWsUrl = `${dashWsBase}/api/plugins/kanban/events?since=${since}${dashToken ? `&token=${dashToken}` : ''}`

        const encoder = new TextEncoder()
        let wsConn: WebSocket | null = null

        const stream = new ReadableStream({
          start(controller) {
            // Heartbeat keep-alive
            const heartbeat = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(': heartbeat\n\n'))
              } catch {
                clearInterval(heartbeat)
              }
            }, 15_000)

            try {
              wsConn = new WebSocket(dashWsUrl)

              wsConn.onmessage = (msg) => {
                try {
                  controller.enqueue(encoder.encode(`data: ${msg.data}\n\n`))
                } catch {
                  clearInterval(heartbeat)
                }
              }

              wsConn.onerror = () => {
                try {
                  controller.enqueue(encoder.encode('data: {"error":"dashboard ws error"}\n\n'))
                  controller.close()
                } catch { /* ignore */ }
                clearInterval(heartbeat)
              }

              wsConn.onclose = () => {
                try { controller.close() } catch { /* ignore */ }
                clearInterval(heartbeat)
              }
            } catch {
              controller.enqueue(encoder.encode('data: {"error":"ws connect failed"}\n\n'))
              controller.close()
              clearInterval(heartbeat)
            }
          },
          cancel() {
            wsConn?.close()
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
