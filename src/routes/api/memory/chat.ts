import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { openaiChat } from '../../../server/openai-compat-api'
import type { OpenAICompatMessage } from '../../../server/openai-compat-api'

// Memory chat — a NON-agentic completion grounded strictly in the caller's
// retrieved memory context. Unlike /api/send-stream (the full agentic Hermes
// agent, which runs its own memory tools), this calls the model directly via
// the OpenAI-compatible endpoint, so the client-retrieved memory context is
// authoritative and the answer is truly gated to memory. See hermes-agent#171
// for why routing memory Q&A through the agent's own recall is unreliable.

const NOT_IN_MEMORY = "I don't have that in my memory."

function buildSystemPrompt(context: string): string {
  if (!context) {
    return `You are the user's personal memory assistant. No memory context is available for this question. Reply exactly: "${NOT_IN_MEMORY}"`
  }
  return `You are the user's personal memory assistant. Answer the question using ONLY the memory context below (the user's memory files and matrix-memory). If the answer is not contained in this memory, reply exactly: "${NOT_IN_MEMORY}" — do not use outside or general knowledge, and do not guess.

--- MEMORY CONTEXT ---
${context}
--- END MEMORY CONTEXT ---`
}

export const Route = createFileRoute('/api/memory/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let body: {
          message?: unknown
          context?: unknown
          history?: unknown
        }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const message = typeof body.message === 'string' ? body.message.trim() : ''
        if (!message) {
          return Response.json({ error: 'message is required' }, { status: 400 })
        }
        const context = typeof body.context === 'string' ? body.context : ''
        const history: Array<OpenAICompatMessage> = Array.isArray(body.history)
          ? (body.history as Array<unknown>)
              .filter(
                (m): m is { role: string; content: string } =>
                  !!m &&
                  typeof (m as { role?: unknown }).role === 'string' &&
                  typeof (m as { content?: unknown }).content === 'string',
              )
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          : []

        const messages: Array<OpenAICompatMessage> = [
          { role: 'system', content: buildSystemPrompt(context) },
          ...history,
          { role: 'user', content: message },
        ]

        const encoder = new TextEncoder()
        try {
          const gen = await openaiChat(messages, {
            stream: true,
            signal: request.signal,
          })
          const stream = new ReadableStream({
            async start(controller) {
              try {
                for await (const chunk of gen) {
                  if (chunk.type === 'content' && chunk.text) {
                    controller.enqueue(
                      encoder.encode(
                        `event: chunk\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`,
                      ),
                    )
                  }
                }
                controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
              } catch (err) {
                controller.enqueue(
                  encoder.encode(
                    `event: error\ndata: ${JSON.stringify({
                      error: err instanceof Error ? err.message : 'stream error',
                    })}\n\n`,
                  ),
                )
              } finally {
                controller.close()
              }
            },
          })
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'private, no-store',
              Connection: 'keep-alive',
            },
          })
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Memory chat failed' },
            { status: 500 },
          )
        }
      },
    },
  },
})
