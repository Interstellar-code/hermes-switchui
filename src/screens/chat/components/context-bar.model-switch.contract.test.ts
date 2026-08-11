import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Contract test — ContextBar pulls in useQuery, useSessionStatus and
 * useContextUsageStore, so mounting it just to assert model-chip precedence
 * costs far more than reading the source. Same approach as the other
 * heavyweight-component contracts in this repo (e.g.
 * session-selectors-v2.model-switch.contract.test.ts).
 *
 * Task #26 item 2 — ContextBar's model chip was fed only by `/api/model/info`
 * + `/api/session-status`, so it could disagree with the meta-bar chip (which
 * shows the SERVER-confirmed effective model from the chat-store
 * `modelSwitch` slice). Two chips disagreeing about the current model is
 * worse than either being slightly stale, so this chip must prefer the same
 * server-confirmed source, falling back to its existing sources otherwise —
 * matching session-selectors-v2.tsx's precedence exactly.
 */

const source = readFileSync(
  new URL('./context-bar.tsx', import.meta.url),
  'utf8',
)

describe('ContextBar model chip prefers the server-confirmed effective model', () => {
  it('subscribes to the chat-store model-switch slice for this session', () => {
    expect(source).toContain(
      "import { useChatStore } from '@/stores/chat-store'",
    )
    expect(source).toContain(
      "import { activeScopeKey } from '@/lib/session-scope'",
    )
    expect(source).toContain('s.modelSwitch[modelSwitchKey]?.effective')
  })

  it('prefers effectiveModelId over the polled /api/model/info + /api/session-status sources', () => {
    expect(source).toContain(
      'effectiveModelId || liveModel || status.model || meta?.model',
    )
  })

  it('never derives the displayed model from the polled sources alone', () => {
    // The old expression — no server-confirmed override — must be gone.
    expect(source).not.toContain(
      "const activeModel = liveModel || status.model || meta?.model || ''",
    )
  })
})
