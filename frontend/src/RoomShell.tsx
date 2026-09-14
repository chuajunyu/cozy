import { Html } from '@react-three/drei'
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Product, Scene, Vec3 } from './catalog'
import { doorGeometry } from './doors'
import { defaultWindows, walls, windowGeometry } from './sunlight'
import { wallColor } from './roomFinishes'
import { wallVisible } from './wallVisibility'
import type { Wall } from './sunlight'

function CutawayWall({ wall, top, children, position, rotation }: { wall: Wall; top: boolean; children: React.ReactNode; position: Vec3; rotation: Vec3 }) {
  const group = useRef<Group>(null)
  const direction = useRef(new Vector3())
  const visible = useRef<boolean | undefined>(undefined)
  const lastTop = useRef(top)
  useFrame(({ camera }) => {
    camera.getWorldDirection(direction.current)
    const next = wallVisible(wall, direction.current.x, direction.current.z, top, lastTop.current === top ? visible.current : undefined)
    lastTop.current = top
    visible.current = next
    // Keep meshes mounted/casting shadows; suppress only camera writes and picking.
    group.current?.traverse(object => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return
      object.material.colorWrite = next
      object.material.depthWrite = next
      object.raycast = next ? Mesh.prototype.raycast : noRaycast
    })
  })
  return <group ref={group} position={position} rotation={rotation}>{children}</group>
}

const noRaycast: Mesh['raycast'] = () => {}
import WallpaperMaterial from './WallpaperMaterial'
export default function RoomShell({ scene, catalog, top, showCompass = false }: { scene: Scene; catalog: Product[]; top: boolean; showCompass?: boolean }) {
  const windows = scene.windows ?? defaultWindows
  return <group>
    {walls.map(wall => {
      const wallWindows = windows.filter(window => window.wall === wall)
      const length = wall === 'north' || wall === 'south' ? scene.width : scene.depth
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
      return <CutawayWall key={wall} wall={wall} top={top} position={position} rotation={rotation}>
        {blocks.filter(([a,b,c,d]) => b > a && d > c).map(([a,b,c,d], i) => {
          // North/south walls cover the corner ends of the east/west walls.
          // Sink the bottom edge into the slab to avoid a rasterized hairline.
          const capEnds = wall === 'north' || wall === 'south'
          const left = capEnds && a === 0 ? -.1 : a
          const right = capEnds && b === length ? length + .1 : b
          const bottom = c === 0 ? -.002 : c
          return <mesh key={i} userData={{ roomShell: true }} position={[(left+right)/2-length/2, (bottom+d)/2, 0]} castShadow receiveShadow>
            <boxGeometry args={[right-left, d-bottom, 0.1]} />
            <WallpaperMaterial pattern={scene.wallpapers?.[wall]} color={wallColor(scene, wall)} visible={true} width={right-left} height={d-bottom} left={left} bottom={bottom} />
          </mesh>
        })}
        {showCompass && <Html position={[0,0.06,0]} center style={{pointerEvents:'none'}}><span className="compass-label">{wall[0].toUpperCase()}</span></Html>}
      </CutawayWall>
    })}
    {/* Cutaway roof is invisible to the camera, but blocks sunlight from bypassing windows. */}
    <mesh userData={{ roomShell: true }} raycast={() => {}} position={[0,(scene.height ?? 2.6)+.06,0]} castShadow receiveShadow>
      <boxGeometry args={[scene.width+0.2,0.12,scene.depth+0.2]} />
      <meshStandardMaterial color="#f5f1e9" roughness={.95} colorWrite={false} depthWrite={false} />
    </mesh>
  </group>
}
