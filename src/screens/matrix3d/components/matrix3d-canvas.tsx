import { useMatrix3DOfficeData } from '../use-matrix3d-office-data'
import { RetroOffice3D } from '@/features/retro-office/RetroOffice3D'

export function Matrix3DCanvas() {
  const officeData = useMatrix3DOfficeData()

  return (
    <div className="h-full min-h-[520px] overflow-hidden rounded-[22px] border border-emerald-500/15 bg-[#020617]">
      <RetroOffice3D {...officeData} />
    </div>
  )
}
