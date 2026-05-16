import { useMemo } from 'react'

/** Matrix rain bars — lightweight WebGL vertical bars along the back wall. */
export function MatrixRain() {
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
          <meshStandardMaterial
            color="#22c55e"
            emissive="#16a34a"
            emissiveIntensity={0.9}
            transparent
            opacity={0.45}
          />
        </mesh>
      ))}
    </group>
  )
}
