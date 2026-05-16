import { Canvas } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import { useCallback } from 'react'
import { MatrixRain } from './matrix-rain'
import { OfficeRoom } from './office-room'
import { OfficeLighting } from './office-lighting'
import { AgentAvatar } from './agent-avatar'
import { Desk } from './desk'
import { useAgentPositions } from '../hooks/use-agent-positions'
import type { AgentNode } from '../hooks/use-agent-positions'

// ── Desk layout (must match use-agent-positions DESK_POSITIONS) ──

const DESKS: { position: [number, number, number]; label: string }[] = [
  { position: [-4.4, 0, -1.8], label: 'OPS' },
  { position: [-1.3, 0, 1.55], label: 'INTEL' },
  { position: [1.9, 0, -1.25], label: 'FORGE' },
  { position: [4.75, 0, 1.75], label: 'WATCH' },
]

// ── Scene ────────────────────────────────────────────────────────

type SceneContentsProps = {
  agents: AgentNode[]
  onAgentClick?: (id: string) => void
}

function SceneContents({ agents, onAgentClick }: SceneContentsProps) {
  return (
    <>
      <fog attach="fog" args={['#020617', 10, 24]} />
      <color attach="background" args={['#030712']} />

      <OfficeLighting />
      <OfficeRoom />
      <MatrixRain />

      {/* Static desks */}
      {DESKS.map((d) => (
        <Desk key={d.label} position={d.position} label={d.label} />
      ))}

      {/* Live agent avatars */}
      {agents.map((node) => (
        <AgentAvatar key={node.id} node={node} onClick={onAgentClick} />
      ))}

      {/* Title */}
      <Text
        position={[0, 2.2, -3.78]}
        fontSize={0.28}
        color="#4ade80"
        anchorX="center"
        anchorY="middle"
      >
        MATRIX3D
      </Text>

      <OrbitControls
        enablePan={false}
        minDistance={8}
        maxDistance={16}
        minPolarAngle={Math.PI / 3.6}
        maxPolarAngle={Math.PI / 2.15}
        target={[0, 0.8, 0]}
      />
    </>
  )
}

// ── Canvas wrapper ───────────────────────────────────────────────

type Matrix3DCanvasProps = {
  onAgentSelect?: (id: string) => void
}

export function Matrix3DCanvas({ onAgentSelect }: Matrix3DCanvasProps) {
  const { agents, loading, error } = useAgentPositions()

  const handleAgentClick = useCallback(
    (id: string) => {
      onAgentSelect?.(id)
    },
    [onAgentSelect],
  )

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-[22px] border border-emerald-500/15 bg-[#020617]">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-sm text-emerald-400/70 animate-pulse tracking-widest uppercase">
            Scanning sessions...
          </div>
        </div>
      )}
      {error && (
        <div className="absolute top-3 right-3 z-10 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}
      <Canvas camera={{ position: [0, 7.2, 9.6], fov: 42 }} shadows dpr={[1, 1.75]}>
        <SceneContents agents={agents} onAgentClick={handleAgentClick} />
      </Canvas>
    </div>
  )
}
