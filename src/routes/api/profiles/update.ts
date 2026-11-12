import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readProfile, writeProfile } from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'
import { errorResponse } from './-error-response'
import type {
  AgentRuntime,
  AgentUIMetadata,
  McpServerConfig,
  MemoryConfig,
  ModelConfig,
  SkillsConfig,
} from '../../../server/profiles-browser'

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
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
            return Response.json({ error: 'Default profile cannot be modified' }, { status: 403 })
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

          let patch: Record<string, unknown>
          if (isLegacy) {
            if (
              !body.patch ||
              typeof body.patch !== 'object' ||
              Array.isArray(body.patch)
            ) {
              return Response.json(
                { error: 'patch is required' },
                { status: 400 },
              )
            }
            patch = body.patch
          } else {
            patch = {}
            if (body.description !== undefined)
              patch.description = body.description
            if (body.system_prompt !== undefined)
              patch.system_prompt = body.system_prompt
            if (body.model !== undefined) patch.model = body.model
            if (body.mcp_servers !== undefined)
              patch.mcp_servers = body.mcp_servers
            if (body.skills !== undefined) patch.skills = body.skills
            if (body.memory !== undefined) patch.memory = body.memory
            if (body.agent !== undefined) patch.agent = body.agent
            if (body.agent_ui !== undefined) {
              patch.agent_ui = body.agent_ui
            }
          }

          const agentUI = patch.agent_ui as Partial<AgentUIMetadata> | undefined
          const AGENT_UI_DENIED_KEYS = new Set(['status', 'builtin', 'id'])
          if (agentUI) {
            const disallowed = Object.keys(agentUI).filter((key) =>
              AGENT_UI_DENIED_KEYS.has(key),
            )
            if (disallowed.length > 0) {
              return Response.json(
                {
                  error: `agent_ui fields not allowed: ${disallowed.join(', ')}`,
                },
                { status: 400 },
              )
            }
          }

          if (agentUI?.tier !== undefined) {
            const existingTier = readProfile(name).config.agent_ui?.tier
            if (existingTier !== undefined && existingTier !== agentUI.tier) {
              return Response.json(
                { error: 'agent_ui.tier cannot be updated after creation' },
                { status: 400 },
              )
            }
          }

          // Guard: cannot update agent_ui.persona_id without a non-empty system_prompt
          if (
            agentUI?.persona_id != null &&
            agentUI.persona_id !== '' &&
            !(
              typeof patch.system_prompt === 'string' &&
              patch.system_prompt.trim()
            )
          ) {
            return Response.json(
              {
                error:
                  'system_prompt must be provided and non-empty when updating agent_ui.persona_id',
              },
              { status: 400 },
            )
          }

          if (!isLegacy && Object.keys(patch).length === 0) {
            return Response.json(
              { error: 'No fields to update' },
              { status: 400 },
            )
          }

          const profile = writeProfile(name, patch)
          return Response.json({ ok: true, profile })
        } catch (error) {
          return errorResponse(error, 'Failed to update profile')
        }
      },
    },
  },
})
