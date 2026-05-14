// @archon/providers stub — Switch UI local replacement.
// KanbanDispatcher is the single registered provider for the execute phase.

import { KanbanDispatcher } from '../dispatcher/kanban-dispatcher.js';
import type { IAgentProvider, ProviderCapabilities, ProviderInfo } from './providers-types';

const dispatcher = new KanbanDispatcher();

const DISABLED_CAPS: ProviderCapabilities = {
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

/**
 * Switch UI accepts the upstream Archon provider names ('claude', 'codex') as
 * aliases of the single 'hermes-kanban' dispatcher. Hermes workers decide
 * which CLI binary to drive based on Kanban task skills/labels; the YAML
 * `provider:` field becomes a Kanban routing hint, not a separate channel.
 */
const KANBAN_ALIASES = new Set(['hermes-kanban', 'claude', 'codex']);

export function isRegisteredProvider(type: string): boolean {
  return KANBAN_ALIASES.has(type);
}

/**
 * Returns registered providers as ProviderInfo (serialisable, has .id).
 * Callers in dag-executor/loader access `.id` — IAgentProvider has none.
 */
export function getRegisteredProviders(): ProviderInfo[] {
  return [
    {
      id: 'hermes-kanban',
      displayName: 'Hermes Kanban',
      capabilities: dispatcher.getCapabilities(),
      builtIn: true,
    },
  ];
}

/**
 * Returns the live dispatcher instance for execute-phase use.
 * Separate from getRegisteredProviders() which returns the serialisable shape.
 */
export function getProvider(_type: string): IAgentProvider {
  return dispatcher;
}

/**
 * Returns capabilities for the given provider id.
 * Always returns a valid ProviderCapabilities — callers use fields directly.
 */
export function getProviderCapabilities(id: string): ProviderCapabilities {
  return KANBAN_ALIASES.has(id) ? dispatcher.getCapabilities() : DISABLED_CAPS;
}

// No-ops: hermes-kanban is auto-registered via the singleton above.
// Kept to satisfy upstream import surface (used only by parked tests).
export function registerBuiltinProviders(): void { /* hermes-kanban auto-registered */ }
export function clearRegistry(): void { /* no-op; single dispatcher */ }
