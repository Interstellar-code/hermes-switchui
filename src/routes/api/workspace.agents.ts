import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { BUILTIN_AGENTS } from '../../lib/builtin-agents'

function mapBuiltinAgent(agent: (typeof BUILTIN_AGENTS)[number]) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    adapter_type: 'local',
    model: null,
    provider: 'Hermes',
    status: agent.status === 'active' ? 'online' : 'away',
    avatar: agent.glyph,
    avatar_tone:
      agent.id === 'hermes-switch'
        ? 'accent'
        : agent.id === 'neo'
          ? 'green'
          : agent.id === 'trinity'
            ? 'yellow'
            : 'primary',
    description: agent.description,
    system_prompt: agent.description,
    prompt_updated_at: new Date(0).toISOString(),
    limits: {
      max_tokens: 0,
      cost_label: 'local',
      concurrency_limit: agent.tier === 1 ? 4 : 1,
      memory_scope: agent.tier === 1 ? 'workspace' : 'agent',
    },
    capabilities: {
      repo_write: agent.id !== 'morpheus',
      shell_commands: true,
      git_operations: agent.id === 'hermes-switch' || agent.id === 'neo',
      browser: agent.id === 'trinity',
      network: true,
    },
    assigned_projects: [],
    skills: agent.tags,
  }
}

function buildStats(agentId: string) {
  return {
    stats: {
      agent_id: agentId,
      runs_today: 0,
      tokens_today: 0,
      cost_cents_today: 0,
      success_rate: 0,
      avg_response_ms: null,
    },
  }
}

export const Route = createFileRoute('/api/workspace/agents')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const statsFor = url.searchParams.get('stats_for')?.trim()
        if (statsFor) return json(buildStats(statsFor))

        return json({ agents: BUILTIN_AGENTS.map(mapBuiltinAgent) })
      },
    },
  },
})
