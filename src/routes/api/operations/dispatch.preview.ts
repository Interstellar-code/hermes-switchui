import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'

interface PreviewRequest {
  prompt?: string
  mode?: string
}

interface RoutingStep {
  num: number
  agent: string
  desc: string
  conf: string
  variant?: 'warn' | 'ok'
}

interface PreviewResponse {
  steps: Array<RoutingStep>
  estCost: string
  estTime: string
}

function buildPreview(prompt: string, mode: string): PreviewResponse {
  const tokens = Math.min(prompt.length * 8, 25_000)
  const tokLabel =
    tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tok` : `${tokens} tok`
  const minutes = Math.max(1, Math.ceil(tokens / 5_000))
  const estTime = `~${minutes}m`

  const steps: Array<RoutingStep> = [
    { num: 1, agent: 'sage', desc: 'plan · decompose goal', conf: '98%', variant: 'ok' },
    {
      num: 2,
      agent: 'neo',
      desc: `scan · ${mode === 'broadcast' ? 'all workers' : 'selected workers'}`,
      conf: '91%',
    },
    { num: 3, agent: 'workspace', desc: 'context · load relevant files', conf: '85%' },
    { num: 4, agent: 'drift', desc: 'review · verify outputs', conf: '79%' },
  ]

  return { steps, estCost: tokLabel, estTime }
}

export const Route = createFileRoute('/api/operations/dispatch/preview')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const body = (await request.json().catch(() => ({}))) as PreviewRequest
        const preview = buildPreview(body.prompt ?? '', body.mode ?? 'auto')
        return json(preview)
      },
    },
  },
})
