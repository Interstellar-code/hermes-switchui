/**
 * factory.ts — always returns the PluginClient singleton.
 *
 * All workflow operations are routed to the hermes-agent workflow-engine
 * plugin via PluginClient.
 */
import type { WorkflowEngineInterface } from './interface.js';
import { PluginClient } from './clients/plugin-client.js';

let _pluginClient: PluginClient | null = null;

export function getEngine(): WorkflowEngineInterface {
  if (!_pluginClient) _pluginClient = new PluginClient();
  return _pluginClient;
}

export type { WorkflowEngineInterface };
