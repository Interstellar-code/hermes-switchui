import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { BUILTIN_AGENTS } from '../lib/builtin-agents'
import { getProfilesRoot } from './profiles-browser'
import type { BuiltinAgent } from '../lib/builtin-agents'

let bootstrapped = false

/**
 * Resolve the builtin agent list to seed.
 *
 * Priority:
 *   1. `HERMES_BUILTIN_PROFILES_FILE` — JSON file with `BuiltinAgent[]`.
 *      Downstream forks point this at their own curated list.
 *   2. Compiled-in `BUILTIN_AGENTS` (hermes-switch, neo, trinity, morpheus).
 *
 * Invalid override → warns and falls back to the compiled-in list.
 */
function resolveBuiltinAgents(): Array<BuiltinAgent> {
  const override = process.env.HERMES_BUILTIN_PROFILES_FILE?.trim()
  if (!override) return BUILTIN_AGENTS
  try {
    const raw = fs.readFileSync(override, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('expected top-level JSON array')
    }
    return parsed as Array<BuiltinAgent>
  } catch (err) {
    console.warn(
      `[profiles-bootstrap] HERMES_BUILTIN_PROFILES_FILE="${override}" invalid — falling back to compiled defaults:`,
      err,
    )
    return BUILTIN_AGENTS
  }
}

/**
 * Ensures each builtin agent (hermes-switch, neo, trinity, morpheus) has a
 * disk profile at ~/.hermes/profiles/{id}/ with full layout:
 * - config.yaml
 * - SOUL.md, memories/MEMORY.md, memories/USER.md
 * - memory/IDENTITY.md
 * - .env (empty)
 * - sessions/, skills/ directories
 *
 * Each file is guarded by fs.existsSync — never overwrites user-customized content.
 * Safe to call multiple times — idempotent per-file, not per-profile.
 *
 * Opt-out for downstream forks:
 *   - `HERMES_SKIP_PROFILE_BOOTSTRAP=1` — skip bootstrap entirely.
 *   - `HERMES_BUILTIN_PROFILES_FILE=/path/to/agents.json` — replace the
 *     compiled-in list with a custom `BuiltinAgent[]`.
 */
export function ensureBuiltinProfiles(): void {
  if (bootstrapped) return
  bootstrapped = true

  if (process.env.HERMES_SKIP_PROFILE_BOOTSTRAP === '1') {
    return
  }

  const agents = resolveBuiltinAgents()
  if (agents.length === 0) return

  const profilesRoot = getProfilesRoot()
  try {
    fs.mkdirSync(profilesRoot, { recursive: true })
  } catch {
    // ignore — likely already exists
  }

  for (const agent of agents) {
    const profileDir = path.join(profilesRoot, agent.id)

    try {
      // Create base directories
      fs.mkdirSync(profileDir, { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'skills'), { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'sessions'), { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'memory'), { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'memories'), { recursive: true })

      // Write each profile file independently, guarded by existence check
      ensureConfigYaml(profileDir, agent)
      ensureSoulMd(profileDir, agent)
      ensureMemoryMd(profileDir, agent)
      ensureUserMd(profileDir, agent)
      ensureIdentityMd(profileDir, agent)
      ensureEnvFile(profileDir)
    } catch (err) {
      console.warn(
        `[profiles-bootstrap] Failed to create builtin profile "${agent.id}":`,
        err,
      )
    }
  }
}

/**
 * Write config.yaml if it doesn't exist. Contains model config and agent UI metadata.
 */
function ensureConfigYaml(profileDir: string, agent: BuiltinAgent): void {
  const configPath = path.join(profileDir, 'config.yaml')
  if (fs.existsSync(configPath)) return

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
}

/**
 * Write SOUL.md if it doesn't exist. Persona document for the agent.
 */
function ensureSoulMd(profileDir: string, agent: BuiltinAgent): void {
  const soulPath = path.join(profileDir, 'SOUL.md')
  if (fs.existsSync(soulPath)) return

  const defaultPersona = getDefaultPersona(agent)
  const tags = agent.tags.join(', ')
  const content = `# ${agent.name} — SOUL

**Role:** ${agent.role}
**Tier:** T${agent.tier}
**Tags:** ${tags}

## Persona

${defaultPersona}

## Operating principles

- Stay aligned with role and tier responsibilities
- Defer to user on scope changes
- Preserve user-customized files and configurations
`

  fs.writeFileSync(soulPath, content, 'utf-8')
}

/**
 * Write MEMORY.md if it doesn't exist. Stub for long-term agent memory.
 */
function ensureMemoryMd(profileDir: string, agent: BuiltinAgent): void {
  const memoryPath = path.join(profileDir, 'memories', 'MEMORY.md')
  if (fs.existsSync(memoryPath)) return

  const content = `# ${agent.name} — MEMORY

This file tracks long-term notes and learnings the agent has written.
`

  fs.writeFileSync(memoryPath, content, 'utf-8')
}

/**
 * Write USER.md if it doesn't exist. Stub for user profile as known by the agent.
 */
function ensureUserMd(profileDir: string, agent: BuiltinAgent): void {
  const userPath = path.join(profileDir, 'memories', 'USER.md')
  if (fs.existsSync(userPath)) return

  const content = `# User profile (as known by ${agent.name})

This file is populated by the memory system over time.
`

  fs.writeFileSync(userPath, content, 'utf-8')
}

/**
 * Write memory/IDENTITY.md if it doesn't exist. Identity scaffold for the agent.
 */
function ensureIdentityMd(profileDir: string, agent: BuiltinAgent): void {
  const identityPath = path.join(profileDir, 'memory', 'IDENTITY.md')
  if (fs.existsSync(identityPath)) return

  const content = `# Identity — ${agent.name}

- Name: ${agent.name}
- Role: ${agent.role}
- Glyph: ${agent.glyph}
`

  fs.writeFileSync(identityPath, content, 'utf-8')
}

/**
 * Write .env (empty) if it doesn't exist. Reserved for environment variables.
 */
function ensureEnvFile(profileDir: string): void {
  const envPath = path.join(profileDir, '.env')
  if (fs.existsSync(envPath)) return

  fs.writeFileSync(envPath, '', 'utf-8')
}

/**
 * Return a default persona line based on agent role and tier.
 */
function getDefaultPersona(agent: BuiltinAgent): string {
  if (agent.tier === 1) {
    return `You are ${agent.name}, the tier-1 orchestration agent. You route tasks across tier-2 specialist agents and manage overall system flow.`
  }

  // Tier 2 — customize per role
  switch (agent.role) {
    case 'Builder':
      return `You are ${agent.name}, a tier-2 specialist focused on implementation. You build features decisively, write tests, and maintain code quality.`
    case 'Investigator':
      return `You are ${agent.name}, a tier-2 specialist focused on debugging and verification. You trace issues, isolate root causes, and validate solutions.`
    case 'Architect':
      return `You are ${agent.name}, a tier-2 specialist focused on design and long-term coherence. You review architectures, plan systems, and ensure sustainability.`
    default:
      return `You are ${agent.name}, a tier-2 specialist in the ${agent.role.toLowerCase()} role.`
  }
}
