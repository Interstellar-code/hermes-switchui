import { useEffect, useRef } from 'react'
import { useConductorUIStore } from '@/stores/conductor-ui-store'
import { RunDetailPanel } from '@/screens/workflows/run-detail-panel'

export function MissionDetailDrawer() {
  const drawerRunId = useConductorUIStore((s) => s.drawerRunId)
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)

  const panelRef = useRef<HTMLElement>(null)
  const close = () => setDrawerRunId(null)

  useEffect(() => {
    if (!drawerRunId) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && setDrawerRunId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerRunId, setDrawerRunId])

  if (!drawerRunId) return null

  return (
    <div className="mdd-backdrop">
      <aside
        ref={panelRef}
        className="mdd"
        role="dialog"
        aria-modal="true"
        aria-label="Mission detail"
        tabIndex={-1}
      >
        <RunDetailPanel runId={drawerRunId} onClose={close} />
      </aside>
    </div>
  )
}
