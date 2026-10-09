import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Height reserved for the muted "+N more" line under a cut list. */
const MORE_LINE_HEIGHT = 20

/** Single-column layout (see the grid in dashboard-screen.tsx). */
const NARROW_QUERY = '(max-width: 760px)'

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(NARROW_QUERY).matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(NARROW_QUERY)
    const sync = () => setNarrow(mql.matches)
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [])
  return narrow
}

/**
 * How many whole rows of a list fit its container. The container is the
 * flex-grown card body; the list inside it is absolutely positioned so that
 * the rows never change the container's height (no feedback loop). Rows carry
 * `data-fit-row`; the caller renders every row and hides those past `count`.
 * `override` pins the count; without ResizeObserver, or in the single-column
 * layout (nothing stretches the card there), `fallback` rows render in normal
 * flow. In all of those `measured` is false and the caller slices the list.
 * `contentKey` re-measures when rows change but their count does not.
 */
export function useFitRows(
  total: number,
  opts: {
    min: number
    fallback: number
    override?: number
    contentKey?: string
  },
) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ count: number; minHeight: number } | null>(
    null,
  )
  const { min, fallback, override, contentKey } = opts
  const narrow = useNarrow()
  // The /dashboard route is ssr: false, so reading ResizeObserver during
  // render cannot cause a hydration mismatch.
  const measured =
    override === undefined && !narrow && typeof ResizeObserver !== 'undefined'

  useLayoutEffect(() => {
    const el = ref.current
    if (!measured || !el) return
    const measure = () => {
      const rows = Array.from(
        el.querySelectorAll<HTMLElement>('[data-fit-row]'),
      )
      const avail = el.clientHeight
      if (rows.length === 0 || avail <= 0) return
      const bottom = (row: HTMLElement) => row.offsetTop + row.offsetHeight
      const all = bottom(rows[rows.length - 1]) <= avail
      const fitting = all
        ? rows.length
        : rows.filter((row) => bottom(row) + MORE_LINE_HEIGHT <= avail).length
      const count = Math.min(rows.length, Math.max(min, fitting))
      // Room for `min` whole rows (+ the more line) even when the column is short.
      const floorRows = Math.min(rows.length, min)
      const minHeight =
        bottom(rows[floorRows - 1]) +
        (rows.length > floorRows ? MORE_LINE_HEIGHT : 0)
      setFit((prev) =>
        prev && prev.count === count && prev.minHeight === minHeight
          ? prev
          : { count, minHeight },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measured, total, min, contentKey])

  const count =
    override !== undefined
      ? Math.max(0, Math.min(total, override))
      : measured && fit
        ? Math.min(total, fit.count)
        : Math.min(total, measured ? total : fallback)
  return {
    ref,
    measured,
    count,
    minHeight: measured ? fit?.minHeight : undefined,
  }
}
