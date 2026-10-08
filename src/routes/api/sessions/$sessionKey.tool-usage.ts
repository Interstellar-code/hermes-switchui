import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getMessages,
  toChatMessage,
} from '../../../server/hermes-api'
import {
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
} from '../../../server/profile-scope'
import {
  extractToolEntries,
  isMcpToolEntry,
  unwrapToolInput,
} from '../../../screens/chat/components/v2/tool-entries'
import type { ClaudeMessage } from '../../../server/hermes-api'
import type { FlatToolEntry } from '../../../screens/chat/components/v2/tool-entries'
import type { ChatMessage } from '../../../screens/chat/types'

/**
 * Skill + MCP tool calls for a WHOLE session, not just the newest page.
 *
 * The chat history endpoint is fetched with a fixed limit
 * (`DEFAULT_CHAT_HISTORY_LIMIT = 150`), so the header pills would otherwise
 * undercount — or lose the pill entirely — on long sessions. Only skill and
 * MCP calls are returned: those are the only panels whose counts are derived
 * from the whole session, and the Tools/Todos panels keep using the loaded
 * window.
 */

/** Gateway-side per-call ceiling; a larger `limit` is silently clamped. */
const PAGE_LIMIT = 500
/** Hard stop so a pathological session cannot spin forever. */
const MAX_PAGES = 40

/**
 * Strict Hermes Agent skill system tools, plus the catalog listing.
 * Mirrors the set in `skills-panel-v2.tsx` (SKILL_TOOLS) and the `skill`
 * branch of `categorizeEntry` in `tool-entries.ts`. Duplicated rather than
 * imported because both of those modules are read-only for this task.
 */
const SKILL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'skill',
  'skill_view',
  'skill_manage',
  'skills_list',
])

function isCountedEntry(entry: Pick<FlatToolEntry, 'name'>): boolean {
  return SKILL_TOOL_NAMES.has(entry.name.toLowerCase()) || isMcpToolEntry(entry)
}

export type SessionToolUsageEntry = {
  /** Gateway tool-call id; the join key against the loaded window. */
  callId: string
  name: string
  /** Parsed arguments (`unwrapToolInput`, so `{ value: "{...}" }` is unwrapped). */
  args?: Record<string, unknown>
  /**
   * Failure read from the matching tool-result message. `extractToolEntries`
   * already folds the result's explicit flag and `detectToolError` into this,
   * so the route never re-parses the output itself.
   */
  isError: boolean
}

/**
 * Every page of the session, newest first. The gateway clamps a single call to
 * 500 messages no matter what `limit` says, so one unbounded call silently
 * loses everything older than that window — page until a short page instead.
 */
async function getAllMessages(
  sessionKey: string,
  profile: string | null,
): Promise<Array<ClaudeMessage>> {
  const messages: Array<ClaudeMessage> = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await getMessages(
      sessionKey,
      { limit: PAGE_LIMIT, offset: page * PAGE_LIMIT, order: 'latest' },
      profile,
    )
    messages.push(...batch)
    if (batch.length < PAGE_LIMIT) break
  }
  return messages
}

export const Route = createFileRoute('/api/sessions/$sessionKey/tool-usage')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return Response.json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }

        const sessionKey = params.sessionKey.trim()
        if (!sessionKey || sessionKey === 'new') {
          return Response.json({ ok: true, entries: [] })
        }

        const profile = readProfile(
          new URL(request.url).searchParams.get('profile'),
        )

        try {
          const messages = await getAllMessages(sessionKey, profile)
          // Same conversion /api/history uses, so the shared parser sees the
          // exact shape it already handles.
          const chatMessages = messages.map((message, index) =>
            toChatMessage(message, { historyIndex: index }),
          ) as unknown as Array<ChatMessage>

          const entries: Array<SessionToolUsageEntry> = []
          for (const entry of extractToolEntries(chatMessages)) {
            if (!isCountedEntry(entry)) continue
            entries.push({
              callId: entry.callId,
              name: entry.name,
              args: unwrapToolInput(entry.input),
              isError: entry.isError === true,
            })
          }
          return Response.json({ ok: true, entries })
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              {
                ok: false,
                unavailable: true,
                error: (err as Error).message,
                profile,
              },
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
