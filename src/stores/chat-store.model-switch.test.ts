import { beforeEach, describe, expect, it } from 'vitest'

import { detectModelRejection, useChatStore } from './chat-store'

/**
 * Task #24 — the gateway now reads `model` from the chat body and the switch
 * is STICKY. These pin the two things that follow from stickiness: a refused
 * pick must roll back (or every later turn re-uses it), and the model shown to
 * the user must come from the server, never from what we sent.
 */

const SESSION = 'sess-model-switch'

beforeEach(() => {
  useChatStore.setState({ modelSwitch: {} })
})

describe('beginModelSwitch', () => {
  it('marks a first switch pending', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'anthropic/claude-opus-4')

    const state = useChatStore.getState().getModelSwitch(SESSION)
    expect(state.pending).toBe(true)
    expect(state.changed).toBe(true)
    expect(state.requested).toBe('anthropic/claude-opus-4')
  })

  it('does NOT mark a resend of the confirmed model pending — the server no-ops', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'anthropic/claude-opus-4')
    useChatStore.getState().setEffectiveModel(SESSION, 'anthropic/claude-opus-4')

    useChatStore.getState().beginModelSwitch(SESSION, 'anthropic/claude-opus-4')

    const state = useChatStore.getState().getModelSwitch(SESSION)
    expect(state.pending).toBe(false)
    expect(state.changed).toBe(false)
  })

  it('is not pending when no model is sent at all', () => {
    useChatStore.getState().beginModelSwitch(SESSION, undefined)
    expect(useChatStore.getState().getModelSwitch(SESSION).pending).toBe(false)
  })

  it('keeps the rollback target across a resend of the same model', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'openai/gpt-4o')
    useChatStore.getState().setEffectiveModel(SESSION, 'openai/gpt-4o')
    // switch away
    useChatStore.getState().beginModelSwitch(SESSION, 'bogus/model-xyz')
    // resend the same (still unconfirmed) selection
    useChatStore.getState().beginModelSwitch(SESSION, 'bogus/model-xyz')

    expect(useChatStore.getState().getModelSwitch(SESSION).previous).toBe(
      'openai/gpt-4o',
    )
  })
})

describe('setEffectiveModel', () => {
  it('clears pending and records what the server said answered', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'alias-fast')
    useChatStore.getState().setEffectiveModel(SESSION, 'openai/gpt-4o-mini')

    const state = useChatStore.getState().getModelSwitch(SESSION)
    expect(state.pending).toBe(false)
    // A silent server-side fallback: we asked for the alias, the gateway
    // answered with something else, and that difference stays visible.
    expect(state.effective).toBe('openai/gpt-4o-mini')
    expect(state.requested).toBe('alias-fast')
  })

  it('leaves `changed` set so the end-of-turn rejection check still runs', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'bogus/model-xyz')
    useChatStore.getState().setEffectiveModel(SESSION, 'bogus/model-xyz')

    expect(useChatStore.getState().getModelSwitch(SESSION).changed).toBe(true)
  })
})

describe('failModelSwitch', () => {
  it('rolls the effective model back to the last confirmed one', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'openai/gpt-4o')
    useChatStore.getState().setEffectiveModel(SESSION, 'openai/gpt-4o')
    useChatStore.getState().beginModelSwitch(SESSION, 'bogus/model-xyz')

    useChatStore.getState().failModelSwitch(SESSION, {
      message: 'model not available',
      code: 'model_not_available',
      shape: 'http-400',
    })

    const state = useChatStore.getState().getModelSwitch(SESSION)
    expect(state.effective).toBe('openai/gpt-4o')
    expect(state.pending).toBe(false)
    expect(state.error).toMatchObject({
      message: 'model not available',
      code: 'model_not_available',
      shape: 'http-400',
      revertTo: 'openai/gpt-4o',
    })
  })

  it('reverts to null when the session never confirmed a model', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'bogus/model-xyz')
    useChatStore
      .getState()
      .failModelSwitch(SESSION, { message: 'nope', shape: 'provider-rejection' })

    expect(useChatStore.getState().getModelSwitch(SESSION).error?.revertTo).toBe(
      null,
    )
  })
})

describe('settleModelSwitch', () => {
  it('drops pending/changed but preserves the recorded failure for the UI', () => {
    useChatStore.getState().beginModelSwitch(SESSION, 'bogus/model-xyz')
    useChatStore
      .getState()
      .failModelSwitch(SESSION, { message: 'nope', shape: 'http-400' })
    useChatStore.getState().settleModelSwitch(SESSION)

    const state = useChatStore.getState().getModelSwitch(SESSION)
    expect(state.pending).toBe(false)
    expect(state.changed).toBe(false)
    expect(state.error?.message).toBe('nope')
  })
})

// ─── provider-rejection heuristic ──────────────────────────────────────────

const AGGREGATOR_REJECTION =
  '[🦚 Manifest M302] Model "definitely-not-a-real-model-xyz" is not available ' +
  'for this agent. Use GET /v1/models to list available model IDs, or make the ' +
  'provider available for this agent here: https://example.invalid/providers'

describe('detectModelRejection', () => {
  it('catches the aggregator refusal that arrives as a normal HTTP 200 turn', () => {
    expect(
      detectModelRejection({
        text: AGGREGATOR_REJECTION,
        requestedModel: 'definitely-not-a-real-model-xyz',
      }),
    ).toBe(true)
  })

  it('matches the bare model id when the request carried a provider prefix', () => {
    expect(
      detectModelRejection({
        text: AGGREGATOR_REJECTION,
        requestedModel: 'manifest/definitely-not-a-real-model-xyz',
      }),
    ).toBe(true)
  })

  it('does NOT key on the vendor emoji or error code', () => {
    // Same refusal, different vendor wording — still caught.
    expect(
      detectModelRejection({
        text: 'Error: the model gpt-9-turbo-preview does not exist or you do not have access to it.',
        requestedModel: 'openai/gpt-9-turbo-preview',
      }),
    ).toBe(true)
  })

  it('does not fire on a legitimate assistant message about model availability', () => {
    const legit =
      'Great question. Model availability depends on your provider plan — some ' +
      'accounts see the full catalogue while others only see a subset. If you ' +
      'want, I can walk through how routing decides which endpoint answers a ' +
      'request, and how aliases map onto concrete provider model ids. There is ' +
      'nothing unavailable about your current setup as far as I can tell, so ' +
      'this is mostly a question of which tier you are on and what the ' +
      'aggregator has enabled for the account.'
    expect(
      detectModelRejection({
        text: legit,
        requestedModel: 'anthropic/claude-opus-4',
      }),
    ).toBe(false)
  })

  it('does not fire on a short answer that never names the requested model', () => {
    expect(
      detectModelRejection({
        text: 'That model is not available right now.',
        requestedModel: 'anthropic/claude-opus-4',
      }),
    ).toBe(false)
  })

  it('does not fire when the model is named but nothing is refused', () => {
    expect(
      detectModelRejection({
        text: 'Sure — I am running as definitely-not-a-real-model-xyz and ready to help.',
        requestedModel: 'definitely-not-a-real-model-xyz',
      }),
    ).toBe(false)
  })

  it('does not fire on a turn that ran tools — a canned refusal never does', () => {
    expect(
      detectModelRejection({
        text: AGGREGATOR_REJECTION,
        requestedModel: 'definitely-not-a-real-model-xyz',
        hadToolCalls: true,
      }),
    ).toBe(false)
  })

  it('does not fire on a long turn that merely quotes the refusal', () => {
    expect(
      detectModelRejection({
        text: `${AGGREGATOR_REJECTION}\n\n${'Here is what that means in practice. '.repeat(20)}`,
        requestedModel: 'definitely-not-a-real-model-xyz',
      }),
    ).toBe(false)
  })

  it('needs a requested model to have anything to detect', () => {
    expect(
      detectModelRejection({ text: AGGREGATOR_REJECTION, requestedModel: '' }),
    ).toBe(false)
  })
})
