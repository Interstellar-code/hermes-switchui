import type { Matrix3DOfficeData } from '../use-matrix3d-office-data'
import { RetroOffice3D } from '@/features/retro-office/RetroOffice3D'

type Matrix3DCanvasProps = {
  officeData: Matrix3DOfficeData
}

export function Matrix3DCanvas({ officeData }: Matrix3DCanvasProps) {
  return (
    <div className="relative z-[1] h-full overflow-hidden bg-[#020617]">
      <RetroOffice3D {...officeData} showViewportHud={false} />
    </div>
  )
}
