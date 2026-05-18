import { useEffect, useState } from 'react'

export function DocsScrollProgress() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const container = document.querySelector(
      '[data-docs-scroll]',
    )
    if (!container) return undefined

    let raf = 0
    function update() {
      const el = container!
      const max = el.scrollHeight - el.clientHeight
      const pct = max > 0 ? (el.scrollTop / max) * 100 : 0
      setProgress(pct)
    }
    function onScroll() {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }

    update()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      container.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <div className="sticky top-0 z-10 h-0.5 w-full bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)]">
      <div
        className="h-full bg-[var(--theme-accent)] transition-[width] duration-100"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}
