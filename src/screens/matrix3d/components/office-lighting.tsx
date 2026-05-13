/** Lighting rig for the Matrix3D office — green-tinted, dramatic. */
export function OfficeLighting() {
  return (
    <>
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
    </>
  )
}
