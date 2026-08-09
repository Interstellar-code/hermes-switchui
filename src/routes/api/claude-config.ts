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
import {
  readAuthStore,
  removeCredential,
  saveCredential,
  secureFile,
} from '../../server/credential-status'
import type { CredentialWriteOutcome } from '../../server/credential-status'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'
import { maskSecrets } from '@/lib/secret-mask'
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
      // The backup holds the same inline credentials as the original.
      secureFile(`${CONFIG_PATH}.bak`)
    }
  } catch {
    // A failed backup must not block the write.
  }

  // Write-then-rename: a crash mid-write cannot leave a truncated config.yaml.
  // `mode` on the temp file matters because the rename carries it across:
  // config.yaml can hold an inline `api_key`, so it is a secret file.
  const tmpPath = `${CONFIG_PATH}.tmp`
  fs.writeFileSync(tmpPath, serialized, { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmpPath, CONFIG_PATH)
  secureFile(CONFIG_PATH)
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
 * Apply credential updates through the ONE reconciling write path.
 *
 * What used to live here was a hand-rolled `.env` line editor. It was careful
 * about comments and blank lines — and completely wrong about everything else:
 * it wrote `.env` and stopped. The dashboard's `PUT /api/env` runs
 * `hermes_cli/credential_lifecycle.py`, which additionally rewrites
 * value-matched `config.yaml` mirrors and prunes env-seeded `credential_pool`
 * entries in `auth.json`. Two write paths where one reconciles and one does
 * not is exactly upstream #51071/#62269: settings rotated the key correctly,
 * the wizard and onboarding rotated it into a shadowed copy, and the user got
 * persistent 401s against a key the UI showed as current.
 *
 * The editor itself now lives in `credential-status.ts` as the offline
 * fallback only, and it chmods `0600` (this one left `.env` at `0644`).
 *
 * `null` or `''` deletes a key, matching the PATCH contract.
 */
async function applyEnvUpdates(
  updates: Record<string, string | null>,
): Promise<Array<CredentialWriteOutcome>> {
  const outcomes: Array<CredentialWriteOutcome> = []
  for (const [key, value] of Object.entries(updates)) {
    outcomes.push(
      value === null || value === ''
        ? await removeCredential(key)
        : await saveCredential(key, value),
    )
  }
  return outcomes
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '***'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

/**
 * Does the auth store hold a credential for this provider?
 *
 * This used to open `auth-profiles.json` and look for a `profiles` map keyed
 * `"<provider>:…"`. The gateway has never written that file or that shape —
 * the store is `auth.json` with `providers` / `credential_pool` sections
 * (`hermes_cli/auth.py:891`). The lookup therefore missed on every provider,
 * every time, so `configured` was false for every OAuth provider permanently.
 * The corrected reader lives in `server/credential-status.ts` (which also
 * handles the profile → root read-only fallback), and reports which store
 * answered.
 */
function checkAuthStore(providerId: string): {
  hasToken: boolean
  source: string
  maskedKey?: string
} {
  const entry = readAuthStore(providerId)
  if (!entry || (!entry.oauth && !entry.pool)) {
    return { hasToken: false, source: '' }
  }
  return {
    hasToken: true,
    // Names the store that answered, so a profile borrowing the root grant is
    // visible rather than silently attributed to the profile.
    source: entry.oauth
      ? entry.scope === 'root'
        ? 'auth-store'
        : `auth-store:${entry.scope}`
      : 'credential-pool',
  }
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
          // Masked server-side, not in the client. Env-sourced keys were
          // already masked above, but `config` was shipped verbatim — and
          // config.yaml is precisely where inline `api_key` values live, so
          // the one credential the masking missed was the one most likely to
          // be a plaintext secret. `maskSecrets` is the shared hardened
          // masker (word-boundary key matching + value-shape detection); it
          // deliberately leaves `key_env` readable, since that names a
          // variable rather than holding a secret.
          config: maskSecrets(config),
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
        let credentialWrites: Array<CredentialWriteOutcome> = []
        if (body.env && typeof body.env === 'object') {
          credentialWrites = await applyEnvUpdates(
            body.env as Record<string, string | null>,
          )
        }

        // A write that could not be reconciled is not a silent success: the
        // caller has to be able to tell the user that a stale copy may still
        // win. Same for mirrors the gateway rewrote — those are the proof the
        // rotation actually took.
        const warnings = credentialWrites
          .map((outcome) => outcome.warning)
          .filter((warning): warning is string => Boolean(warning))
        const reconciledMirrors = credentialWrites.flatMap((outcome) => [
          ...(outcome.config_updates ?? []),
          ...(outcome.config_scrubbed ?? []),
        ])

        return Response.json({
          ok: true,
          message:
            'Config saved to ~/.hermes/config.yaml. The Hermes Agent gateway only ' +
            'reads its config at startup, so restart it (re-run `hermes gateway run`, ' +
            'or `pnpm start:all` if you launched everything together) for the provider ' +
            'change to take effect.',
          requiresGatewayRestart: true,
          credentialsReconciled: credentialWrites.every(
            (outcome) => outcome.reconciled,
          ),
          reconciledMirrors,
          warnings: warnings.length > 0 ? warnings : undefined,
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
        //    Routed through the reconciling remove so the credential leaves
        //    the pool and the model cache too; a `.env`-only delete left the
        //    provider advertising models forever (#51071/#59761).
        let removedEnvKey: string | null = null
        let credentialWarning: string | undefined
        if (body.removeKey === true && keyEnv) {
          const stillReferenced = Object.values(
            isRecord(config.providers) ? config.providers : {},
          ).some((entry) => isRecord(entry) && entry.key_env === keyEnv)
          if (!stillReferenced) {
            const outcome = await removeCredential(keyEnv)
            if (outcome.found !== false) removedEnvKey = keyEnv
            credentialWarning = outcome.warning
          }
        }

        writeConfig(config)

        return Response.json({
          ok: true,
          removed: id,
          removedEnvKey,
          clearedActiveProvider,
          requiresGatewayRestart: true,
          warnings: credentialWarning ? [credentialWarning] : undefined,
          message: `Removed ${rawId} from ~/.hermes/config.yaml. Restart the Hermes Agent gateway for the change to take effect.`,
        })
      },
    },
  },
})
