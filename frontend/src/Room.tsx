import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { memo } from 'react'
import Furniture from './Furniture'
import type { DesignState, Product } from './types'

function Camera() {
  const size = useThree(state => state.size)
  const zoom = Math.min(size.width / 6.5, size.height / 5.8, 75)
  return <>
    <OrthographicCamera makeDefault position={[7, 6, 7]} zoom={zoom} near={0.1} far={60} />
    <OrbitControls
      makeDefault
      target={[0, 0.8, 0]}
      enablePan={false}
      minZoom={zoom * 0.6}
      maxZoom={zoom * 2}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI / 2 - 0.05}
    />
  </>
}

function Room({ lightAngle, state, catalog, selected, onSelect }: { lightAngle: number; state: DesignState | null; catalog: Product[]; selected: string[]; onSelect: (id: string) => void }) {
  const radians = lightAngle * Math.PI / 180

  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 1.5]}
      fallback={<p className="canvas-fallback">This room needs a browser with WebGL enabled.</p>}
    >
      <ambientLight intensity={1.1} />
      <directionalLight
        position={[Math.cos(radians) * 5, 6, Math.sin(radians) * 5]}
        intensity={3}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={0.1}
        shadow-camera-far={20}
        shadow-normalBias={0.025}
      />
      {/* Meters; the top of the floor is y = 0. */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[4.2, 0.2, 3.7]} />
        <meshStandardMaterial color="#c8b294" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.3, -1.8]} castShadow receiveShadow>
        <boxGeometry args={[4.2, 2.6, 0.1]} />
        <meshStandardMaterial color="#f0e8d9" roughness={0.95} />
      </mesh>
      <mesh position={[-2.05, 1.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.1, 2.6, 3.7]} />
        <meshStandardMaterial color="#e2dfd0" roughness={0.95} />
      </mesh>
      {Object.values(state?.slots ?? {}).map(slot => {
        const product = catalog.find(p => p.id === slot.catalogId)
        return product && <Furniture key={slot.id} product={product} slot={slot} selected={selected.includes(slot.id)} onSelect={onSelect} />
      })}
      <Camera />
    </Canvas>
  )
}

export default memo(Room)
