/**
 * Hermes Config API — read/write ~/.hermes/config.yaml and ~/.hermes/.env
 * Gives the web UI the same config power as `hermes setup`
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import YAML from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getCapabilities,
} from '../../server/gateway-capabilities'
import { requireJsonContentType } from '../../server/rate-limit'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'
import {
  PROVIDER_CATALOG,
  getProviderEnvKey,
  getProviderEnvKeys,
  normalizeProviderId,
} from '@/lib/provider-catalog'

type AuthResult = Response | true

const CLAUDE_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  path.join(os.homedir(), '.hermes')
const CONFIG_PATH = path.join(CLAUDE_HOME, 'config.yaml')
const ENV_PATH = path.join(CLAUDE_HOME, '.env')

type ProviderStatusEntry = {
  id: string
  name: string
  authType: 'api_key' | 'oauth' | 'none'
  envKeys: Array<string>
}

/**
 * Known Hermes providers, derived from the shared catalog so this route and
 * the UI can never disagree about which providers exist or which env var
 * holds their key. Previously a hardcoded 12-entry list that capped what the
 * provider UI could report on.
 */
const PROVIDERS: Array<ProviderStatusEntry> = [
  ...PROVIDER_CATALOG.map((provider) => ({
    id: provider.id,
    name: provider.name,
    authType: provider.authTypes.includes('api-key')
      ? ('api_key' as const)
      : provider.authTypes.includes('oauth') ||
          provider.authTypes.includes('cli-token')
        ? ('oauth' as const)
        : ('none' as const),
    envKeys: getProviderEnvKeys(provider.id),
  })),
  // Legacy: installs created before `manifest` was the recommended id still
  // carry a `custom` provider. The gateway cannot resolve it, but its key is
  // real and must keep showing up as configured.
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible (legacy)',
    authType: 'api_key',
    envKeys: ['CUSTOM_API_KEY'],
  },
]

function readConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = YAML.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function writeConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(CLAUDE_HOME, { recursive: true })
  const serialized = YAML.stringify(config)

  // Keep the previous revision recoverable — this file holds the only copy of
  // a user's provider setup.
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`)
    }
  } catch {
    // A failed backup must not block the write.
  }

  // Write-then-rename: a crash mid-write cannot leave a truncated config.yaml.
  const tmpPath = `${CONFIG_PATH}.tmp`
  fs.writeFileSync(tmpPath, serialized, 'utf-8')
  fs.renameSync(tmpPath, CONFIG_PATH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Top-level config keys a provider delete is permitted to empty. */
const PROVIDER_WIRING_KEYS = new Set([
  'providers',
  'custom_providers',
  'model_aliases',
  'provider',
])

/** Find the real key in `providers`, which may not be normalized on disk. */
function findProviderKey(
  providers: Record<string, unknown>,
  id: string,
): string | null {
  for (const key of Object.keys(providers)) {
    if (normalizeProviderId(key) === id) return key
  }
  return null
}

function readEnv(): Record<string, string> {
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf-8')
    const env: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        let value = trimmed.slice(eqIdx + 1).trim()
        // Strip quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        env[key] = value
      }
    }
    return env
  } catch {
    return {}
  }
}

/**
 * Apply key updates to ~/.hermes/.env, editing lines in place.
 *
 * A previous version serialised `Object.entries(env)` back out, which silently
 * destroyed every comment, blank line and commented-out example in the file —
 * a .env shipped with documentation would lose ~490 of its 500 lines the first
 * time a user saved an API key. Values were preserved, but the file was not.
 *
 * `null` or `''` deletes a key, matching the PATCH contract.
 */
function applyEnvUpdates(updates: Record<string, string | null>): void {
  fs.mkdirSync(CLAUDE_HOME, { recursive: true })

  let existing = ''
  try {
    existing = fs.readFileSync(ENV_PATH, 'utf-8')
  } catch {
    existing = ''
  }

  const lines = existing ? existing.split('\n') : []
  const pending = new Map(Object.entries(updates))

  const kept: Array<string> = []
  for (const line of lines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    const key = match?.[1]
    if (!key || !pending.has(key)) {
      kept.push(line)
      continue
    }
    const value = pending.get(key) ?? null
    pending.delete(key)
    // Deletion drops the line entirely; an update rewrites just that line.
    if (value !== null && value !== '') kept.push(`${key}=${value}`)
  }

  // Whatever is left is new — append it, keeping a trailing newline.
  const additions: Array<string> = []
  for (const [key, value] of pending) {
    if (value !== null && value !== '') additions.push(`${key}=${value}`)
  }
  if (additions.length > 0) {
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
    kept.push(...additions)
  }

  const body = kept.join('\n')
  fs.writeFileSync(ENV_PATH, body.endsWith('\n') ? body : `${body}\n`, 'utf-8')
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '***'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function checkAuthStore(providerId: string): {
  hasToken: boolean
  source: string
  maskedKey?: string
} {
  // Check Claude auth store
  const storePath = path.join(CLAUDE_HOME, 'auth-profiles.json')
  try {
    if (fs.existsSync(storePath)) {
      const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
      const profiles = store?.profiles || {}
      for (const [key, value] of Object.entries(profiles)) {
        if (!key.startsWith(`${providerId}:`)) continue
        if (typeof value !== 'object' || value === null) continue
        const p = value as Record<string, unknown>
        const token = String(p.token || p.key || p.access || '').trim()
        if (token) {
          return {
            hasToken: true,
            source: 'claude-auth-store',
            maskedKey: maskKey(token),
          }
        }
      }
    }
  } catch {}
  return { hasToken: false, source: '' }
}

export const Route = createFileRoute('/api/claude-config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        await ensureGatewayProbed()
        if (!getCapabilities().config) {
          return Response.json({
            ...createCapabilityUnavailablePayload('config'),
            config: {},
            providers: [],
            activeProvider: '',
            activeModel: '',
            claudeHome: CLAUDE_HOME,
          })
        }

        const config = readConfig()
        const env = readEnv()

        // Build provider status
        const providerStatus = PROVIDERS.map((p) => {
          // A provider with no env keys has no key *present* — it used to
          // report `true` here, which made every OAuth provider look
          // configured and sourced from `env`.
          const hasEnvKey = p.envKeys.some((k) => !!env[k])
          const authStoreCheck = checkAuthStore(p.id)
          const hasKey =
            hasEnvKey || authStoreCheck.hasToken || p.authType === 'none'
          const maskedKeys: Record<string, string> = {}
          for (const k of p.envKeys) {
            if (env[k]) maskedKeys[k] = maskKey(env[k])
          }
          if (authStoreCheck.hasToken && authStoreCheck.maskedKey) {
            maskedKeys['auth-store'] = authStoreCheck.maskedKey
          }
          return {
            ...p,
            configured: hasKey,
            authSource: authStoreCheck.hasToken
              ? authStoreCheck.source
              : hasEnvKey
                ? 'env'
                : 'none',
            maskedKeys,
          }
        })

        // Get active provider/model from config
        // Support both flat keys (model: "gpt-5.4", provider: "openai-codex")
        // and legacy nested format (model: { default: "...", provider: "..." })
        const modelField = config.model
        let activeModel = ''
        let activeProvider = ''
        if (typeof modelField === 'string') {
          activeModel = modelField
          activeProvider = (config.provider as string) || ''
        } else if (modelField && typeof modelField === 'object') {
          const modelObj = modelField as Record<string, unknown>
          activeModel = (modelObj.default as string) || ''
          activeProvider =
            (modelObj.provider as string) || (config.provider as string) || ''
        }

        return Response.json({
          config,
          providers: providerStatus,
          activeProvider,
          activeModel,
          claudeHome: CLAUDE_HOME,
        })
      },

      PATCH: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        await ensureGatewayProbed()
        if (!getCapabilities().config) {
          return new Response(
            JSON.stringify(
              createCapabilityUnavailablePayload('config', {
                error: 'Configuration updates are unavailable on this backend.',
              }),
            ),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const body = (await request.json()) as Record<string, unknown>

        // Handle config updates
        if (body.config && typeof body.config === 'object') {
          const current = readConfig()
          const updates = body.config as Record<string, unknown>

          // Deep merge
          function deepMerge(
            target: Record<string, unknown>,
            source: Record<string, unknown>,
          ) {
            for (const [key, value] of Object.entries(source)) {
              if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                target[key] &&
                typeof target[key] === 'object'
              ) {
                deepMerge(
                  target[key] as Record<string, unknown>,
                  value as Record<string, unknown>,
                )
              } else {
                target[key] = value
              }
            }
          }

          // Handle null values as explicit removals
          for (const [key, value] of Object.entries(updates)) {
            if (value === null) {
              delete current[key]
              delete updates[key]
            }
          }
          deepMerge(current, updates)
          writeConfig(current)
        }

        // Handle env var updates
        if (body.env && typeof body.env === 'object') {
          applyEnvUpdates(body.env as Record<string, string | null>)
        }

        return Response.json({
          ok: true,
          message:
            'Config saved to ~/.hermes/config.yaml. The Hermes Agent gateway only ' +
            'reads its config at startup, so restart it (re-run `hermes gateway run`, ' +
            'or `pnpm start:all` if you launched everything together) for the provider ' +
            'change to take effect.',
          requiresGatewayRestart: true,
        })
      },

      /**
       * Remove a provider. A narrow verb rather than a null-valued PATCH:
       * the deep merge above assigns nested nulls rather than deleting them
       * (it would poison config.yaml), and removing a provider means four
       * correlated edits that must land together or not at all.
       */
      DELETE: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult

        const contentTypeError = requireJsonContentType(request)
        if (contentTypeError) return contentTypeError

        await ensureGatewayProbed()
        if (!getCapabilities().config) {
          return Response.json(createCapabilityUnavailablePayload('config'), {
            status: 503,
          })
        }

        let body: { provider?: unknown; removeKey?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const rawId =
          typeof body.provider === 'string' ? body.provider.trim() : ''
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(rawId)) {
          return Response.json(
            { ok: false, error: 'Invalid provider id' },
            { status: 400 },
          )
        }
        const id = normalizeProviderId(rawId)

        const config = readConfig()
        const beforeKeys = Object.keys(config)

        const providers = isRecord(config.providers) ? config.providers : {}
        const providerKey = findProviderKey(providers, id)
        const customProviders = Array.isArray(config.custom_providers)
          ? config.custom_providers
          : []
        const matchesId = (entry: unknown) =>
          isRecord(entry) &&
          (normalizeProviderId(String(entry.id ?? '')) === id ||
            normalizeProviderId(String(entry.name ?? '')) === id)
        const inCustom = customProviders.some(matchesId)

        if (!providerKey && !inCustom) {
          // Never a silent success — the old UI's failure mode was a delete
          // that reported nothing and changed nothing.
          return Response.json(
            { ok: false, error: `Unknown provider: ${rawId}` },
            { status: 404 },
          )
        }

        // Resolve the credential env var before the entry disappears.
        const providerEntry = providerKey ? providers[providerKey] : null
        const keyEnv =
          (isRecord(providerEntry) && typeof providerEntry.key_env === 'string'
            ? providerEntry.key_env
            : null) ?? getProviderEnvKey(id)

        // 1. providers map
        if (providerKey) delete providers[providerKey]
        if (Object.keys(providers).length === 0) delete config.providers

        // 2. custom_providers array
        if (inCustom) {
          const remaining = customProviders.filter((entry) => !matchesId(entry))
          if (remaining.length === 0) delete config.custom_providers
          else config.custom_providers = remaining
        }

        // 3. model_aliases pointing at this provider
        if (isRecord(config.model_aliases)) {
          for (const [alias, value] of Object.entries(config.model_aliases)) {
            if (
              isRecord(value) &&
              normalizeProviderId(String(value.provider ?? '')) === id
            ) {
              delete config.model_aliases[alias]
            }
          }
          if (Object.keys(config.model_aliases).length === 0) {
            delete config.model_aliases
          }
        }

        // 4. active provider — hand off to a survivor rather than leaving a
        //    dangling reference the gateway cannot resolve.
        const survivor = isRecord(config.providers)
          ? (Object.keys(config.providers)[0] ?? null)
          : null
        let clearedActiveProvider = false
        if (
          isRecord(config.model) &&
          normalizeProviderId(String(config.model.provider ?? '')) === id
        ) {
          clearedActiveProvider = true
          if (survivor) config.model.provider = survivor
          else delete config.model.provider
        }
        if (
          typeof config.provider === 'string' &&
          normalizeProviderId(config.provider) === id
        ) {
          clearedActiveProvider = true
          if (survivor) config.provider = survivor
          else delete config.provider
        }

        // Guard: a provider delete may only ever empty the four keys that hold
        // provider wiring. Anything else disappearing means a bug in the code
        // above, and we would rather 500 than hand back a mangled config.
        // (An empty result is legitimate when those keys were all the file
        // held — a config.yaml containing nothing but one provider.)
        const droppedKeys = beforeKeys.filter((key) => !(key in config))
        const unexpectedDrop = droppedKeys.find(
          (key) => !PROVIDER_WIRING_KEYS.has(key),
        )
        if (unexpectedDrop) {
          return Response.json(
            {
              ok: false,
              error: `Refusing a delete that would remove unrelated key: ${unexpectedDrop}`,
            },
            { status: 500 },
          )
        }

        // 5. credential — opt-in, and never if another provider still uses it.
        let removedEnvKey: string | null = null
        if (body.removeKey === true && keyEnv) {
          const stillReferenced = Object.values(
            isRecord(config.providers) ? config.providers : {},
          ).some((entry) => isRecord(entry) && entry.key_env === keyEnv)
          if (!stillReferenced) {
            const env = readEnv()
            if (keyEnv in env) {
              applyEnvUpdates({ [keyEnv]: null })
              removedEnvKey = keyEnv
            }
          }
        }

        writeConfig(config)

        return Response.json({
          ok: true,
          removed: id,
          removedEnvKey,
          clearedActiveProvider,
          requiresGatewayRestart: true,
          message: `Removed ${rawId} from ~/.hermes/config.yaml. Restart the Hermes Agent gateway for the change to take effect.`,
        })
      },
    },
  },
})
