import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

export type KnowledgeBaseSource =
  | { type: 'local'; path: string }
  | { type: 'github'; repo: string; branch: string; path: string }

export type KnowledgeBaseConfig = {
  source: KnowledgeBaseSource
}

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  source: { type: 'local', path: '' },
}

function getConfigPath(): string {
  const claudeHome =
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  return path.join(claudeHome, 'knowledge-config.json')
}

function expandHome(input: string): string {
  return input.replace(/^~(?=\/|$)/, os.homedir())
}

function resolveLocalPath(input: string): string {
  return path.resolve(expandHome(input.trim()))
}

function readHermesConfigValue(paths: Array<Array<string>>): string | null {
  const hermesHome = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')
  const configPath = path.join(hermesHome, 'config.yaml')
  try {
    if (!fs.existsSync(configPath)) return null
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object') return null

    for (const keyPath of paths) {
      let cursor: unknown = parsed
      for (const key of keyPath) {
        if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
          cursor = null
          break
        }
        cursor = (cursor as Record<string, unknown>)[key]
      }
      if (typeof cursor === 'string' && cursor.trim()) return cursor.trim()
    }
  } catch {
    // Ignore malformed config and fall through to other discovery paths.
  }
  return null
}

function firstExistingPath(candidates: Array<string>): string | null {
  for (const candidate of candidates) {
    const resolved = resolveLocalPath(candidate)
    if (fs.existsSync(resolved)) return resolved
  }
  return null
}

export function readKnowledgeBaseConfig(): KnowledgeBaseConfig {
  const configPath = getConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<KnowledgeBaseConfig>
      return {
        source: parsed.source ?? DEFAULT_CONFIG.source,
      }
    }
  } catch {
    // ignore parse errors, use default
  }
  return DEFAULT_CONFIG
}

export function writeKnowledgeBaseConfig(config: KnowledgeBaseConfig): void {
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function getKnowledgeBaseEffectiveRoot(): string {
  const config = readKnowledgeBaseConfig()
  if (config.source.type === 'local') {
    const p = config.source.path.trim()
    if (p) return resolveLocalPath(p)
  }

  // Canonical Hermes/LLM Wiki discovery order. `knowledge-config.json` remains
  // the explicit UI override, but the UI should also honor the same paths the
  // agent-side llm-wiki skill uses.
  if (process.env.WIKI_PATH) return resolveLocalPath(process.env.WIKI_PATH)
  if (process.env.KNOWLEDGE_DIR) return resolveLocalPath(process.env.KNOWLEDGE_DIR)

  const configuredWikiPath = readHermesConfigValue([
    ['knowledge', 'wiki_path'],
    ['llm_wiki', 'path'],
    ['llm_wiki', 'wiki_path'],
  ])
  if (configuredWikiPath) return resolveLocalPath(configuredWikiPath)

  const hermesWiki = firstExistingPath([
    '~/hermes/wikis/hermes-switchui',
    '~/hermes/wikis/hermes-workspace-ui',
    '~/hermes/wikis/workspace-ui',
  ])
  if (hermesWiki) return hermesWiki

  // Legacy Claude-ish fallbacks retained for backward compatibility.
  const claudeKnowledge = path.join(os.homedir(), '.claude', 'knowledge')
  if (fs.existsSync(claudeKnowledge)) return claudeKnowledge
  const homeKnowledge = path.join(os.homedir(), 'knowledge', 'wiki')
  if (fs.existsSync(homeKnowledge)) return homeKnowledge
  return claudeKnowledge
}
