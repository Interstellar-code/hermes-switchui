/**
 * streaming-text-context.tsx — Phase 7 (C1) containment boundary.
 *
 * The live streaming text updates ~25×/sec (post-Phase-5 rAF throttle). If
 * that text is threaded as a prop through ChatMessageList, ChatMessageList's
 * memo breaks every frame and its whole subtree reconciles per frame even
 * though the heavy filter/dedup/group pipeline is already stable.
 *
 * Instead the live text flows through this context. ChatMessageList itself is
 * NOT a consumer (it only takes a stable `hasStreamingText` boolean), so it no
 * longer re-renders per frame. Only the `StreamingMessageItem` leaf below — the
 * single live bubble — subscribes to the context and re-renders per frame,
 * passing the text into MessageItem's existing reveal machinery unchanged.
 *
 * NOTE: deliberately NOT in the Zustand chat-store — this is a render-local
 * channel scoped to the active message list, not shared app state.
 */
import { createContext, memo, useContext } from 'react'
import { MessageItem } from './message-item'
import type { MessageItemProps } from './message-item'

/** Live (smoothed) streaming text for the active session's in-flight bubble. */
export const StreamingTextContext = createContext<string>('')

export function useStreamingTextValue(): string {
  return useContext(StreamingTextContext)
}

/**
 * Leaf wrapper for the live streaming bubble. Reads the per-frame streaming
 * text from context and injects it into MessageItem's `streamingText` prop.
 * Because only this component consumes the context, only it re-renders as the
 * text streams — ChatMessageList and every settled MessageItem stay put.
 */
export const StreamingMessageItem = memo(function StreamingMessageItemInner(
  props: MessageItemProps,
) {
  const streamingText = useStreamingTextValue()
  return <MessageItem {...props} streamingText={streamingText} />
})
