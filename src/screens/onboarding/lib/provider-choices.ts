/**
 * provider-choices.ts — turns `PROVIDER_CATALOG` into the curated, grouped
 * list the provider step renders. Two things the catalog cannot answer on
 * its own: which ids the *server* actually has an OAuth flow for (only
 * `nous` — see `use-nous-oauth.ts`; the catalog's `authTypes` advertises
 * oauth for google/vertex and cli-token for openai-codex/anthropic/
 * github-copilot, none of which have a working server-side flow), and which
 * ids are locally detected right now, which get hoisted to the top of the
 * list regardless of their static group.
 */
import type { ProviderAuthType } from '@/lib/provider-catalog'
import {
  PROVIDER_CATALOG,
  RESERVED_PROVIDER_ID,
  getProviderBaseUrl,
  getProviderEnvKey,
  normalizeProviderId,
} from '@/lib/provider-catalog'
import { OAUTH_SUPPORTED_PROVIDERS } from '@/screens/providers/hooks/use-nous-oauth'

export type ProviderChoiceGroup = 'detected' | 'free' | 'popular' | 'all'

export type ProviderChoiceAuthKind = 'oauth' | 'api-key' | 'local' | 'cli-token'

export type ProviderChoice = {
  id: string
  name: string
  description: string
  group: ProviderChoiceGroup
  authKind: ProviderChoiceAuthKind
  envKey: string | null
  baseUrl: string | null
  docsUrl: string | null
  /** true only for ids in OAUTH_SUPPORTED_PROVIDERS — the server rejects all others. */
  supportsOAuth: boolean
  /** CLI command to run when authKind is 'cli-token'. */
  cliCommand: string | null
  detail: string | null
  hasLogo: boolean
}

const FREE_IDS = new Set(['nous', 'ollama', 'atomic-chat'])
const POPULAR_IDS = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'groq',
  'deepseek',
])

/**
 * Mirrors `PROVIDER_LOGO_FILES` in `src/components/provider-logo.tsx`,
 * duplicated rather than imported — that file is a React component and this
 * module has to stay import-clean of React, so the two lists are kept in
 * sync by hand. Source: `public/providers/*.png` on disk.
 */
const PROVIDER_LOGO_IDS = new Set([
  'nous',
  'openai-codex',
  'openai',
  'anthropic',
  'openrouter',
  'ollama',
  'atomic-chat',
  'kimi-coding',
  'minimax',
  'zai',
])

function resolveGroup(id: string): Exclude<ProviderChoiceGroup, 'detected'> {
  if (FREE_IDS.has(id)) return 'free'
  if (POPULAR_IDS.has(id)) return 'popular'
  return 'all'
}

/**
 * One auth kind per provider, even though the catalog can list several.
 * `cli-token` wins outright when present — it is the one path with a UI
 * (`onboarding-write.ts` shows the command), and pretending a cli-token-only
 * provider is `oauth` is exactly the dead end the previous wizard walked
 * `openai-codex` into. After that: whichever mechanism the user can
 * actually act on, with `oauth` last since a provider only reaches here
 * because `api-key`/`local` were unavailable (see `supportsOAuth` for
 * whether the oauth path is real).
 */
function resolveAuthKind(
  authTypes: Array<ProviderAuthType>,
): ProviderChoiceAuthKind {
  if (authTypes.includes('cli-token')) return 'cli-token'
  if (authTypes.includes('api-key')) return 'api-key'
  if (authTypes.includes('local')) return 'local'
  if (authTypes.includes('oauth')) return 'oauth'
  return 'api-key'
}

function detectedDetail(entry: {
  id: string
  modelCount?: number
  running?: boolean
}): string {
  if (typeof entry.modelCount === 'number') {
    return `${entry.modelCount} model${entry.modelCount === 1 ? '' : 's'} detected`
  }
  return entry.running ? 'Running' : 'Detected'
}

export function buildOnboardingProviderChoices(input?: {
  detected?: Array<{ id: string; modelCount?: number; running?: boolean }>
}): Array<ProviderChoice> {
  const detectedById = new Map(
    (input?.detected ?? []).map((entry) => [
      normalizeProviderId(entry.id),
      entry,
    ]),
  )

  return PROVIDER_CATALOG.filter(
    (provider) => provider.id !== RESERVED_PROVIDER_ID,
  ).map((provider) => {
    const detected = detectedById.get(provider.id)
    const authKind = resolveAuthKind(provider.authTypes)

    return {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      group: detected ? 'detected' : resolveGroup(provider.id),
      authKind,
      envKey: getProviderEnvKey(provider.id),
      baseUrl: getProviderBaseUrl(provider.id),
      docsUrl: provider.docsUrl,
      supportsOAuth: (
        OAUTH_SUPPORTED_PROVIDERS as ReadonlyArray<string>
      ).includes(provider.id),
      cliCommand:
        authKind === 'cli-token' ? `claude auth login ${provider.id}` : null,
      detail: detected ? detectedDetail(detected) : null,
      hasLogo: PROVIDER_LOGO_IDS.has(provider.id),
    }
  })
}
