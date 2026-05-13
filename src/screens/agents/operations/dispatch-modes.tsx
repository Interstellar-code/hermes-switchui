import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import type { DispatchMode } from '../../../stores/operations-ui-store'

const MODES: Array<{ key: DispatchMode; label: string }> = [
  { key: 'auto', label: 'auto' },
  { key: 'broadcast', label: 'broadcast' },
  { key: 'manual', label: 'manual' },
]

export function DispatchModes() {
  const dispatchMode = useOperationsUIStore((s) => s.dispatchMode)
  const setDispatchMode = useOperationsUIStore((s) => s.setDispatchMode)

  return (
    <div className="disp-modes">
      {MODES.map(({ key, label }) => (
        <button
          key={key}
          className={`disp-mode${dispatchMode === key ? ' disp-mode--active' : ''}`}
          onClick={() => setDispatchMode(key)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}
