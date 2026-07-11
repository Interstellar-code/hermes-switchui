import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { subscribeToChatEvents } from '../../server/chat-event-bus'

/**
 * SSE endpoint for chat events.
 *
 * Claude does not expose a global browser-facing event stream, so the server
 * keeps a local singleton bus of translated chat events and fans that out to
 * any browser SSE subscribers.
 */
export const Route = createFileRoute('/api/chat-events')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const url = new URL(request.url)
        const sessionKeyParam =
          url.searchParams.get('sessionKey')?.trim() || undefined

        const encoder = new TextEncoder()
        let streamClosed = false
        let unsubscribe: (() => void) | null = null
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null

        /**
         * Release all stream resources: set the closed flag, stop the
         * heartbeat timer, and unsubscribe from the event bus.
         *
         * Idempotent — safe to call more than once (the `streamClosed` guard
         * short-circuits on the second call).
         *
         * Note: does NOT call `controller.close()`. The `start` wrapper calls
         * that separately when tearing down from within the stream (e.g. on
         * error); the `cancel` callback must NOT call it because the runtime
         * already owns the controller lifecycle at that point.
         */
        const finishStream = () => {
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
        }

        const stream = new ReadableStream({
          start(controller) {
            const sendEvent = (event: string, data: unknown) => {
              if (streamClosed) return
              try {
                const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
                controller.enqueue(encoder.encode(payload))
              } catch {
                /* stream closed */
              }
            }

            try {
              sendEvent('connected', {
                timestamp: Date.now(),
                sessionKey: sessionKeyParam || 'all',
              })

              // Subscribe to the deduplicated event stream
              unsubscribe = subscribeToChatEvents((evt) => {
                if (streamClosed) return
                sendEvent(evt.event, evt.data)
              }, sessionKeyParam)

              // Heartbeat to keep SSE alive
              heartbeatTimer = setInterval(() => {
                sendEvent('heartbeat', { timestamp: Date.now() })
              }, 30_000)
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err)
              sendEvent('error', { message: errorMsg })
              finishStream()
              try {
                controller.close()
              } catch {
                /* ignore */
              }
            }
          },
          cancel() {
            finishStream()
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
