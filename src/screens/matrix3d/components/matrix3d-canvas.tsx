import type { Matrix3DOfficeData } from '../use-matrix3d-office-data'
import { RetroOffice3D } from '@/features/retro-office/RetroOffice3D'

type Matrix3DCanvasProps = {
  officeData: Matrix3DOfficeData
  focusRequest: { id: string; n: number } | null
  onAgentSelect: (agentId: string) => void
}

export function Matrix3DCanvas({
  officeData,
  focusRequest,
  onAgentSelect,
}: Matrix3DCanvasProps) {
  return (
    <div className="relative z-[1] h-full overflow-hidden bg-[#020617]">
      <RetroOffice3D
        {...officeData}
        showViewportHud={false}
        focusRequest={focusRequest}
        onAgentChatSelect={onAgentSelect}
      />
    </div>
  )
}
