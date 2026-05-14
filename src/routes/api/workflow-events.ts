import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getWorkflowEngine } from '../../server/workflow-engine'

/**
 * SSE endpoint for workflow execution events (A.1.2).
 *
 * GET /api/workflow-events?conversation_id=<id>
 *
 * Streams WorkflowEmitterEvent objects filtered to the requested conversation.
 * Uses WorkflowEventEmitter.subscribeForConversation() which handles both
 * run-scoped events (via runId→conversationId map) and platform-bridge events
 * that carry conversationId directly.
 */
export const Route = createFileRoute('/api/workflow-events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const url = new URL(request.url)
        const conversationId = url.searchParams.get('conversation_id')?.trim()

        if (!conversationId) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Missing required query param: conversation_id' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const encoder = new TextEncoder()
        let streamClosed = false
        let unsubscribe: (() => void) | null = null
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null

        const stream = new ReadableStream({
          async start(controller) {
            const send = (raw: string) => {
              if (streamClosed) return
              try {
                controller.enqueue(encoder.encode(raw))
              } catch {
                /* stream closed */
              }
            }

            const sendEvent = (type: string, data: unknown) => {
              send(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
            }

            const sendComment = (comment: string) => {
              send(`:${comment}\n\n`)
            }

            const closeStream = () => {
              if (streamClosed) return
              streamClosed = true
              if (heartbeatTimer) {
                clearInterval(heartbeatTimer)
                heartbeatTimer = null
              }
              if (unsubscribe) {
                unsubscribe()
                unsubscribe = null
              }
              try {
                controller.close()
              } catch {
                /* ignore */
              }
            }

            // Abort when client disconnects
            request.signal.addEventListener('abort', closeStream)

            try {
              const engine = await getWorkflowEngine()

              sendEvent('connected', { conversationId })

              unsubscribe = engine.emitter.subscribeForConversation(
                conversationId,
                (event) => {
                  if (streamClosed) return
                  sendEvent(event.type, event)
                },
              )

              // Heartbeat every 25s to survive proxies that timeout idle connections
              heartbeatTimer = setInterval(() => {
                sendComment('hb')
              }, 25_000)
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err)
              sendEvent('error', { message: errorMsg })
              closeStream()
            }
          },
          cancel() {
            streamClosed = true
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer)
              heartbeatTimer = null
            }
            if (unsubscribe) {
              unsubscribe()
              unsubscribe = null
            }
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
