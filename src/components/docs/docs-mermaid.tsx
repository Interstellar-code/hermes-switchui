import { useEffect } from 'react'

let initialized = false

export function DocsMermaid({ trigger }: { trigger?: string }) {
  useEffect(() => {
    const state = { cancelled: false }

    async function run() {
      const elements = document.querySelectorAll<HTMLElement>('pre.mermaid')
      if (elements.length === 0) return
      const { default: mermaid } = await import('mermaid')
      if (state.cancelled) return
      if (!initialized) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'base',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          themeVariables: {
            primaryColor: 'var(--theme-bg-subtle, #1e293b)',
            primaryTextColor: 'var(--theme-text, #e2e8f0)',
            primaryBorderColor: 'var(--theme-accent, #6366f1)',
            lineColor: 'var(--theme-accent, #818cf8)',
            textColor: 'var(--theme-text, #e2e8f0)',
            mainBkg: 'var(--theme-bg-subtle, #312e81)',
            background: 'transparent',
          },
          flowchart: {
            htmlLabels: true,
            curve: 'basis',
            useMaxWidth: true,
          },
        })
        initialized = true
      }

      for (const el of Array.from(elements)) {
        if (el.dataset.mermaidRendered) continue
        const code = el.textContent || ''
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`
        try {
          const { svg } = await mermaid.render(id, code)
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (state.cancelled) return
          el.innerHTML = svg
          el.dataset.mermaidRendered = 'true'
          el.classList.add('mermaid-rendered')
        } catch (err) {
          console.warn('[mermaid] render failed', err)
        }
      }
    }

    void run()
    return () => {
      state.cancelled = true
    }
  }, [trigger])

  return null
}
