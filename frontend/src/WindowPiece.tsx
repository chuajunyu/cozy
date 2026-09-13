import { Edges } from '@react-three/drei'
import type { Scene, Vec3 } from './catalog'
import { windowGeometry, type RoomWindow } from './sunlight'

export default function WindowPiece({ window, scene, selected, invalid }: { window: RoomWindow; scene: Scene; selected: boolean; invalid: boolean }) {
  const opening = windowGeometry(window, scene)
  const along = (opening.start + opening.end - opening.length) / 2
  const y = window.sill + window.height / 2
  const wall = window.wall
  const position: Vec3 = wall === 'north' ? [along, y, -scene.depth / 2 - .05] : wall === 'south' ? [along, y, scene.depth / 2 + .05]
    : wall === 'west' ? [-scene.width / 2 - .05, y, -along] : [scene.width / 2 + .05, y, -along]
  return <group position={position} rotation={[0, wall === 'east' || wall === 'west' ? Math.PI / 2 : 0, 0]}>
    {window.curtain && window.curtain !== 'none' && <group position={[0,0,(wall === 'north' || wall === 'west' ? 1 : -1)*.19]}>
      <mesh position={[0,window.height/2+.09,0]}><boxGeometry args={[window.width+.24,.022,.022]} /><meshStandardMaterial color="#5a5349" /></mesh>
      {[-1,1].flatMap(side => Array.from({length:8}, (_,i) => {
        const height = window.sill+window.height+.04
        return <mesh key={`${side}-${i}`} position={[side*(window.width/2-.035) + (i-3.5)*window.width*.025, .05+height/2-y, (i%2)*.022]} castShadow={window.curtain !== 'sheer'} receiveShadow>
          <boxGeometry args={[window.width*.027,height,.012]} />
          <meshStandardMaterial color={window.curtain === 'blackout' ? '#55575a' : window.curtain === 'linen' ? '#cbbba2' : '#f5f1e9'} roughness={1} transparent={window.curtain === 'sheer'} opacity={window.curtain === 'sheer' ? .48 : 1} depthWrite={window.curtain !== 'sheer'} />
        </mesh>
      }))}
    </group>}
    {[-1, 1].map(sign => <group key={sign}>
      <mesh position={[sign * opening.width / 2, 0, 0]} castShadow receiveShadow><boxGeometry args={[.055, window.height + .08, .16]} /><meshStandardMaterial color="#faf7ee" /></mesh>
      <mesh position={[0, sign * window.height / 2, 0]} castShadow receiveShadow><boxGeometry args={[opening.width, .055, .16]} /><meshStandardMaterial color="#faf7ee" /></mesh>
    </group>)}
    <mesh castShadow receiveShadow><boxGeometry args={[.035, window.height, .1]} /><meshStandardMaterial color="#faf7ee" /></mesh>
    <mesh><boxGeometry args={[opening.width, window.height, .025]} /><meshBasicMaterial color={invalid ? '#c76151' : '#b8d9de'} transparent opacity={selected ? .16 : .055} depthWrite={false} />{selected && <Edges color={invalid ? '#b44e3e' : '#546b4b'} />}</mesh>
  </group>
}
