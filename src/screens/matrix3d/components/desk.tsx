import { Text } from '@react-three/drei'

export function Desk({ position, label }: { position: [number, number, number]; label: string }) {
  return (
    <group position={position}>
      {/* Desktop surface */}
      <mesh position={[0, 0.45, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.8, 0.08, 0.95]} />
        <meshStandardMaterial color="#111827" metalness={0.4} roughness={0.45} />
      </mesh>
      {/* Monitor */}
      <mesh position={[0.68, 0.72, -0.12]} castShadow>
        <boxGeometry args={[0.5, 0.36, 0.08]} />
        <meshStandardMaterial color="#0f172a" emissive="#10b981" emissiveIntensity={0.18} />
      </mesh>
      {/* Coffee mug */}
      <mesh position={[-0.65, 0.2, 0.15]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.32, 18]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      {/* Desk label */}
      <Text
        position={[0, 0.92, 0.46]}
        fontSize={0.14}
        color="#86efac"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  )
}
