import { RoundedBox } from '@react-three/drei'

/** Static office room geometry — floor, walls, platform, grid. */
export function OfficeRoom() {
  return (
    <>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 14, 18, 18]} />
        <meshStandardMaterial color="#030712" roughness={0.92} metalness={0.08} />
      </mesh>

      {/* Grid overlay */}
      <gridHelper args={[20, 20, '#14532d', '#052e16']} position={[0, 0.01, 0]} />

      {/* Platform */}
      <RoundedBox args={[12, 0.1, 7.8]} radius={0.08} position={[0, 0.05, 0]} receiveShadow>
        <meshStandardMaterial color="#0b1120" roughness={0.85} metalness={0.1} />
      </RoundedBox>

      {/* Back wall */}
      <RoundedBox args={[12, 2.4, 0.18]} radius={0.04} position={[0, 1.2, -3.9]} receiveShadow>
        <meshStandardMaterial color="#0f172a" emissive="#052e16" emissiveIntensity={0.15} />
      </RoundedBox>

      {/* Left wall */}
      <RoundedBox args={[0.18, 2.4, 7.8]} radius={0.04} position={[-6, 1.2, 0]} receiveShadow>
        <meshStandardMaterial color="#0f172a" />
      </RoundedBox>

      {/* Right wall */}
      <RoundedBox args={[0.18, 2.4, 7.8]} radius={0.04} position={[6, 1.2, 0]} receiveShadow>
        <meshStandardMaterial color="#0f172a" />
      </RoundedBox>
    </>
  )
}
