import { createFileRoute } from '@tanstack/react-router'
import {
  ensureGatewayProbed,
  getConfigCached,
  getGatewayCapabilities,
  getSession,
  listSessions,
} from '../../server/hermes-api'
import { isSyntheticSessionKey } from '../../server/session-utils'
import { getLocalSession } from '../../server/local-session-store'
import { isAuthenticated } from '@/server/auth-middleware'
import { readContextUsage } from '@/server/context-usage'

export const Route = createFileRoute('/api/session-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        let requestedKey = ''
        try {
          const capabilities = getGatewayCapabilities()
          if (!capabilities.sessions) {
            return Response.json({
              ok: true,
              payload: {
                status: 'idle',
                sessionKey: 'new',
                sessionLabel: '',
                model: '',
                modelProvider: '',
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                sessions: [],
              },
            })
          }
          const url = new URL(request.url)
          requestedKey = url.searchParams.get('sessionKey')?.trim() || ''
          const sessionKey = requestedKey || 'new'

          if (sessionKey === 'new') {
            return Response.json({
              ok: true,
              payload: {
                status: 'idle',
                sessionKey: 'new',
                sessionLabel: '',
                model: '',
                modelProvider: '',
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                contextPercent: 0,
                maxTokens: 0,
                usedTokens: 0,
                sessions: [],
              },
            })
          }

          if (isSyntheticSessionKey(sessionKey)) {
            return Response.json({
              ok: true,
              payload: {
                status: 'idle',
                sessionKey,
                sessionLabel: '',
                model: '',
                modelProvider: '',
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                contextPercent: 0,
                maxTokens: 0,
                usedTokens: 0,
                sessions: [],
              },
            })
          }

          const localSession = getLocalSession(sessionKey)
          if (localSession) {
            const contextUsage = await readContextUsage(sessionKey)
            return Response.json({
              ok: true,
              payload: {
                status: 'idle',
                sessionKey,
                sessionLabel: localSession.title ?? '',
                model: localSession.model ?? contextUsage.model,
                modelProvider: 'local',
                inputTokens: contextUsage.usedTokens,
                outputTokens: 0,
                totalTokens: contextUsage.usedTokens,
                contextPercent: contextUsage.contextPercent,
                maxTokens: contextUsage.maxTokens,
                usedTokens: contextUsage.usedTokens,
                sessions: [],
              },
            })
          }

          const session = await getSession(sessionKey)
          const config = capabilities.config
            ? await getConfigCached()
            : ({ model: '', provider: '' } as const)

          const inputTokens = session.input_tokens ?? 0
          const outputTokens = session.output_tokens ?? 0
          const contextUsage = await readContextUsage(session.id)

          return Response.json({
            ok: true,
            payload: {
              status: session.ended_at ? 'ended' : 'idle',
              sessionKey: session.id,
              sessionLabel: session.title ?? '',
              model: session.model ?? config.model ?? '',
              modelProvider: config.provider ?? '',
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              cost: session.actual_cost_usd ?? session.estimated_cost_usd ?? 0,
              estimatedCost: session.estimated_cost_usd ?? 0,
              cacheReadTokens: session.cache_read_tokens ?? 0,
              cacheWriteTokens: session.cache_write_tokens ?? 0,
              reasoningTokens: session.reasoning_tokens ?? 0,
              apiCallCount: session.api_call_count ?? 0,
              source: session.source ?? '',
              endReason: session.end_reason ?? '',
              contextPercent: contextUsage.contextPercent,
              maxTokens: contextUsage.maxTokens,
              usedTokens: contextUsage.usedTokens,
              sessions: [
                {
                  key: session.id,
                  agentId: session.id,
                  label: session.title ?? session.id,
                  model: session.model ?? config.model ?? '',
                  modelProvider: config.provider ?? '',
                  updatedAt: session.last_active ?? session.started_at ?? 0,
                  usage: {
                    input: inputTokens,
                    output: outputTokens,
                  },
                },
              ],
            },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // Gateway returns 404 when the session no longer exists — surface that
          // as a graceful empty payload so clients stop retrying with backoff.
          if (/:\s*404\b/.test(msg)) {
            return Response.json({
              ok: true,
              payload: {
                status: 'idle',
                sessionKey: requestedKey || 'new',
                sessionLabel: '',
                model: '',
                modelProvider: '',
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                sessions: [],
              },
            })
          }
          return Response.json(
            { ok: false, error: msg },
            { status: 503 },
          )
        }
      },
    },
  },
})
