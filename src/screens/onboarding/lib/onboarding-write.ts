/**
 * onboarding-write.ts — turns a `ProviderChoice` plus the values the user
 * typed into the exact patch `write-paths.ts` would build by hand. This
 * module never constructs a config shape itself; it only decides which of
 * `write-paths.ts`'s two builders applies (`manifest`-style providers get a
 * `providers.<id>` entry, the reserved `custom`/inline shape gets patched in
 * place) and maps field names across. Delegating like this means a future
 * change to what the gateway reads only has one place to change.
 */
import type {
  ClaudeConfigPatch,
  ProviderDraft,
} from '@/screens/providers/lib/write-paths'
import type { ProviderChoice } from './provider-choices'
import {
  buildInlineProviderPatch,
  buildProviderPatch,
} from '@/screens/providers/lib/write-paths'

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

export function buildOnboardingPatch(
  input: OnboardingPatchInput,
): ClaudeConfigPatch {
  const draft = toProviderDraft(input)
  return input.inline
    ? buildInlineProviderPatch(draft)
    : buildProviderPatch(draft)
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
