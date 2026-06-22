/**
 * @vitest-environment jsdom
 *
 * Tests that the revealTimerRef pattern used in section-api-keys.tsx and
 * section-memory-wiki.tsx (HindsightEnvRow) clears the timer on unmount,
 * preventing a setState call on an unmounted component.
 *
 * Also covers the dispatchTimerRef pattern from tasks-screen.tsx — identical
 * mechanics, same useRef + useEffect cleanup shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Minimal component that mirrors the reveal-timer pattern
// ---------------------------------------------------------------------------
function RevealComponent({ onStateUpdate }: { onStateUpdate: () => void }) {
  const [revealed, setRevealed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // cleanup on unmount — the fix under test
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  function reveal() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onStateUpdate()
      setRevealed(false)
      timerRef.current = null
    }, 30_000)
    setRevealed(true)
  }

  return (
    <div>
      <button onClick={reveal}>Reveal</button>
      <span data-testid="status">{revealed ? 'shown' : 'hidden'}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Minimal component that mirrors the dispatchResult timer pattern
// ---------------------------------------------------------------------------
function DispatchComponent({ onStateUpdate }: { onStateUpdate: () => void }) {
  const [result, setResult] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  function dispatch() {
    setResult('Dispatched 3 task(s)')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onStateUpdate()
      setResult(null)
      timerRef.current = null
    }, 4_000)
  }

  return (
    <div>
      <button onClick={dispatch}>Dispatch</button>
      <span data-testid="result">{result ?? 'idle'}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('timer-ref leak prevention (reveal pattern — #163)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('auto-hides after 30 s when still mounted', () => {
    const spy = vi.fn()
    render(<RevealComponent onStateUpdate={spy} />)
    act(() => { screen.getByRole('button').click() })
    expect(screen.getByTestId('status').textContent).toBe('shown')

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByTestId('status').textContent).toBe('hidden')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire setState after unmount (timer cancelled by cleanup)', () => {
    const spy = vi.fn()
    const { unmount } = render(<RevealComponent onStateUpdate={spy} />)
    act(() => { screen.getByRole('button').click() })

    // Unmount before the 30-second timer fires
    unmount()

    // Advance past the timer — the clearTimeout in useEffect cleanup must have
    // cancelled it, so spy should never be called and no React warning thrown.
    expect(() => {
      act(() => { vi.advanceTimersByTime(30_000) })
    }).not.toThrow()

    expect(spy).not.toHaveBeenCalled()
  })

  it('cancels previous timer when reveal is called again before expiry', () => {
    const spy = vi.fn()
    render(<RevealComponent onStateUpdate={spy} />)
    const btn = screen.getByRole('button')

    act(() => { btn.click() })
    act(() => { vi.advanceTimersByTime(10_000) }) // partial advance

    // Second reveal — should restart the 30 s window
    act(() => { btn.click() })
    act(() => { vi.advanceTimersByTime(10_000) }) // only 10 s into new timer

    // Original timer would have fired at t=30 s (20 s after second click) but
    // it was cancelled; new timer fires at 30 s after second click
    expect(spy).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(20_000) }) // now 30 s from second click
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('timer-ref leak prevention (dispatch pattern — #167)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('clears the dispatch result after 4 s when mounted', () => {
    const spy = vi.fn()
    render(<DispatchComponent onStateUpdate={spy} />)
    act(() => { screen.getByRole('button').click() })
    expect(screen.getByTestId('result').textContent).toBe('Dispatched 3 task(s)')

    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.getByTestId('result').textContent).toBe('idle')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire setState after unmount (timer cancelled by cleanup)', () => {
    const spy = vi.fn()
    const { unmount } = render(<DispatchComponent onStateUpdate={spy} />)
    act(() => { screen.getByRole('button').click() })

    unmount()

    expect(() => {
      act(() => { vi.advanceTimersByTime(4_000) })
    }).not.toThrow()

    expect(spy).not.toHaveBeenCalled()
  })
})
