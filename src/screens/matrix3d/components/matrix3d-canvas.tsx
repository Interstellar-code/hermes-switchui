import { useMemo } from 'react'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import { RetroOffice3D } from '@/features/retro-office/RetroOffice3D'
import { createDefaultAgentAvatarProfile } from '@/lib/avatars/profile'

const DEMO_AGENTS: Array<OfficeAgent> = [
  {
    id: 'main',
    name: 'Claude',
    subtitle: 'Claw3D Demo',
    status: 'working',
    color: '#34d399',
    item: 'laptop',
    avatarProfile: createDefaultAgentAvatarProfile('main'),
  },
  {
    id: 'research',
    name: 'Luna',
    subtitle: 'Research Analyst',
    status: 'idle',
    color: '#38bdf8',
    item: 'globe',
    avatarProfile: createDefaultAgentAvatarProfile('research'),
  },
  {
    id: 'builder',
    name: 'Roger',
    subtitle: 'Frontend Developer',
    status: 'working',
    color: '#a78bfa',
    item: 'palette',
    avatarProfile: createDefaultAgentAvatarProfile('builder'),
  },
  {
    id: 'qa',
    name: 'Ada',
    subtitle: 'QA Engineer',
    status: 'idle',
    color: '#fbbf24',
    item: 'shield',
    avatarProfile: createDefaultAgentAvatarProfile('qa'),
  },
]

export function Matrix3DCanvas() {
  const agents = useMemo(() => DEMO_AGENTS, [])

  return (
    <div className="h-full min-h-[520px] overflow-hidden rounded-[22px] border border-emerald-500/15 bg-[#020617]">
      <RetroOffice3D
        agents={agents}
        readOnly
        storageNamespace="matrix3d-claw3d-demo"
        layoutPreset="office"
        officeTitle="Matrix3D Office"
        officeTitleLoaded
        gatewayStatus="demo"
        selectedAdapterType="demo"
        activeAdapterType="demo"
      />
    </div>
  )
}
