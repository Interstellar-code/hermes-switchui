import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { isWithinRealRoot } from './path-containment'

export type KnowledgeBaseSource =
  | { type: 'local'; path: string }
  | { type: 'github'; repo: string; branch: string; path: string }

export type KnowledgeBaseConfig = {
  source: KnowledgeBaseSource
}

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  source: { type: 'local', path: '' },
}

function getHermesHome(): string {
  return path.resolve(
    process.env.HERMES_HOME ??
      process.env.CLAUDE_HOME ??
      path.join(os.homedir(), '.hermes'),
  )
}

function getConfigPath(): string {
  return path.join(getHermesHome(), 'knowledge-config.json')
}

function expandHome(input: string): string {
  return input.replace(/^~(?=\/|$)/, os.homedir())
}

function resolveLocalPath(input: string): string {
  return path.resolve(expandHome(input.trim()))
}

function readHermesConfigValue(paths: Array<Array<string>>): string | null {
  const hermesHome = getHermesHome()
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

function getMatrixMemoryWikiRoot(): string | null {
  return firstExistingPath([
    path.join(
      getHermesHome(),
      'profiles',
      'hermes-switch',
      'matrix-memory',
      'wiki',
    ),
  ])
}

function isLegacyHermesWikiPath(candidate: string): boolean {
  const resolved = resolveLocalPath(candidate)
  const legacyRoot = path.resolve(path.join(os.homedir(), 'hermes', 'wikis'))
  return (
    resolved === legacyRoot || resolved.startsWith(`${legacyRoot}${path.sep}`)
  )
}

function normalizeKnowledgeBaseConfig(
  config: KnowledgeBaseConfig,
): KnowledgeBaseConfig {
  if (config.source.type !== 'local') return config

  const localPath = config.source.path.trim()
  if (!localPath) return config

  const resolved = resolveLocalPath(localPath)
  const matrixMemoryWikiRoot = getMatrixMemoryWikiRoot()
  if (matrixMemoryWikiRoot && isLegacyHermesWikiPath(resolved)) {
    return {
      source: { type: 'local', path: matrixMemoryWikiRoot },
    }
  }

  return {
    source: { type: 'local', path: resolved },
  }
}

export function readKnowledgeBaseConfig(): KnowledgeBaseConfig {
  const configPath = getConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<KnowledgeBaseConfig>
      return normalizeKnowledgeBaseConfig({
        source: parsed.source ?? DEFAULT_CONFIG.source,
      })
    }
  } catch {
    // ignore parse errors, use default
  }
  return normalizeKnowledgeBaseConfig(DEFAULT_CONFIG)
}

export function writeKnowledgeBaseConfig(config: KnowledgeBaseConfig): void {
  const source = config.source as { type?: unknown; path?: unknown } | undefined
  if (source?.type === 'local') {
    if (typeof source.path !== 'string')
      throw new Error('Invalid config: source.path must be a string')
    if (source.path.trim() && !isAllowedLocalKnowledgePath(source.path))
      throw new Error(
        'Wiki path not allowed: use $HERMES_HOME/wikis, a profile matrix-memory/wiki, or the default wiki root',
      )
  }
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
  return getDefaultKnowledgeRoot()
}

/**
 * A user-configured local wiki path must resolve (symlinks followed on the
 * deepest existing ancestor) into a dedicated wiki subtree — otherwise
 * `/api/knowledge/write` could write `.md` anywhere, e.g. skills/x/SKILL.md or
 * profiles/<p>/SOUL.md. Inside $HERMES_HOME only `wikis/` and
 * `profiles/<p>/matrix-memory/wiki` qualify (never HERMES_HOME itself);
 * outside it, only the auto-discovered default wiki root.
 */
export function isAllowedLocalKnowledgePath(input: string): boolean {
  const resolved = resolveLocalPath(input)
  const home = getHermesHome()
  if (isWithinRealRoot(path.join(home, 'wikis'), resolved)) return true
  const [top, profile, mm, wiki] = path.relative(home, resolved).split(path.sep)
  if (
    top === 'profiles' &&
    profile &&
    profile !== '..' &&
    mm === 'matrix-memory' &&
    wiki === 'wiki' &&
    isWithinRealRoot(path.join(home, top, profile, mm, wiki), resolved)
  )
    return true
  // Anything else that lands in HERMES_HOME (skills/, memory/, SOUL.md, …) is
  // off-limits even if the default root happens to point there.
  if (isWithinRealRoot(home, resolved)) return false
  return isWithinRealRoot(getDefaultKnowledgeRoot(), resolved)
}

function getDefaultKnowledgeRoot(): string {
  // Canonical Hermes/LLM Wiki discovery order. `knowledge-config.json` remains
  // the explicit UI override, but the UI should also honor the same paths the
  // agent-side llm-wiki skill uses.
  if (process.env.WIKI_PATH) return resolveLocalPath(process.env.WIKI_PATH)
  if (process.env.KNOWLEDGE_DIR)
    return resolveLocalPath(process.env.KNOWLEDGE_DIR)

  const matrixMemoryWikiRoot = getMatrixMemoryWikiRoot()
  if (matrixMemoryWikiRoot) return matrixMemoryWikiRoot

  const configuredWikiPath = readHermesConfigValue([
    ['knowledge', 'wiki_path'],
    ['llm_wiki', 'path'],
    ['llm_wiki', 'wiki_path'],
  ])
  if (configuredWikiPath) return resolveLocalPath(configuredWikiPath)

  const hermesWiki = firstExistingPath([
    '~/hermes/wikis/hermes-switchui',
    '~/hermes/wikis/hermes-switchui-ui',
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
