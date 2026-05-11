import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import YAML from 'yaml'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  createProfile,
  getProfilesRoot,
  writeProfile,
  type AgentRuntime,
  type AgentUIMetadata,
  type MemoryConfig,
  type McpServerConfig,
  type ModelConfig,
  type SkillsConfig,
} from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'

const GLYPH_RE = /^[A-Z0-9]{1,3}$/

export const Route = createFileRoute('/api/profiles/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            name?: string
            cloneFrom?: string
            // legacy fields (kept for back-compat)
            model?: string | ModelConfig
            provider?: string
            // new extended fields (PR-05 / WIZ-10)
            description?: string
            system_prompt?: string
            mcp_servers?: Record<string, McpServerConfig>
            skills?: SkillsConfig
            memory?: MemoryConfig
            agent?: AgentRuntime
            agent_ui?: AgentUIMetadata
          }

          // Validate agent_ui.tier must be 3 if provided
          if (body.agent_ui?.tier !== undefined && body.agent_ui.tier !== 3) {
            return json(
              { error: 'agent_ui.tier must be 3 for user-created profiles' },
              { status: 400 },
            )
          }

          // Validate agent_ui.glyph format
          if (
            body.agent_ui?.glyph !== undefined &&
            !GLYPH_RE.test(body.agent_ui.glyph)
          ) {
            return json(
              { error: 'agent_ui.glyph must match ^[A-Z0-9]{1,3}$' },
              { status: 400 },
            )
          }

          // If persona_id set, system_prompt must be non-empty
          if (
            body.agent_ui?.persona_id != null &&
            body.agent_ui.persona_id !== '' &&
            !body.system_prompt?.trim()
          ) {
            return json(
              {
                error:
                  'system_prompt must be non-empty when agent_ui.persona_id is set',
              },
              { status: 400 },
            )
          }

          // Resolve legacy model/provider into ModelConfig shape
          let resolvedModel: ModelConfig | string | undefined
          if (
            body.model &&
            typeof body.model === 'object' &&
            !Array.isArray(body.model)
          ) {
            resolvedModel = body.model as ModelConfig
          } else if (typeof body.model === 'string') {
            resolvedModel = body.model
          }

          // Create base profile (handles dir creation + basic config scaffold)
          const cloneFrom = body.cloneFrom
          const legacyModel =
            typeof resolvedModel === 'string' ? resolvedModel : undefined
          const legacyProvider =
            typeof resolvedModel !== 'string'
              ? (resolvedModel?.provider ?? body.provider)
              : body.provider
          const profile = createProfile(body.name || '', {
            cloneFrom,
            model: legacyModel,
            provider: legacyProvider,
          })

          // Remove stray top-level `provider` key when nested model.provider is set.
          // createProfile() may have written a legacy flat `provider:` via its scaffold;
          // the gateway prefers the nested model.provider form.
          if (
            resolvedModel &&
            typeof resolvedModel === 'object' &&
            (resolvedModel as ModelConfig).provider
          ) {
            const configPath = path.join(
              getProfilesRoot(),
              profile.name,
              'config.yaml',
            )
            if (fs.existsSync(configPath)) {
              const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
              if (parsed && 'provider' in parsed) {
                delete parsed.provider
                fs.writeFileSync(configPath, YAML.stringify(parsed), 'utf-8')
              }
            }
          }

          // Build extended patch with all new fields
          const patch: Record<string, unknown> = {}
          if (body.description !== undefined) patch.description = body.description
          if (body.system_prompt !== undefined) patch.system_prompt = body.system_prompt
          if (resolvedModel && typeof resolvedModel === 'object') patch.model = resolvedModel
          if (body.mcp_servers !== undefined) patch.mcp_servers = body.mcp_servers
          if (body.skills !== undefined) patch.skills = body.skills
          if (body.memory !== undefined) patch.memory = body.memory
          if (body.agent !== undefined) patch.agent = body.agent
          if (body.agent_ui !== undefined) patch.agent_ui = body.agent_ui

          if (Object.keys(patch).length > 0) {
            const updated = writeProfile(profile.name, patch)
            return json({ ok: true, profile: updated })
          }

          return json({ ok: true, profile })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to create profile',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
