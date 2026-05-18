import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'

export function DocsRenderer({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const handleClick = useCallback(
    (event: MouseEvent) => {
      // Only handle plain left-clicks without modifier keys
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = (event.target as Element).closest('a')
      if (!target) return

      const href = target.getAttribute('href')
      if (!href) return

      // Only intercept same-origin /docs/ links without target="_blank"
      if (
        !href.startsWith('/docs/') ||
        target.getAttribute('target') === '_blank'
      ) {
        return
      }

      // Verify same origin
      const origin = window.location.origin
      const absolute = new URL(href, origin)
      if (absolute.origin !== origin) return

      event.preventDefault()
      // Extract the splat portion after /docs/
      const splatPath = absolute.pathname.replace(/^\/docs\//, '')
      void navigate({
        to: '/docs/$',
        params: { _splat: splatPath },
        hash: absolute.hash.replace(/^#/, ''),
      })
    },
    [navigate],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [handleClick])

  return (
    <div
      ref={containerRef}
      className="docs-content max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
