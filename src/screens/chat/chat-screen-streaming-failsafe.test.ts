import { describe, expect, it } from 'vitest'

import { STREAMING_FAILSAFE_TIMEOUT_MS } from './chat-screen'

const SEND_STREAM_RUN_TIMEOUT_MS = 600_000

describe('streaming failsafe alignment', () => {
  it('frontend failsafe >= backend SEND_STREAM_RUN_TIMEOUT_MS', () => {
    expect(STREAMING_FAILSAFE_TIMEOUT_MS).toBeGreaterThanOrEqual(
      SEND_STREAM_RUN_TIMEOUT_MS,
    )
  })
})
