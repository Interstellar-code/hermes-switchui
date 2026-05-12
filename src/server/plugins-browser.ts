import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getClaudeRoot, getWorkspaceClaudeHome } from './claude-paths'

// ── Inline plugin types (formerly swarm-foundation) ──────────────────────────

export type PluginBoundary = 'workspace-only' | 'worker-only' | 'both'
export type PluginScope = string

export type SwarmPluginDescriptor = {
  name: string
  version: string
  description: string
  source: string
  enabled: boolean
  manifestPath: string
  runtimeScopes: Array<PluginScope>
  workspaceScopes: Array<PluginScope>
  workerScopes: Array<PluginScope>
  boundary: PluginBoundary
  validationErrors: Array<string>
  error?: string
}

type PluginRoot = { root: string; source: string }

function getWorkspacePluginRoots(): Array<PluginRoot> {
  const roots: Array<PluginRoot> = []
  try {
    const hermesRoot = getClaudeRoot()
    roots.push({ root: path.join(hermesRoot, 'plugins'), source: 'hermes' })
  } catch { /* noop */ }
  try {
    const wsHome = getWorkspaceClaudeHome()
    roots.push({ root: path.join(wsHome, 'plugins'), source: 'workspace' })
  } catch { /* noop */ }
  return roots
}

type RawManifest = {
  name?: unknown
  version?: unknown
  description?: unknown
  enabled?: unknown
  boundary?: unknown
  scopes?: {
    runtime?: unknown
    workspace?: unknown
    workers?: unknown
  }
}

function parseSwarmPluginManifest({ manifestPath, source }: { manifestPath: string; source: string }): SwarmPluginDescriptor {
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const manifest = parseYaml(raw) as RawManifest
  const validationErrors: Array<string> = []

  const name = typeof manifest.name === 'string' ? manifest.name.trim() : ''
  if (!name) validationErrors.push('missing name')

  const version = typeof manifest.version === 'string' ? manifest.version.trim() : ''
  const description = typeof manifest.description === 'string' ? manifest.description.trim() : ''
  const enabled = manifest.enabled !== false

  const boundary: PluginBoundary =
    manifest.boundary === 'worker-only' ? 'worker-only'
    : manifest.boundary === 'both' ? 'both'
    : 'workspace-only'

  const toStringArray = (v: unknown): Array<string> =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  const runtimeScopes = toStringArray(manifest.scopes?.runtime)
  const workspaceScopes = toStringArray(manifest.scopes?.workspace)
  const workerScopes = toStringArray(manifest.scopes?.workers)

  if (workerScopes.length === 0 && runtimeScopes.length === 0 && workspaceScopes.length === 0) {
    // default to all workers if no scopes specified
  }

  return {
    name: name || path.basename(path.dirname(manifestPath)),
    version,
    description,
    source,
    enabled,
    manifestPath,
    runtimeScopes,
    workspaceScopes,
    workerScopes: workerScopes.length > 0 ? workerScopes : ['all'],
    boundary,
    validationErrors,
  }
}

export type WorkspacePluginInfo = SwarmPluginDescriptor

export function listWorkspacePlugins(): Array<WorkspacePluginInfo> {
  const items: Array<WorkspacePluginInfo> = []

  for (const { root, source } of getWorkspacePluginRoots()) {
    if (!fs.existsSync(root)) continue
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pluginDir = path.join(root, entry.name)
      const manifestPath = fs.existsSync(path.join(pluginDir, 'plugin.yaml'))
        ? path.join(pluginDir, 'plugin.yaml')
        : fs.existsSync(path.join(pluginDir, 'plugin.yml'))
          ? path.join(pluginDir, 'plugin.yml')
          : ''
      if (!manifestPath) continue
      try {
        items.push(parseSwarmPluginManifest({ manifestPath, source }))
      } catch (error) {
        items.push({
          name: entry.name,
          version: '',
          description: '',
          source,
          enabled: false,
          manifestPath,
          runtimeScopes: [],
          workspaceScopes: [],
          workerScopes: ['all'],
          boundary: 'workspace-only',
          validationErrors: ['manifest parse failed'],
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name))
  return items
}

export function formatWorkspacePluginsMessage(): string {
  const plugins = listWorkspacePlugins()
  if (plugins.length === 0) return 'No plugins installed.'
  const lines = [`Plugins (${plugins.length}):`]
  for (const plugin of plugins) {
    const status = plugin.enabled ? '✓' : '✗'
    const version = plugin.version ? ` v${plugin.version}` : ''
    const source = plugin.source ? ` [${plugin.source}]` : ''
    const description = plugin.description ? ` — ${plugin.description}` : ''
    const boundary = ` <${plugin.boundary}>`
    const scopes = [
      plugin.runtimeScopes.length > 0
        ? `runtime=${plugin.runtimeScopes.join(',')}`
        : '',
      plugin.workspaceScopes.length > 0
        ? `workspace=${plugin.workspaceScopes.join(',')}`
        : '',
      plugin.workerScopes.length > 0
        ? `workers=${plugin.workerScopes.join(',')}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const validation =
      plugin.validationErrors.length > 0
        ? ` [${plugin.validationErrors.join('; ')}]`
        : ''
    const error = plugin.error ? ` (${plugin.error})` : ''
    lines.push(
      `  ${status} ${plugin.name}${version}${source}${boundary}${description}${scopes ? ` — ${scopes}` : ''}${validation}${error}`,
    )
  }
  return lines.join('\n')
}
