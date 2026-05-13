import '@/styles/matrix-conductor.css'
import { ConductorLayout } from './conductor/conductor-layout'

export function Conductor() {
  return (
    <div data-screen="conductor" className="cnd">
      <ConductorLayout />
    </div>
  )
}
