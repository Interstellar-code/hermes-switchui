import { describe, it, expect, beforeEach } from 'vitest'
import {
  WorkflowEventEmitter,
  resetWorkflowEventEmitter,
} from './event-emitter'

beforeEach(() => {
  resetWorkflowEventEmitter()
})

describe('WorkflowEventEmitter.subscribeForConversation', () => {
  it('filters events to the correct conversation via runId mapping', () => {
    const emitter = new WorkflowEventEmitter()
    emitter.registerRun('run-1', 'conv-A')
    emitter.registerRun('run-2', 'conv-B')

    const received: string[] = []
    emitter.subscribeForConversation('conv-A', (evt) => {
      received.push(evt.type)
    })

    emitter.emit({ type: 'workflow_started', runId: 'run-1', conversationId: 'conv-A' } as never)
    emitter.emit({ type: 'workflow_started', runId: 'run-2', conversationId: 'conv-B' } as never)
    emitter.emit({ type: 'node_started', runId: 'run-1', nodeId: 'n1' } as never)

    expect(received).toEqual(['workflow_started', 'node_started'])
  })

  it('multiple subscribers for different conversations do not interfere', () => {
    const emitter = new WorkflowEventEmitter()
    emitter.registerRun('run-X', 'conv-X')
    emitter.registerRun('run-Y', 'conv-Y')

    const eventsX: string[] = []
    const eventsY: string[] = []

    emitter.subscribeForConversation('conv-X', (e) => eventsX.push(e.type))
    emitter.subscribeForConversation('conv-Y', (e) => eventsY.push(e.type))

    emitter.emit({ type: 'workflow_completed', runId: 'run-X' } as never)
    emitter.emit({ type: 'workflow_failed', runId: 'run-Y' } as never)

    expect(eventsX).toEqual(['workflow_completed'])
    expect(eventsY).toEqual(['workflow_failed'])
  })

  it('unsubscribe cleans up — no events received after calling unsubscribe', () => {
    const emitter = new WorkflowEventEmitter()
    emitter.registerRun('run-Z', 'conv-Z')

    const received: string[] = []
    const unsub = emitter.subscribeForConversation('conv-Z', (e) => received.push(e.type))

    emitter.emit({ type: 'node_started', runId: 'run-Z', nodeId: 'n1' } as never)
    unsub()
    emitter.emit({ type: 'node_completed', runId: 'run-Z', nodeId: 'n1' } as never)

    expect(received).toEqual(['node_started'])
  })
})
