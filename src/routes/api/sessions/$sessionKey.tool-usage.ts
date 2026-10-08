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
 * The plain `skill` tool answers with the skill name, so its result text is the
 * only way to name the invocation. The name is an identifier a few chars long;
 * the cap is there so a verbose result can never ride along.
 */
const SKILL_OUTPUT_LIMIT = 200

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
   * Set for `skill` calls only, whose result text IS the skill name — the panel
   * resolves those names from the output, never from the args. Every other tool
   * omits it: a whole result body must never leave the server for a count.
   */
  output?: string
  /**
   * Failure read from the matching tool-result message. `extractToolEntries`
   * already folds the result's explicit flag and `detectToolError` into this,
   * so the route never re-parses the output itself.
   */
  isError: boolean
}

/** The `skill` tool's name is its result, so it is the one tool we ship output for. */
function skillResultOutput(entry: FlatToolEntry): string | undefined {
  if (entry.name !== 'skill') return undefined
  const text = entry.output?.trim()
  return text ? text.slice(0, SKILL_OUTPUT_LIMIT) : undefined
}

/** Gateway row id, used to stop a backend that ignores `offset`. */
function rowKey(message: ClaudeMessage): string | null {
  return typeof message.id === 'number' || typeof message.id === 'string'
    ? String(message.id)
    : null
}

/**
 * Every page of the session, newest first. The gateway clamps a single call to
 * 500 messages no matter what `limit` says, so one unbounded call silently
 * loses everything older than that window — page until a short page instead.
 * A page that adds no new row id stops the walk: that is a backend ignoring
 * `offset`, which would otherwise replay the same window 40 times.
 */
async function getAllMessages(
  sessionKey: string,
  profile: string | null,
): Promise<Array<ClaudeMessage>> {
  const messages: Array<ClaudeMessage> = []
  const seen = new Set<string>()
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await getMessages(
      sessionKey,
      { limit: PAGE_LIMIT, offset: page * PAGE_LIMIT, order: 'latest' },
      profile,
    )
    let added = 0
    for (const message of batch) {
      const key = rowKey(message)
      if (key) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      messages.push(message)
      added += 1
    }
    if (added === 0) break
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
              output: skillResultOutput(entry),
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
