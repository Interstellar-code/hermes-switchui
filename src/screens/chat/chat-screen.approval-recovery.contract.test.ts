import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Approval recovery (usePendingApprovalQueue) has exactly one live delivery
 * path — the `clarify` event on the send-stream — and `/api/approvals/pending`
 * is the only catch-up. Before this test existed, the hook was only reachable
 * through `ApprovalsBell`, which `ChatScreen` renders solely inside its
 * `!compact` branch (see chat-header-v2.tsx). `ChatScreen` is also mounted
 * with `compact` by the side-panel chat (`components/chat-panel.tsx`), which
 * therefore had NO recovery at all.
 *
 * `ChatScreen` is too heavy to mount in a unit test (dozens of hooks with
 * live network/store side effects), so this is a structural guard rather
 * than a render test: it asserts the hook call sits in the unconditional
 * setup portion of the component, before the `{!compact ? (` branch, so it
 * runs regardless of `compact`.
 */
describe('ChatScreen approval recovery', () => {
  it('calls usePendingApprovalQueue unconditionally, not inside the !compact branch', () => {
    const source = readFileSync(
      new URL('./chat-screen.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain(
      "import { usePendingApprovalQueue } from '@/hooks/use-approval-queue'",
    )

    const compactBranchStart = source.indexOf('{!compact ? (')
    const hookCallIndex = source.indexOf('usePendingApprovalQueue()')

    expect(compactBranchStart).toBeGreaterThan(-1)
    expect(hookCallIndex).toBeGreaterThan(-1)
    expect(hookCallIndex).toBeLessThan(compactBranchStart)
  })
})
