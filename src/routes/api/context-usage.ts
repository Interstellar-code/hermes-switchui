import { createFileRoute } from '@tanstack/react-router'

const CHARS_PER_TOKEN = 3.5

type ContentPart = { type: string; text?: string }
type MessageLike = { content?: string | ContentPart[]; text?: string }

/**
 * Estimate token count from an array of messages.
 * Counts structured content arrays and tool results; avoids double-counting
 * when a top-level `text` field mirrors the structured content.
 */
export function estimateContextTokensFromMessages(messages: MessageLike[]): number {
  let totalChars = 0
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      // Sum chars from structured content parts
      let contentChars = 0
      for (const part of msg.content as ContentPart[]) {
        if (part.text) contentChars += part.text.length
      }
      totalChars += contentChars
      // Only add top-level text if it's not a mirror of the content
      if (typeof msg.text === 'string' && msg.text !== '') {
        const contentText = (msg.content as ContentPart[]).map((p) => p.text ?? '').join('')
        if (msg.text !== contentText) {
          totalChars += msg.text.length
        }
      }
    } else if (typeof msg.content === 'string') {
      totalChars += msg.content.length
    }
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN)
}

/**
 * Estimate context tokens from cumulative cache-read bytes and turn count.
 * This is a fallback (higher) estimate used when message content is unavailable.
 */
export function estimateContextTokensFromCacheRead(
  cumulativeCacheReadBytes: number,
  turnCount: number,
): number {
  const assistantTurns = Math.max(1, Math.ceil(turnCount / 2))
  return Math.ceil((cumulativeCacheReadBytes / assistantTurns) * 1.2 / CHARS_PER_TOKEN)
}
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { readContextUsage } from '@/server/context-usage'

export const Route = createFileRoute('/api/context-usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const sessionId =
          url.searchParams.get('sessionId')?.trim() ||
          url.searchParams.get('sessionKey')?.trim() ||
          ''

        if (sessionId === 'new' || sessionId === 'main') {
          return json({
            ok: true,
            contextPercent: 0,
            maxTokens: 0,
            usedTokens: 0,
            model: '',
            staticTokens: 0,
            conversationTokens: 0,
          })
        }

        const snapshot = await readContextUsage(sessionId)
        return json(snapshot)
      },
    },
  },
})
