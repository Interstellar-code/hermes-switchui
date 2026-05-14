/**
 * EngineWorkflowPlatform — IWorkflowPlatform impl that bridges the executor
 * to the WorkflowEventEmitter (A.8).
 *
 * sendMessage / sendStructuredEvent / emitRetract all forward to the emitter
 * using the new platform_* event types added in A.8. A future A.1.2 SSE bridge
 * will subscribe and forward these to HTTP clients.
 */
import type {
  IWorkflowPlatform,
  WorkflowMessageMetadata,
  MessageChunk,
} from '../wiring/deps.js';
import { WorkflowEventEmitter } from '../emitter/event-emitter.js';

export class EngineWorkflowPlatform implements IWorkflowPlatform {
  constructor(private readonly emitter: WorkflowEventEmitter) {}

  async sendMessage(
    conversationId: string,
    message: string,
    metadata?: WorkflowMessageMetadata,
  ): Promise<void> {
    this.emitter.emit({
      type: 'platform_message',
      runId: undefined,
      conversationId,
      message,
      metadata: metadata as Record<string, unknown> | undefined,
    });
  }

  getStreamingMode(): 'stream' | 'batch' {
    return 'stream';
  }

  getPlatformType(): string {
    return 'switch-ui';
  }

  async sendStructuredEvent(conversationId: string, event: MessageChunk): Promise<void> {
    this.emitter.emit({
      type: 'platform_chunk',
      runId: undefined,
      conversationId,
      event,
    });
  }

  async emitRetract(conversationId: string): Promise<void> {
    this.emitter.emit({
      type: 'platform_retract',
      runId: undefined,
      conversationId,
    });
  }
}
