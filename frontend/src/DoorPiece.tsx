import { Edges } from '@react-three/drei'
import type { Item, Product, Scene, Vec3 } from './catalog'
import { doorGeometry } from './doors'

export function DoorVisual({
  product,
  angle = 0,
  selected = false,
}: {
  product: Product
  angle?: number
  selected?: boolean
}) {
  const [width, height, depth] = product.dimensions
  return <group>
    {[-1, 1].map(side => <mesh key={side} position={[side * (width / 2 + 0.03), (height + 0.06) / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.06, height + 0.06, 0.16]} />
      <meshStandardMaterial color="#faf7ee" roughness={0.8} />
    </mesh>)}
    <mesh position={[0, height + 0.03, 0]} castShadow receiveShadow>
      <boxGeometry args={[width, 0.06, 0.16]} />
      <meshStandardMaterial color="#faf7ee" roughness={0.8} />
    </mesh>
    {/* Only the moving leaf occludes diffuse transport, never the doorway's frame bounds. */}
    <group position={[-width / 2, 0, 0]} rotation={[0, angle, 0]} userData={{ daylightFurniture: true }}>
      <mesh position={[width / 2, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color="#e8dfcf" roughness={0.8} />
        {selected && <Edges color="#546b4b" />}
      </mesh>
      {[-1, 1].map(side => <group key={side}>
        {[0.27, 0.73].map(level => <mesh key={level} position={[width / 2, height * level, side * (depth / 2 + 0.002)]} receiveShadow>
          <boxGeometry args={[width * 0.73, height * 0.35, 0.004]} />
          <meshStandardMaterial color="#ded4c2" roughness={0.85} />
        </mesh>)}
        <mesh position={[width - 0.12, height * 0.47, side * (depth / 2 + 0.02)]} receiveShadow>
          <boxGeometry args={[0.04, 0.12, 0.02]} />
          <meshStandardMaterial color="#8a806b" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[width - 0.17, height * 0.47, side * (depth / 2 + 0.045)]} receiveShadow>
          <boxGeometry args={[0.14, 0.022, 0.025]} />
          <meshStandardMaterial color="#8a806b" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>)}
    </group>
  </group>
}

export default function DoorPiece({ item, product, scene, selected, onSelect }: {
  item: Item
  product: Product
  scene: Scene
  selected: boolean
  onSelect: (id: string) => void
}) {
  if (!item.door) return null
  const opening = doorGeometry(item, product, scene)
  const along = (opening.start + opening.end - opening.length) / 2
  const wall = opening.wall
  const position: Vec3 = wall === 'north' ? [along, 0, -scene.depth / 2 - 0.05]
    : wall === 'south' ? [along, 0, scene.depth / 2 + 0.05]
      : wall === 'west' ? [-scene.width / 2 - 0.05, 0, -along]
        : [scene.width / 2 + 0.05, 0, -along]
  const rotation = wall === 'east' || wall === 'west' ? Math.PI / 2 : 0
  const angle = item.door.open ? (wall === 'north' || wall === 'west' ? -1 : 1) * Math.PI / 2 : 0
  return <group position={position} rotation={[0, rotation, 0]} onPointerDown={event => {
    event.stopPropagation()
    onSelect(item.id)
  }}>
    <DoorVisual product={product} angle={angle} selected={selected} />
  </group>
}
