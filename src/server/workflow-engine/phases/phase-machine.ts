/**
 * Phase machine — validates and records workflow phase transitions.
 *
 * This is the SOLE module that advances workflow_runs.current_phase.
 * All callers must go through recordPhaseTransition; direct DB updates
 * to current_phase are forbidden (enforced by grep gate in CI).
 */

export type Phase = 'plan' | 'route' | 'execute' | 'review' | 'report';
export type DecidedBy = 'user' | 'engine' | 'router' | 'system';

export const VALID_TRANSITIONS: Record<Phase, Phase[]> = {
  plan:    ['route', 'execute'],   // v1 may skip route directly to execute
  route:   ['execute'],
  execute: ['review', 'report'],   // review optional; can skip to report
  review:  ['execute', 'report'],  // can loop back to execute
  report:  [],                     // terminal phase
};

export class InvalidPhaseTransitionError extends Error {
  constructor(
    public readonly from: Phase,
    public readonly to: Phase,
  ) {
    super(`Invalid phase transition: ${from} → ${to}. Allowed from ${from}: [${VALID_TRANSITIONS[from].join(', ')}]`);
    this.name = 'InvalidPhaseTransitionError';
  }
}

export interface PhaseMachine {
  advancePhase(
    runId: string,
    toPhase: Phase,
    decidedBy: DecidedBy,
    decisionData?: Record<string, unknown>,
  ): Promise<{ from: Phase; to: Phase }>;
}
