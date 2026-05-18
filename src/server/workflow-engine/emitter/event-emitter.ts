/**
 * WorkflowEventEmitter - typed event emitter for workflow execution observability.
 *
 * Lives in @archon/workflows so the executor can emit events.
 * The Web adapter in @archon/server subscribes to forward events to SSE streams.
 *
 * Design:
 * - Singleton pattern via getWorkflowEventEmitter()
 * - Fire-and-forget: listener errors never propagate to the executor
 * - Conversation-scoped subscriptions via registerRun() mapping
 */
import { EventEmitter } from 'events';
import type { ArtifactType } from '../schemas';
import { createLogger } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflow.emitter');
  return cachedLog;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

interface WorkflowStartedEvent {
  type: 'workflow_started';
  runId: string;
  workflowName: string;
  conversationId: string;
}

interface WorkflowCompletedEvent {
  type: 'workflow_completed';
  runId: string;
  workflowName: string;
  duration: number;
}

interface WorkflowFailedEvent {
  type: 'workflow_failed';
  runId: string;
  workflowName: string;
  error: string;
}

interface LoopIterationStartedEvent {
  type: 'loop_iteration_started';
  runId: string;
  nodeId?: string; // present when loop runs as a DAG node
  iteration: number;
  maxIterations: number;
}

interface LoopIterationCompletedEvent {
  type: 'loop_iteration_completed';
  runId: string;
  nodeId?: string; // present when loop runs as a DAG node
  iteration: number;
  duration: number;
  completionDetected: boolean;
}

interface LoopIterationFailedEvent {
  type: 'loop_iteration_failed';
  runId: string;
  nodeId?: string; // present when loop runs as a DAG node
  iteration: number;
  error: string;
}

interface WorkflowArtifactEvent {
  type: 'workflow_artifact';
  runId: string;
  artifactType: ArtifactType;
  label: string;
  url?: string;
  path?: string;
}

interface NodeStartedEvent {
  type: 'node_started';
  runId: string;
  nodeId: string;
  nodeName: string; // command name or node.id for inline prompts
  /** Pre-generated node_run UUID — forwarded by executor so the projector
   *  uses the same ID that was injected into nodeConfig['node_run_id']. */
  nodeRunId?: string;
  /** Node type from YAML (prompt | bash | command | script | loop | approval | cancel).
   *  Without this the projector falls back to 'prompt' for every row. */
  nodeType?: string;
  /** Flattened from YAML `hermes_task` — used by the projector to populate
   *  the routing-hint columns on node_runs. */
  agentProfileHint?: string;
  skills?: Array<string>;
  modelHint?: string;
  /** When set, this node_run is a child of a subgraph placeholder. (A.7-subgraphs)
   *  Projector forwards this to createNodeRun so the FK linkage is established. */
  parentSubgraphNodeRunId?: string;
}

interface NodeCompletedEvent {
  type: 'node_completed';
  runId: string;
  nodeId: string;
  nodeName: string;
  duration: number;
  costUsd?: number;
  stopReason?: string;
  numTurns?: number;
}

interface NodeFailedEvent {
  type: 'node_failed';
  runId: string;
  nodeId: string;
  nodeName: string;
  error: string;
}

interface NodeSkippedEvent {
  type: 'node_skipped';
  runId: string;
  nodeId: string;
  nodeName: string;
  reason: 'when_condition' | 'when_condition_parse_error' | 'trigger_rule' | 'prior_success';
}

// Subgraph lifecycle events (A.7-subgraphs).
// A subgraph node produces one placeholder node_run plus one child node_run
// per inner node. The placeholder's lifecycle is tracked via these events;
// children continue to use the regular node_started/completed/failed events.

interface SubgraphStartedEvent {
  type: 'subgraph_started';
  runId: string;
  nodeId: string;          // parent subgraph-node id (placeholder)
  subgraphRef: string;     // id of the subgraph definition being expanded
  /** Pre-generated UUID for the placeholder node_run row. */
  nodeRunId?: string;
  /** Number of child nodes the expansion produced. */
  childCount: number;
}

interface SubgraphCompletedEvent {
  type: 'subgraph_completed';
  runId: string;
  nodeId: string;
  duration: number;
  /** Aggregated outputs as declared in the subgraph definition's `outputs:` block. */
  outputs?: Record<string, unknown>;
}

interface SubgraphFailedEvent {
  type: 'subgraph_failed';
  runId: string;
  nodeId: string;
  /** dag_node_id of the inner child that failed. */
  failedChildNodeId?: string;
  error: string;
}

interface ToolStartedEvent {
  type: 'tool_started';
  runId: string;
  toolName: string;
  stepName: string;
}

interface ToolCompletedEvent {
  type: 'tool_completed';
  runId: string;
  toolName: string;
  stepName: string;
  durationMs: number;
}

interface ApprovalPendingEvent {
  type: 'approval_pending';
  runId: string;
  nodeId: string;
  message: string;
}

interface WorkflowCancelledEvent {
  type: 'workflow_cancelled';
  runId: string;
  nodeId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Platform bridge events (A.8) — emitted by EngineWorkflowPlatform so that
// future SSE consumers (A.1.2) can forward messages to the UI without coupling
// the executor to HTTP. These carry no runId because the platform receives a
// conversationId; callers that need runId must correlate via registerRun().
// ---------------------------------------------------------------------------

export interface PlatformMessageEvent {
  type: 'platform_message';
  /** Platform events are conversation-scoped. runId is not present (use conversationId). */
  runId?: undefined;
  conversationId: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformChunkEvent {
  type: 'platform_chunk';
  runId?: undefined;
  conversationId: string;
  event: unknown;
}

export interface PlatformRetractEvent {
  type: 'platform_retract';
  runId?: undefined;
  conversationId: string;
}

// A.5 Q4 — approval decision received from the user (emitted by approve route so SSE sees it)
export interface ApprovalReceivedEvent {
  type: 'approval_received';
  runId: string;
  conversationId: string;
  nodeRunId: string;
  decision: 'approved' | 'rejected';
  response: string;
}

export type WorkflowEmitterEvent =
  | WorkflowStartedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | LoopIterationStartedEvent
  | LoopIterationCompletedEvent
  | LoopIterationFailedEvent
  | NodeStartedEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | NodeSkippedEvent
  | SubgraphStartedEvent
  | SubgraphCompletedEvent
  | SubgraphFailedEvent
  | WorkflowArtifactEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ApprovalPendingEvent
  | WorkflowCancelledEvent
  | PlatformMessageEvent
  | PlatformChunkEvent
  | PlatformRetractEvent
  | ApprovalReceivedEvent;

// ---------------------------------------------------------------------------
// Emitter class
// ---------------------------------------------------------------------------

type Listener = (event: WorkflowEmitterEvent) => void;

const WORKFLOW_EVENT = 'workflow_event';

export class WorkflowEventEmitter {
  private emitter = new EventEmitter();
  private conversationMap = new Map<string, string>(); // runId -> conversationId

  constructor() {
    // Allow many subscribers (adapters, DB persistence, tests, etc.)
    this.emitter.setMaxListeners(50);
  }

  /**
   * Register a run-to-conversation mapping so subscribers can filter by conversation.
   */
  registerRun(runId: string, conversationId: string): void {
    this.conversationMap.set(runId, conversationId);
  }

  /**
   * Remove the run-to-conversation mapping (called at workflow end).
   */
  unregisterRun(runId: string): void {
    this.conversationMap.delete(runId);
  }

  /**
   * Get the conversation ID for a given run.
   */
  getConversationId(runId: string): string | undefined {
    return this.conversationMap.get(runId);
  }

  /**
   * Emit a workflow event. Fire-and-forget: listener errors are caught and logged.
   */
  emit(event: WorkflowEmitterEvent): void {
    try {
      this.emitter.emit(WORKFLOW_EVENT, event);
    } catch (error) {
      getLog().error({ err: error as Error, eventType: event.type }, 'event_emit_failed');
    }
  }

  /**
   * Subscribe to all workflow events. Returns an unsubscribe function.
   */
  subscribe(listener: Listener): () => void {
    // Wrap listener to catch errors - listener failures must not propagate
    const safeListener = (event: WorkflowEmitterEvent): void => {
      try {
        listener(event);
      } catch (error) {
        getLog().error({ err: error as Error, eventType: event.type }, 'event_listener_error');
      }
    };

    this.emitter.on(WORKFLOW_EVENT, safeListener);
    return (): void => {
      this.emitter.removeListener(WORKFLOW_EVENT, safeListener);
    };
  }

  /**
   * Subscribe to events for a specific conversation only. Returns unsubscribe function.
   */
  subscribeForConversation(conversationId: string, listener: Listener): () => void {
    return this.subscribe((event: WorkflowEmitterEvent) => {
      // Platform events (platform_message, platform_chunk, platform_retract) have
      // no runId — they're conversation-scoped. Skip run-map lookup for them.
      const runId = event.runId;
      const eventConversationId = runId != null
        ? this.conversationMap.get(runId)
        : (event as { conversationId?: string }).conversationId;
      if (eventConversationId === conversationId) {
        listener(event);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: WorkflowEventEmitter | null = null;

export function getWorkflowEventEmitter(): WorkflowEventEmitter {
  if (!instance) {
    instance = new WorkflowEventEmitter();
  }
  return instance;
}

/**
 * Reset singleton for testing.
 */
export function resetWorkflowEventEmitter(): void {
  instance = null;
}
