import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Contract test — SessionSelectorsV2 owns every composer query, mutation and
 * store subscription, so mounting it to assert three lines of model-switch
 * wiring costs far more than reading the source. Same approach as the other
 * heavyweight-component contracts in this repo.
 *
 * Task #24: the model chip must show what the SERVER said answered, must show
 * a pending state while a CHANGED model is resolving, and must roll the local
 * pick back when the gateway refuses it.
 */

const source = readFileSync(
  new URL('./session-selectors-v2.tsx', import.meta.url),
  'utf8',
)

describe('model chip reads the server-confirmed model', () => {
  it('subscribes to the chat-store model-switch slice for this session', () => {
    expect(source).toContain('s.modelSwitch[modelSwitchKey]')
    expect(source).toContain('const effectiveModelId = modelSwitch?.effective')
  })

  it('prefers the effective model over the local pick when rendering', () => {
    expect(source).toContain(
      'const displayId = effectiveModelId || persistedSessionModel',
    )
  })

  it('never derives the displayed model from the send-time selection alone', () => {
    // The old expression — local pick only — must be gone.
    expect(source).not.toContain('const match = models.find((m) => m.id === persistedSessionModel)')
  })
})

describe('pending "switching model…" state', () => {
  it('is driven by the store flag, which is only set for a CHANGED model', () => {
    expect(source).toContain('const modelSwitchPending = modelSwitch?.pending === true')
    expect(source).toContain("'Switching model…'")
    expect(source).toContain('data-model-switch-pending={modelSwitchPending || undefined}')
  })
})

describe('refused switch rolls the picker back', () => {
  it('reverts the persisted selection and surfaces the gateway message', () => {
    expect(source).toContain('revertSessionModel(sessionKey, modelSwitchError.revertTo)')
    expect(source).toContain('modelSwitchFailureNotice(modelSwitchError)')
    expect(source).toContain('clearModelSwitchError(sessionKey)')
  })

  it('does not claim the switch already happened at pick time', () => {
    expect(source).not.toContain('`Switched to ${formatModelName(')
    expect(source).toContain('applies on your next message')
  })
})

describe('model catalog source is unchanged', () => {
  it('still reads the curated /api/models catalog, not the gateway /v1/models', () => {
    expect(source).toContain("'/api/models'")
    expect(source).not.toContain('/v1/models')
  })

  it('does not client-side validate the pick against the catalog', () => {
    // A configured `model_routes` alias is a valid `model` value that will
    // never appear in the catalog, so rejecting unknown strings would break it.
    expect(source).toContain('const model = modelId.trim()\n      if (!model) return')
  })
})
