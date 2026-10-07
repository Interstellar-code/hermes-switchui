// Test-only: jsdom has no layout, so React Flow never measures nodes and
// never draws edges. These are the standard React Flow jsdom shims
// (ResizeObserver, DOMMatrixReadOnly, element sizes, getBBox).
export function installReactFlowShims() {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: { width: 800, height: 600 },
          } as unknown as ResizeObserverEntry,
        ],
        this,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.DOMMatrixReadOnly = class {
    m22: number
    constructor(transform: string) {
      const scale = /scale\(([1-9.])\)/.exec(transform)?.[1]
      this.m22 = scale !== undefined ? +scale : 1
    }
  } as unknown as typeof DOMMatrixReadOnly
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get() {
        return parseFloat((this as HTMLElement).style.height) || 1
      },
    },
    offsetWidth: {
      configurable: true,
      get() {
        return parseFloat((this as HTMLElement).style.width) || 1
      },
    },
  })
  ;(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox =
    () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
}
