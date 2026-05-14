// @archon/providers stub — Switch UI local replacement.
// Provides registry functions used by loader.ts and validator.ts.
// The full provider registry lives in @archon/core; this stub allows the
// workflow engine schemas/validation/discovery cluster to compile standalone.

import type { ProviderCapabilities, ProviderInfo } from './providers-types';

/** Stub: returns false — no providers are pre-registered in Switch UI's embedded engine. */
export function isRegisteredProvider(_id: string): boolean {
  return false;
}

/** Stub: returns empty array — provider list is managed by the gateway, not the engine. */
export function getRegisteredProviders(): ProviderInfo[] {
  return [];
}

/** Stub: returns a fully-disabled capabilities object — no providers pre-registered. */
export function getProviderCapabilities(_id: string): ProviderCapabilities {
  return {
    sessionResume: false,
    mcp: false,
    hooks: false,
    skills: false,
    agents: false,
    toolRestrictions: false,
    structuredOutput: false,
    envInjection: false,
    costControl: false,
    effortControl: false,
    thinkingControl: false,
    fallbackModel: false,
    sandbox: false,
  };
}
