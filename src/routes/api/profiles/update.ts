import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  writeProfile,
  type AgentRuntime,
  type AgentUIMetadata,
  type MemoryConfig,
  type McpServerConfig,
  type ModelConfig,
  type SkillsConfig,
} from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'

type UpdateBody = {
  name?: string
  description?: string
  system_prompt?: string
  model?: ModelConfig | string
  mcp_servers?: Record<string, McpServerConfig>
  skills?: SkillsConfig
  memory?: MemoryConfig
  agent?: AgentRuntime
  agent_ui?: Partial<AgentUIMetadata>
}

export const Route = createFileRoute('/api/profiles/update')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as UpdateBody & {
            // legacy envelope kept for back-compat
            patch?: Record<string, unknown>
          }

          const name = (body.name || '').trim()
          if (name === 'default') {
            return json({ error: 'Default profile cannot be modified' }, { status: 403 })
          }

          // Support legacy { name, patch } envelope alongside new flat shape
          const isLegacy =
            body.patch !== undefined &&
            typeof body.patch === 'object' &&
            !body.agent_ui &&
            !body.agent &&
            !body.description &&
            !body.system_prompt &&
            !body.model &&
            !body.mcp_servers &&
            !body.skills &&
            !body.memory

          if (isLegacy) {
            if (!body.patch || typeof body.patch !== 'object') {
              return json({ error: 'patch is required' }, { status: 400 })
            }
            const profile = writeProfile(name, body.patch as Record<string, unknown>)
            return json({ ok: true, profile })
          }

          // Guard: cannot update agent_ui.tier
          if (body.agent_ui?.tier !== undefined) {
            return json(
              { error: 'agent_ui.tier cannot be updated after creation' },
              { status: 400 },
            )
          }

          // Guard: cannot update agent_ui.persona_id without a non-empty system_prompt
          if (
            body.agent_ui?.persona_id != null &&
            body.agent_ui.persona_id !== '' &&
            !body.system_prompt?.trim()
          ) {
            return json(
              {
                error:
                  'system_prompt must be provided and non-empty when updating agent_ui.persona_id',
              },
              { status: 400 },
            )
          }

          const patch: Record<string, unknown> = {}
          if (body.description !== undefined) patch.description = body.description
          if (body.system_prompt !== undefined) patch.system_prompt = body.system_prompt
          if (body.model !== undefined) patch.model = body.model
          if (body.mcp_servers !== undefined) patch.mcp_servers = body.mcp_servers
          if (body.skills !== undefined) patch.skills = body.skills
          if (body.memory !== undefined) patch.memory = body.memory
          if (body.agent !== undefined) patch.agent = body.agent
          if (body.agent_ui !== undefined) patch.agent_ui = body.agent_ui

          if (Object.keys(patch).length === 0) {
            return json({ error: 'No fields to update' }, { status: 400 })
          }

          const profile = writeProfile(name, patch)
          return json({ ok: true, profile })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to update profile',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
