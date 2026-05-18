import { useEffect } from 'react'

export function DocsHighlight({ trigger }: { trigger?: string }) {
  useEffect(() => {
    const container = document.querySelector('.docs-content')
    if (!container) return undefined

    const blocks = container.querySelectorAll<HTMLElement>(
      'pre:not(.mermaid)',
    )
    const cleanups: Array<() => void> = []

    for (const pre of Array.from(blocks)) {
      if (pre.dataset.copyAttached) continue
      pre.dataset.copyAttached = 'true'
      pre.style.position = 'relative'

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'docs-copy-btn'
      btn.setAttribute('aria-label', 'Copy code')
      btn.textContent = 'Copy'

      const onClick = async () => {
        const codeEl = pre.querySelector('code')
        const text = codeEl?.textContent ?? ''
        try {
          await navigator.clipboard.writeText(text)
          btn.textContent = 'Copied'
          setTimeout(() => {
            btn.textContent = 'Copy'
          }, 1200)
        } catch {
          btn.textContent = 'Failed'
        }
      }
      btn.addEventListener('click', onClick)
      pre.appendChild(btn)
      cleanups.push(() => {
        btn.removeEventListener('click', onClick)
        btn.remove()
        delete pre.dataset.copyAttached
      })
    }

    return () => {
      for (const c of cleanups) c()
    }
  }, [trigger])

  return null
}
