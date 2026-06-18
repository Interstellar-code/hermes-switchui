import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Minimum ms between React state commits during streaming (~25fps).
 * The rAF loop still runs every frame to advance the internal accumulator,
 * but React only re-renders when this interval has elapsed — reducing
 * re-renders from ~60/s to ~25/s without slowing the character reveal.
 */
const MIN_COMMIT_INTERVAL_MS = 40

/**
 * Takes a raw streaming text string that updates in chunks (full replacement)
 * and returns a smoothly animated version that reveals characters progressively
 * using requestAnimationFrame — exactly like the Telegram/Discord streaming feel.
 */
export function useSmoothStreamingText(
  targetText: string,
  enabled = true,
): string {
  const [renderedText, setRenderedText] = useState('')
  const renderedRef = useRef('')
  const targetRef = useRef(targetText)
  const frameRef = useRef<number | null>(null)
  // Tracks the last time we actually committed a setRenderedText call
  const lastCommitTimeRef = useRef<number>(0)

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopFrame()
  }, [stopFrame])

  useEffect(() => {
    if (!enabled) {
      renderedRef.current = targetText
      setRenderedText(targetText)
      stopFrame()
      return
    }

    targetRef.current = targetText

    // If target shrank or changed non-additively (e.g. error reset), snap
    if (
      renderedRef.current.length > targetText.length ||
      !targetText.startsWith(renderedRef.current)
    ) {
      renderedRef.current = ''
      setRenderedText('')
      lastCommitTimeRef.current = 0
    }

    // Already caught up
    if (renderedRef.current === targetText) {
      stopFrame()
      return
    }

    // Already ticking
    if (frameRef.current !== null) return

    const tick = (now: DOMHighResTimeStamp) => {
      const current = renderedRef.current
      const next = targetRef.current

      if (current === next) {
        frameRef.current = null
        return
      }

      // Adaptive step: bigger jumps when far behind, 1-char when close.
      // Unchanged from original — reveal speed is preserved.
      const remaining = next.length - current.length
      const step =
        remaining > 60 ? Math.ceil(remaining / 8) : remaining > 20 ? 3 : 1
      const nextLength = Math.min(next.length, current.length + step)
      const nextText = next.slice(0, nextLength)

      // Always advance the internal accumulator so the reveal keeps pace
      // with incoming tokens regardless of whether we commit to React.
      renderedRef.current = nextText

      const isCaughtUp = nextText === next
      const elapsed = now - lastCommitTimeRef.current

      if (isCaughtUp || elapsed >= MIN_COMMIT_INTERVAL_MS) {
        // Commit to React: either we're fully caught up (final flush,
        // bypasses throttle unconditionally) or enough time has passed.
        setRenderedText(nextText)
        lastCommitTimeRef.current = now
      }

      if (!isCaughtUp) {
        frameRef.current = window.requestAnimationFrame(tick)
      } else {
        frameRef.current = null
      }
    }

    frameRef.current = window.requestAnimationFrame(tick)
  }, [targetText, enabled, stopFrame])

  return enabled ? renderedText : targetText
}
