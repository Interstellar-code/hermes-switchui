import { Canvas, useFrame } from '@react-three/fiber'
import { Float, OrbitControls, RoundedBox, Text } from '@react-three/drei'
import { useMemo, useRef } from 'react'

type AgentState = 'active' | 'idle' | 'blocked'

type AgentNode = {
  id: string
  name: string
  state: AgentState
  position: [number, number, number]
  deskLabel: string
}

const AGENTS: AgentNode[] = [
  { id: 'switch', name: 'Switch', state: 'active', position: [-4.4, 0, -1.8], deskLabel: 'Ops' },
  { id: 'research', name: 'Research', state: 'idle', position: [-1.3, 0, 1.55], deskLabel: 'Intel' },
  { id: 'builder', name: 'Builder', state: 'active', position: [1.9, 0, -1.25], deskLabel: 'Forge' },
  { id: 'watcher', name: 'Watcher', state: 'blocked', position: [4.75, 0, 1.75], deskLabel: 'Watch' },
]

function statusColor(state: AgentState) {
  if (state === 'active') return '#34d399'
  if (state === 'blocked') return '#f87171'
  return '#94a3b8'
}

function MatrixRain() {
  const bars = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        x: -8 + i * 0.95,
        h: 0.7 + (i % 5) * 0.28,
        z: -3.6 - (i % 4) * 0.25,
      })),
    [],
  )

  return (
    <group>
      {bars.map((bar, idx) => (
        <mesh key={idx} position={[bar.x, 2.2 + bar.h / 2, bar.z]}>
          <boxGeometry args={[0.03, bar.h, 0.03]} />
          <meshStandardMaterial color="#22c55e" emissive="#16a34a" emissiveIntensity={0.9} transparent opacity={0.45} />
        </mesh>
      ))}
    </group>
  )
}

function Desk({ position, label }: { position: [number, number, number]; label: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.8, 0.08, 0.95]} />
        <meshStandardMaterial color="#111827" metalness={0.4} roughness={0.45} />
      </mesh>
      <mesh position={[0.68, 0.72, -0.12]} castShadow>
        <boxGeometry args={[0.5, 0.36, 0.08]} />
        <meshStandardMaterial color="#0f172a" emissive="#10b981" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[-0.65, 0.2, 0.15]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.32, 18]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <Text position={[0, 0.92, 0.46]} fontSize={0.14} color="#86efac" anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  )
}

function AgentAvatar({ node }: { node: AgentNode }) {
  const ref = useRef<any>(null)
  const glow = statusColor(node.state)

  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.getElapsedTime()
    ref.current.position.y = 0.52 + Math.sin(t * (node.state === 'active' ? 3.1 : 1.4) + node.position[0]) * 0.05
    ref.current.rotation.y = Math.sin(t * 0.8 + node.position[2]) * 0.16
  })

  return (
    <group position={node.position}>
      <Float speed={node.state === 'active' ? 2.2 : 1.1} rotationIntensity={0.15} floatIntensity={0.2}>
        <mesh ref={ref} castShadow receiveShadow>
          <capsuleGeometry args={[0.24, 0.7, 8, 16]} />
          <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.38} roughness={0.25} metalness={0.2} />
        </mesh>
      </Float>
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[0.3, 0.38, 32]} />
        <meshBasicMaterial color={glow} transparent opacity={0.65} />
      </mesh>
      <Text position={[0, 1.18, 0]} fontSize={0.15} color="#e5e7eb" anchorX="center" anchorY="middle">
        {node.name}
      </Text>
      <Text position={[0, 0.97, 0]} fontSize={0.1} color="#94a3b8" anchorX="center" anchorY="middle">
        {node.state}
      </Text>
    </group>
  )
}

function SceneContents() {
  return (
    <>
      <fog attach="fog" args={['#020617', 10, 24]} />
      <color attach="background" args={['#030712']} />
      <ambientLight intensity={0.45} color="#9ae6b4" />
      <directionalLight
        castShadow
        position={[6, 10, 4]}
        intensity={1.35}
        color="#d1fae5"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[-6, 3, -4]} intensity={24} distance={18} color="#10b981" />
      <pointLight position={[5, 2.5, 5]} intensity={15} distance={16} color="#22c55e" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 14, 18, 18]} />
        <meshStandardMaterial color="#030712" roughness={0.92} metalness={0.08} />
      </mesh>

      <gridHelper args={[20, 20, '#14532d', '#052e16']} position={[0, 0.01, 0]} />

      <RoundedBox args={[12, 0.1, 7.8]} radius={0.08} position={[0, 0.05, 0]} receiveShadow>
        <meshStandardMaterial color="#0b1120" roughness={0.85} metalness={0.1} />
      </RoundedBox>

      <RoundedBox args={[12, 2.4, 0.18]} radius={0.04} position={[0, 1.2, -3.9]} receiveShadow>
        <meshStandardMaterial color="#0f172a" emissive="#052e16" emissiveIntensity={0.15} />
      </RoundedBox>

      <RoundedBox args={[0.18, 2.4, 7.8]} radius={0.04} position={[-6, 1.2, 0]} receiveShadow>
        <meshStandardMaterial color="#0f172a" />
      </RoundedBox>

      <RoundedBox args={[0.18, 2.4, 7.8]} radius={0.04} position={[6, 1.2, 0]} receiveShadow>
        <meshStandardMaterial color="#0f172a" />
      </RoundedBox>

      <MatrixRain />

      <Desk position={[-4.4, 0, -1.8]} label="OPS" />
      <Desk position={[-1.3, 0, 1.55]} label="INTEL" />
      <Desk position={[1.9, 0, -1.25]} label="FORGE" />
      <Desk position={[4.75, 0, 1.75]} label="WATCH" />

      {AGENTS.map((node) => (
        <AgentAvatar key={node.id} node={node} />
      ))}

      <Text position={[0, 2.2, -3.78]} fontSize={0.28} color="#4ade80" anchorX="center" anchorY="middle">
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

export function Matrix3DCanvas() {
  return (
    <div className="h-full min-h-[520px] overflow-hidden rounded-[22px] border border-emerald-500/15 bg-[#020617]">
      <Canvas camera={{ position: [0, 7.2, 9.6], fov: 42 }} shadows dpr={[1, 1.75]}>
        <SceneContents />
      </Canvas>
    </div>
  )
}
