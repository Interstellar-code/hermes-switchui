import { vi } from 'vitest'

/**
 * jsdom has no layout. Stubs ResizeObserver and gives every `[data-fit-row]`
 * child of a list `rowHeight` px, stacked, inside a container `box.height` tall.
 * Returns the observers created, a way to fire them and the restore function.
 */
export function stubFitGeometry(box: { height: number }, rowHeight = 30) {
  const observers: Array<{
    cb: () => void
    disconnect: ReturnType<typeof vi.fn>
  }> = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn()
      cb: () => void
      constructor(cb: () => void) {
        this.cb = cb
        observers.push(this)
      }
      observe() {
        this.cb()
      }
    },
  )
  const proto = HTMLElement.prototype
  const keys = ['clientHeight', 'offsetHeight', 'offsetTop']
  const saved = keys.map(
    (k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const,
  )
  const define = (k: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(proto, k, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this)
      },
    })
  const rowH = (el: HTMLElement) =>
    typeof el.dataset.rowHeight === 'string'
      ? Number(el.dataset.rowHeight)
      : rowHeight
  define('clientHeight', () => box.height)
  define('offsetHeight', rowH)
  define('offsetTop', (el) => {
    let top = 0
    for (const sib of Array.from(el.parentElement?.children ?? [])) {
      if (sib === el) break
      top += rowH(sib as HTMLElement)
    }
    return top
  })
  return {
    observers,
    fire: () => observers.forEach((o) => o.cb()),
    restore() {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(proto, k, d)
        else delete (proto as unknown as Record<string, unknown>)[k]
      }
      vi.unstubAllGlobals()
    },
  }
}

export function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}
