import { useEffect } from 'react'
import '@/styles/matrix-workflows.css'
import { WorkflowsLayout } from './workflows-layout'
import { useWorkflowBackendStore } from '@/stores/workflow-backend-store'
import { ensurePluginInstalled } from '@/server/workflow-engine/ensure-plugin-installed'

export function WorkflowsScreen() {
  const backend = useWorkflowBackendStore((s) => s.backend)

  // ── Auto-probe plugin on mount when backend=plugin ───────────────────────
  useEffect(() => {
    if (backend === 'plugin') {
      void ensurePluginInstalled()
    }
  }, [backend])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function dispatch(msg: string) {
      window.dispatchEvent(new CustomEvent('wf-toast', { detail: { msg } }))
    }

    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      switch (e.key.toLowerCase()) {
        case 'k':
          e.preventDefault()
          dispatch('Workflow palette coming v1.1')
          break
        case 'n':
          e.preventDefault()
          dispatch('New workflow coming v1.1')
          break
        case 'd':
          e.preventDefault()
          dispatch('Duplicate workflow coming v1.1')
          break
        case 'e': {
          e.preventDefault()
          const yamlPre = document.querySelector<HTMLElement>('.wfe-yaml-code')
          if (yamlPre) yamlPre.focus()
          else dispatch('Switch to YAML tab first (⌘E)')
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div data-screen="workflows" className="wf">
      <WorkflowsLayout />
    </div>
  )
}
