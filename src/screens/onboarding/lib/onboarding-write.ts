/**
 * onboarding-write.ts — turns a `ProviderChoice` plus the values the user
 * typed into the exact patch `write-paths.ts` would build by hand. This
 * module never constructs a config shape itself; it only decides which of
 * `write-paths.ts`'s builders applies (`manifest`-style providers get a
 * `providers.<id>` entry, the reserved `custom`/inline shape gets patched in
 * place, and a provider with nothing to define gets an activation only) and
 * maps field names across. Delegating like this means a future change to what
 * the gateway reads only has one place to change.
 */
import type {
  ClaudeConfigPatch,
  ProviderDraft,
} from '@/screens/providers/lib/write-paths'
import type { ProviderChoice } from './provider-choices'
import {
  buildInlineProviderPatch,
  buildProviderPatch,
  buildSetActivePatch,
} from '@/screens/providers/lib/write-paths'
import { getProviderBaseUrl, getProviderEnvKey } from '@/lib/provider-catalog'

export type OnboardingPatchInput = {
  choice: ProviderChoice
  baseUrl: string
  apiKey: string
  defaultModel: string
  makeActive: boolean
  inline?: boolean
}

function toProviderDraft(input: OnboardingPatchInput): ProviderDraft {
  return {
    id: input.choice.id,
    baseUrl: input.baseUrl,
    envKey: input.choice.envKey ?? undefined,
    apiKey: input.apiKey,
    defaultModel: input.defaultModel,
    makeActive: input.makeActive,
  }
}

/**
 * True when a `providers.<id>` entry would carry nothing but `type: openai` —
 * no base URL (typed or from the catalog), no env var to hold a credential,
 * and no credential to store. That is the shape an OAuth-only provider such as
 * `nous` produces: the gateway owns its endpoint (`DEFAULT_NOUS_INFERENCE_URL`)
 * and reads the token from its own auth store, so there is genuinely nothing
 * for config.yaml to say about it beyond which provider is active.
 */
function providerEntryWouldBeEmpty(input: OnboardingPatchInput): boolean {
  const id = input.choice.id
  const baseUrl =
    input.baseUrl.trim() || input.choice.baseUrl || getProviderBaseUrl(id)
  const envKey = input.choice.envKey?.trim() || getProviderEnvKey(id)
  return !baseUrl && !envKey && !input.apiKey.trim()
}

export function buildOnboardingPatch(
  input: OnboardingPatchInput,
): ClaudeConfigPatch {
  const draft = toProviderDraft(input)
  if (input.inline) return buildInlineProviderPatch(draft)

  // Writing that empty entry is not harmless. The gateway has two resolvers
  // with opposite precedence: the *runtime* one bails out before reading
  // `config.providers` for a canonical built-in (hermes_cli/runtime_provider.py
  // `_get_named_custom_provider`), so chat keeps working — but the picker/CLI
  // one, `hermes_cli/providers.py::resolve_provider_full`, gives user config
  // priority and `resolve_user_provider` performs no validation at all. A bare
  // `providers.nous: {type: openai}` therefore resolves to a ProviderDef with
  // `base_url=""` and `auth_type="api_key"`, which replaces the real OAuth
  // definition: `--provider nous` without a model fails outright with "has no
  // base URL configured", and a not-yet-authenticated install grows a ghost
  // 0-model picker row that cannot be selected. `type` is not even a recognised
  // key, so every config load also logs an unknown-key warning.
  //
  // `write-paths.ts` is shared with the providers screen and is deliberately
  // not changed for this; the choice of *which* builder applies is this
  // module's documented job.
  if (providerEntryWouldBeEmpty(input)) {
    // Nothing to define, so only the activation is worth writing. Not making
    // it active leaves nothing to say at all.
    return input.makeActive
      ? buildSetActivePatch(input.choice.id, input.defaultModel)
      : { config: {} }
  }

  return buildProviderPatch(draft)
}

/**
 * A read-only rendering of the same patch, for the review step. `config` is
 * the JSON that would be written to config.yaml; `env` is the single
 * `~/.hermes/.env` line, with the credential masked — never the real key,
 * even though the caller supplied it, since this is meant to be shown on
 * screen before Save is pressed.
 */
export function buildOnboardingYamlPreview(input: OnboardingPatchInput): {
  config: string
  env: string | null
} {
  const patch = buildOnboardingPatch(input)
  const config = JSON.stringify(patch.config ?? {}, null, 2)
  const envKey = Object.keys(patch.env ?? {})[0] ?? null
  return {
    config,
    env: envKey ? `${envKey}=********` : null,
  }
}
