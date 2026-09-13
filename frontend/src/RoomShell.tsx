import { Html } from '@react-three/drei'
import type { Product, Scene, Vec3 } from './catalog'
import { doorGeometry } from './doors'
import { defaultWindows, walls, windowGeometry } from './sunlight'
import { wallColor } from './roomFinishes'

export default function RoomShell({ scene, catalog, top, showCompass = false }: { scene: Scene; catalog: Product[]; top: boolean; showCompass?: boolean }) {
  const windows = scene.windows ?? defaultWindows
  return <group>
    {walls.map(wall => {
      const wallWindows = windows.filter(window => window.wall === wall)
      const length = wall === 'north' || wall === 'south' ? scene.width : scene.depth
      const visible = !top && (wall === 'north' || wall === 'west')
      const rotation: Vec3 = [0, wall === 'east' || wall === 'west' ? Math.PI / 2 : 0, 0]
      const position: Vec3 = wall === 'north' ? [0, 0, -scene.depth / 2 - 0.05] : wall === 'south' ? [0, 0, scene.depth / 2 + 0.05] : wall === 'west' ? [-scene.width / 2 - 0.05, 0, 0] : [scene.width / 2 + 0.05, 0, 0]
      // Every doorway remains a hole in the wall; its opaque leaf closes it.
      const openings = [
        ...wallWindows.map(window => windowGeometry(window, scene)),
        ...scene.items.flatMap(item => {
          const product = catalog.find(product => product.id === item.productId)
          return product?.door && item.door?.wall === wall ? [doorGeometry(item, product, scene)] : []
        }),
      ]
      const edges = [...new Set([0, length, ...openings.flatMap(opening => [opening.start, opening.end])])].sort((a, b) => a - b)
      const blocks = edges.slice(0, -1).flatMap((start, index) => {
        const end = edges[index + 1]
        const middle = (start + end) / 2
        const holes = openings.filter(opening => middle > opening.start && middle < opening.end)
        const heights = [...new Set([0, scene.height ?? 2.6, ...holes.flatMap(opening => [opening.bottom, opening.top])])].sort((a, b) => a - b)
        return heights.slice(0, -1).flatMap((bottom, level) => {
          const top = heights[level + 1]
          return holes.some(opening => (bottom + top) / 2 > opening.bottom && (bottom + top) / 2 < opening.top)
            ? [] : [[start, end, bottom, top]]
        })
      })
      return <group key={wall} position={position} rotation={rotation}>
        {blocks.filter(([a,b,c,d]) => b > a && d > c).map(([a,b,c,d], i) => <mesh key={i} raycast={visible ? undefined : () => {}} position={[(a+b)/2-length/2, (c+d)/2, 0]} castShadow receiveShadow>
          <boxGeometry args={[b-a, d-c, 0.1]} />
          <meshStandardMaterial color={wallColor(scene, wall)} colorWrite={visible} depthWrite={visible} />
        </mesh>)}
        {showCompass && <Html position={[0,0.06,0]} center style={{pointerEvents:'none'}}><span className="compass-label">{wall[0].toUpperCase()}</span></Html>}
      </group>
    })}
    {/* Cutaway roof is invisible to the camera, but blocks sunlight from bypassing windows. */}
    <mesh raycast={() => {}} position={[0,(scene.height ?? 2.6)+.06,0]} castShadow>
      <boxGeometry args={[scene.width+0.2,0.12,scene.depth+0.2]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>
  </group>
}
