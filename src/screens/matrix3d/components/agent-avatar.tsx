import { useFrame } from '@react-three/fiber'
import { Float, Text } from '@react-three/drei'
import { useRef } from 'react'
import type { AgentNode, AgentStatus } from '../hooks/use-agent-positions'

function statusColor(state: AgentStatus) {
  if (state === 'active') return '#34d399'
  if (state === 'blocked') return '#f87171'
  return '#94a3b8'
}

type AgentAvatarProps = {
  node: AgentNode
  onClick?: (id: string) => void
}

/** 3D capsule avatar representing a live Hermes session. */
export function AgentAvatar({ node, onClick }: AgentAvatarProps) {
  const ref = useRef<any>(null)
  const glow = statusColor(node.status)

  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.getElapsedTime()
    ref.current.position.y =
      0.52 + Math.sin(t * (node.status === 'active' ? 3.1 : 1.4) + node.position[0]) * 0.05
    ref.current.rotation.y = Math.sin(t * 0.8 + node.position[2]) * 0.16
  })

  return (
    <group
      position={node.position}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(node.id)
      }}
    >
      <Float
        speed={node.status === 'active' ? 2.2 : 1.1}
        rotationIntensity={0.15}
        floatIntensity={0.2}
      >
        <mesh ref={ref} castShadow receiveShadow>
          <capsuleGeometry args={[0.24, 0.7, 8, 16]} />
          <meshStandardMaterial
            color={glow}
            emissive={glow}
            emissiveIntensity={0.38}
            roughness={0.25}
            metalness={0.2}
          />
        </mesh>
      </Float>
      {/* Status ring */}
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[0.3, 0.38, 32]} />
        <meshBasicMaterial color={glow} transparent opacity={0.65} />
      </mesh>
      {/* Name label */}
      <Text
        position={[0, 1.18, 0]}
        fontSize={0.15}
        color="#e5e7eb"
        anchorX="center"
        anchorY="middle"
      >
        {node.name}
      </Text>
      {/* Status label */}
      <Text
        position={[0, 0.97, 0]}
        fontSize={0.1}
        color="#94a3b8"
        anchorX="center"
        anchorY="middle"
      >
        {node.status}
      </Text>
    </group>
  )
}
