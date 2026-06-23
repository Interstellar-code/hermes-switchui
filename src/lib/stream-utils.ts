/**
 * Shared stream-parsing utilities used by the send-stream API routes
 * and the chat screen attachment normalisation.
 *
 * All functions here are pure / side-effect-free so they can be imported
 * from both server-side route handlers and client-side React components.
 */

/** Coerce an unknown value to a trimmed string, returning '' for non-strings. */
export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Coerce an unknown value to a plain object, returning undefined for non-objects. */
export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Try to JSON-parse a string that looks like a JSON object or array.
 * Returns the parsed value on success, the original value on failure
 * (or for non-strings, returns the value unchanged).
 */
export function parseJsonIfPossible(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}

/**
 * Strip a `data:<mime>;base64,` prefix from a value.
 *
 * Accepts `unknown` so it can be used directly on untyped attachment fields
 * (chat-screen.tsx) as well as on already-typed string fields (send-stream.ts).
 * Non-string inputs return ''. Plain strings without a data-URL prefix are
 * returned trimmed and unchanged.
 */
export function stripDataUrlPrefix(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const commaIndex = trimmed.indexOf(',')
  if (trimmed.toLowerCase().startsWith('data:') && commaIndex >= 0) {
    return trimmed.slice(commaIndex + 1).trim()
  }
  return trimmed
}
