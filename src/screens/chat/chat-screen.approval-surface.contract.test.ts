import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Task #9: an approval-kind clarify (`pendingClarify[key].kind === 'approval'`)
 * is a security prompt, not tool chrome. It must render on an unconditional
 * surface, independent of `toolDisplayMode`, the thinking indicator, an
 * active message search, or whether a last assistant message exists to
 * anchor to — none of which the OLD single `clarifyCard` path (thinking
 * bubble / last-assistant-message attachment inside `ChatMessageList`) was
 * immune to.
 *
 * `ChatScreen` is too heavy to mount in a unit test (dozens of hooks with
 * live network/store side effects — see chat-screen.approval-recovery
 * .contract.test.ts for the established precedent), so this is a structural
 * guard: it asserts the source wiring that makes the new surface
 * unconditional and mutually exclusive with the old one.
 */
describe('ChatScreen approval surface (task #9)', () => {
  const source = readFileSync(new URL('./chat-screen.tsx', import.meta.url), 'utf8')

  function between(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker)
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf(endMarker, start)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('splits activeClarify into mutually exclusive clarifyCard / approvalCard by kind', () => {
    // clarifyCard (feeds the message-list surfaces) must exclude approval-kind.
    const clarifyCardBlock = between(
      'const isApprovalClarify = activeClarify?.kind === \'approval\'',
      'const approvalCard = useMemo(',
    )
    expect(clarifyCardBlock).toContain('const clarifyCard = useMemo(')
    expect(clarifyCardBlock).toContain(
      'activeClarify && resolvedSessionKey && !isApprovalClarify',
    )

    // approvalCard (the new unconditional surface) must require approval-kind.
    const approvalCardBlock = source.slice(
      source.indexOf('const approvalCard = useMemo('),
      source.indexOf('const handleClearReply'),
    )
    expect(approvalCardBlock).toContain(
      'activeClarify && resolvedSessionKey && isApprovalClarify',
    )

    // Because one branch requires `isApprovalClarify` and the other requires
    // `!isApprovalClarify` off the SAME `activeClarify`, at most one of
    // clarifyCard / approvalCard is non-null for any given pending clarify —
    // the two render surfaces can never both show a card for it (no double
    // render).
  })

  it('mounts approvalCard as a sibling of the composer, not inside ChatMessageList', () => {
    // The message-list block (search/last-assistant-message/thinking-bubble
    // gating all live inside ChatMessageList) is gated on activeTab/hideUi
    // and closes before the composer block opens.
    const messageListBlockStart = source.indexOf("{hideUi || activeTab !== 'chat' ? null : (")
    const messageListBlockEnd = source.indexOf('</StreamingTextContext.Provider>')
    const composerBlockStart = source.indexOf('{showComposer ? (')
    const approvalCardMountIndex = source.indexOf('{approvalCard}')
    const composerMountIndex = source.indexOf('<ChatComposerShadcn')

    expect(messageListBlockStart).toBeGreaterThan(-1)
    expect(messageListBlockEnd).toBeGreaterThan(messageListBlockStart)
    expect(composerBlockStart).toBeGreaterThan(messageListBlockEnd)
    expect(approvalCardMountIndex).toBeGreaterThan(-1)
    expect(composerMountIndex).toBeGreaterThan(-1)

    // approvalCard is NOT inside the message-list block...
    expect(approvalCardMountIndex).toBeGreaterThan(messageListBlockEnd)
    // ...it is mounted inside the composer block, directly ahead of the
    // composer itself, so it renders whenever the composer does — regardless
    // of activeTab, hideUi's message-search gating, or anything ChatMessageList
    // internally does with toolDisplayMode / lastAssistantIndex / search.
    expect(approvalCardMountIndex).toBeGreaterThan(composerBlockStart)
    expect(approvalCardMountIndex).toBeLessThan(composerMountIndex)
  })

  it('does not gate approvalCard on toolDisplayMode, lastAssistantIndex, or message search', () => {
    const approvalCardBlock = source.slice(
      source.indexOf('const approvalCard = useMemo('),
      source.indexOf('const handleClearReply'),
    )
    expect(approvalCardBlock).not.toContain('toolDisplayMode')
    expect(approvalCardBlock).not.toContain('lastAssistantIndex')
    expect(approvalCardBlock).not.toContain('MessageSearch')
    expect(approvalCardBlock).not.toContain('thinkingIndicator')
  })

  it('keeps clarifyCard wired into ChatMessageList unchanged for non-approval clarifies', () => {
    expect(source).toContain('clarifyCard={clarifyCard}')
    // clarifyCard (not approvalCard) is still the only clarify-shaped prop
    // ChatMessageList receives — non-approval clarifies keep their existing
    // thinking-bubble / last-assistant-message placement and gating.
    expect(source).not.toContain('approvalCard={approvalCard}')
  })
})
