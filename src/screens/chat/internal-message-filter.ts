/**
 * Shared internal-system-message filter.
 *
 * Hermes Agent injects control-plane "user" messages — pre-compaction memory
 * flushes, heartbeat prompts, subagent announcements, queued-announce batches,
 * and stats lines — that must never render in the chat UI.
 *
 * Two independent code paths previously hardcoded near-identical prose
 * blacklists that drifted apart (`includes` vs `startsWith` for some entries):
 *   - chat-store.ts processEvent (realtime store)
 *   - use-realtime-chat-history.ts onUserMessage (query-cache append)
 *
 * This module is the single source of truth — the UNION of both lists, using
 * the more permissive match (`includes`) wherever the two paths had drifted so
 * neither path can regress.
 */
export function isInternalSystemMessage(text: string): boolean {
  if (!text) return false
  return (
    text.startsWith('Pre-compaction memory flush') ||
    // `includes` (more permissive of the two drifted paths)
    text.includes('Store durable memories now') ||
    text.includes('APPEND new content only and do not overwrite') ||
    text.startsWith('A subagent task') ||
    text.startsWith('[Queued announce messages') ||
    text.includes('Summarize this naturally for the user') ||
    (text.includes('Stats: runtime') && text.includes('sessionKey agent:'))
  )
}
