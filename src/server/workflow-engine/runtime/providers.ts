// Switch UI local replacement for @archon/providers.
// KanbanDispatcher is the single registered provider for the execute phase.

import { KanbanDispatcher } from '../dispatcher/kanban-dispatcher.js';
import type { IAgentProvider, ProviderCapabilities, ProviderInfo } from './providers-types.js';

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
 * aliases of the single 'hermes-kanban' dispatcher.
 */
const KANBAN_ALIASES = new Set(['hermes-kanban', 'claude', 'codex']);

export function isRegisteredProvider(type: string): boolean {
  return KANBAN_ALIASES.has(type);
}

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

export function getProvider(_type: string): IAgentProvider {
  return dispatcher;
}

export function getProviderCapabilities(id: string): ProviderCapabilities {
  return KANBAN_ALIASES.has(id) ? dispatcher.getCapabilities() : DISABLED_CAPS;
}

// No-ops: kept to satisfy upstream import surface (used only by parked tests).
export function registerBuiltinProviders(): void { /* hermes-kanban auto-registered */ }
export function clearRegistry(): void { /* no-op; single dispatcher */ }
