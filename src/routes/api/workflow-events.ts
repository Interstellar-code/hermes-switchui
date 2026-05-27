import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'

/**
 * SSE endpoint for workflow execution events (A.1.2).
 *
 * GET /api/workflow-events?runId=<id>
 *
 * Native path: streams WorkflowEmitterEvent objects filtered to the requested
 * run via emitter.subscribeForConversation() using the run's conversation_id.
 * Plugin path: delegates to engine.subscribeEvents(runId) and yields SSE frames.
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
        const runId = url.searchParams.get('runId')?.trim()

        if (!runId) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Missing required query param: runId' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Phase 2: always plugin path — iterate engine.subscribeEvents(runId) and stream SSE frames.
        const engine = getEngine(request)
        const encoder = new TextEncoder()

        const stream = new ReadableStream({
          async start(controller) {
            let streamClosed = false
            const send = (raw: string) => {
              if (streamClosed) return
              try { controller.enqueue(encoder.encode(raw)) } catch { /* closed */ }
            }
            const sendEvent = (type: string, data: unknown) => {
              send(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
            }

            request.signal.addEventListener('abort', () => {
              streamClosed = true
              try { controller.close() } catch { /* ignore */ }
            })

            try {
              // Verify the run exists before opening the stream.
              const run = await engine.getRun(runId)
              if (!run) {
                sendEvent('error', { reason: 'run_not_found', runId })
                return
              }
              sendEvent('connected', { runId })
              for await (const evt of engine.subscribeEvents(runId)) {
                if (streamClosed) break
                sendEvent(evt.event_type, evt)
              }
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err)
              if (errorMsg.includes('404') || errorMsg.includes('run_not_found')) {
                sendEvent('error', { reason: 'run_not_found', runId })
              } else {
                sendEvent('error', { message: errorMsg })
              }
            } finally {
              streamClosed = true
              try { controller.close() } catch { /* ignore */ }
            }
          },
          cancel() { /* cleanup handled via abort signal */ },
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
