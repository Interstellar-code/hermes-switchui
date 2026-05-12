/**
 * useAgentBehaviors — stub retained for future Conductor repurpose.
 * The swarm-specific living office simulation has been removed.
 */

export type AgentActivity =
  | 'idle'
  | 'walking'
  | 'coding'
  | 'thinking'
  | 'water_break'
  | 'coffee_break'
  | 'lunch'
  | 'meeting'
  | 'chatting'
  | 'celebrating'
  | 'frustrated'

export type AgentBehaviorView = {
  sessionKey: string
  personaName: string
  activityEmoji: string
  direction: 'left' | 'right'
  isWalking: boolean
}

/** No-op stub — returns empty map. Will be repurposed for Conductor. */
export function useAgentBehaviors(
  _sessions: Array<unknown>,
): Map<string, AgentBehaviorView> {
  return new Map()
}
