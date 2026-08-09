/**
 * first-chat.ts — read one real completion out of the chat stream.
 *
 * `verify-provider.ts` already parses this stream, but only far enough to
 * answer "did an error event arrive". The gate needs more than a boolean: it
 * has to show the user the words the agent actually said, because "a
 * completion succeeded" is a claim they should be able to check with their own
 * eyes rather than take from a green tick.
 *
 * The stream shape is `event: <name>\ndata: <json>\n\n`
 * (`routes/api/send-stream.ts:423`):
 *
 *   chunk  `{ text, fullReplace? }` — `fullReplace` replaces the accumulator
 *          rather than appending, and the portable backend uses it for every
 *          chunk, so appending blindly produces the answer N times over.
 *   done   `{ message: { content: [{ type: 'text', text }] } }` — the
 *          authoritative final text when it is present.
 *   error  `{ message }` — the gateway's own words. Never paraphrased.
 *
 * A non-2xx response is plain JSON `{ ok: false, error }` instead, because a
 * credential failure can surface either way depending on how far the request
 * got before the provider rejected it.
 */

export type FirstChatParse = {
  /** The assistant's text, trimmed. Empty when nothing arrived. */
  reply: string
  /** The gateway's verbatim error, or `null`. */
  error: string | null
}

/**
 * Signals in a gateway error that mean "the credential did not resolve",
 * rather than "the provider is down" or "the request was malformed". Kept
 * local rather than imported because it drives different copy here: the chat
 * gate uses it to decide whether the skip warning should talk about a rejected
 * key or an unproven setup.
 */
const CREDENTIAL_ERROR_RE =
  /\b(401|403|unauthor\w*|invalid[_ -]?api[_ -]?key|invalid[_ -]?token|no[_ -]?key|api[_ -]?key|authentication\w*|credential\w*|forbidden)\b/i

export function looksLikeCredentialFailure(message: string): boolean {
  return CREDENTIAL_ERROR_RE.test(message)
}

function textFromDonePayload(data: Record<string, unknown>): string {
  const message = data.message
  if (!message || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const rec = part as Record<string, unknown>
      return rec.type === 'text' && typeof rec.text === 'string' ? rec.text : ''
    })
    .join('')
}

export function parseFirstChatStream(body: string): FirstChatParse {
  const trimmedBody = body.trim()

  // Non-stream error body.
  if (trimmedBody.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmedBody) as {
        ok?: boolean
        error?: unknown
      }
      if (parsed.ok === false && typeof parsed.error === 'string') {
        return { reply: '', error: parsed.error }
      }
    } catch {
      // Not JSON after all — fall through to the SSE scan.
    }
  }

  let error: string | null = null
  let accumulated = ''
  let finalText = ''
  let currentEvent = ''

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('event:')) {
      currentEvent = line.slice('event:'.length).trim()
      continue
    }
    if (!line.startsWith('data:')) continue
    const payload = line.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue

    let data: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(payload)
      if (parsed && typeof parsed === 'object') {
        data = parsed as Record<string, unknown>
      }
    } catch {
      // A non-JSON data line is content in practice.
      if (currentEvent !== 'error') accumulated += payload
      continue
    }

    if (currentEvent === 'error' || typeof data.error === 'string') {
      const message =
        (typeof data.message === 'string' && data.message) ||
        (typeof data.error === 'string' && data.error) ||
        ''
      if (message && !error) error = message
      continue
    }

    if (currentEvent === 'done') {
      const done = textFromDonePayload(data)
      if (done) finalText = done
      continue
    }

    const text = data.text ?? data.delta ?? data.content
    if (typeof text === 'string' && text.length > 0) {
      accumulated = data.fullReplace === true ? text : accumulated + text
    }
  }

  return { reply: (finalText || accumulated).trim(), error }
}

/** The prompt the gate sends. Short, cheap, and obviously a test. */
export const FIRST_CHAT_PROMPT =
  'This is a setup check. Reply with one short sentence confirming you can hear me.'
