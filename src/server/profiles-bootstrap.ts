import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { BUILTIN_AGENTS } from '../lib/builtin-agents'
import { getProfilesRoot } from './profiles-browser'

let bootstrapped = false

/**
 * Ensures each builtin agent (hermes-switch, neo, trinity, morpheus) has a
 * disk profile at ~/.hermes/profiles/{id}/config.yaml so that hermes-agent's
 * /api/profiles endpoint discovers them.
 *
 * Safe to call multiple times — idempotent after first successful run.
 */
export function ensureBuiltinProfiles(): void {
  if (bootstrapped) return
  bootstrapped = true

  const profilesRoot = getProfilesRoot()
  try {
    fs.mkdirSync(profilesRoot, { recursive: true })
  } catch {
    // ignore — likely already exists
  }

  for (const agent of BUILTIN_AGENTS) {
    const profileDir = path.join(profilesRoot, agent.id)
    const configPath = path.join(profileDir, 'config.yaml')

    if (fs.existsSync(configPath)) continue

    try {
      fs.mkdirSync(profileDir, { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'skills'), { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'sessions'), { recursive: true })

      const config = {
        description: agent.description,
        model: {
          default: 'auto',
          provider: 'manifest',
        },
        providers: {
          manifest: {
            type: 'openai',
            base_url: '',
            key_env: 'CUSTOM_API_KEY',
          },
        },
        agent_ui: {
          tier: agent.tier,
          glyph: agent.glyph,
          role: agent.role,
          status: agent.status,
          tags: agent.tags,
          persona_id: null,
          last_run: null,
        },
      }

      fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8')
    } catch (err) {
      console.warn(
        `[profiles-bootstrap] Failed to create builtin profile "${agent.id}":`,
        err,
      )
    }
  }
}
