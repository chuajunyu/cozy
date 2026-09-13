import type { Product, Slot } from './types'

function Part({ size, position, color }: { size: [number, number, number]; position: [number, number, number]; color: string }) {
  return <mesh position={position} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
}

export default function Furniture({ product: p, slot, selected, onSelect }: { product: Product; slot: Slot; selected: boolean; onSelect: (id: string) => void }) {
  const w = p.width, h = p.height, d = p.depth
  const leg = '#80664e'
  const legs = (top: number) => [-1, 1].flatMap(x => [-1, 1].map(z => <Part key={`${x}-${z}`} size={[.05, top, .05]} position={[x * (w / 2 - .07), top / 2, z * (d / 2 - .07)]} color={leg} />))
  let model
  switch (p.modelId) {
    case 'sofa':
      model = <><Part size={[w, h * .5, d]} position={[0, h * .25, 0]} color={p.color} /><Part size={[w, h * .55, .15]} position={[0, h * .7, -d / 2 + .075]} color={p.color} />{[-1, 1].map(x => <Part key={x} size={[.13, h * .65, d]} position={[x * (w / 2 - .065), h * .325, 0]} color={p.color} />)}</>
      break
    case 'bed':
      model = <><Part size={[w, .25, d]} position={[0, .125, 0]} color={p.color} /><Part size={[w - .06, .18, d - .08]} position={[0, .34, .02]} color="#ece5d6" /><Part size={[w, h, .1]} position={[0, h / 2, -d / 2 + .05]} color={p.color} /><Part size={[w - .12, .06, d * .5]} position={[0, .45, d * .23]} color="#9ea58b" /><Part size={[w * .65, .09, .35]} position={[0, .475, -d * .3]} color="#f3eee2" /></>
      break
    case 'desk': case 'coffee_table': case 'side_table':
      model = <>{legs(h - .06)}<Part size={[w, .06, d]} position={[0, h - .03, 0]} color={p.color} /></>
      break
    case 'chair':
      model = <>{legs(.4)}<Part size={[w, .07, d]} position={[0, .435, 0]} color={p.color} /><Part size={[w, h - .44, .065]} position={[0, (h + .44) / 2, -d / 2 + .033]} color={p.color} /></>
      break
    case 'shelf':
      model = <>{[0, .5, 1].map(y => <Part key={y} size={[w, .05, d]} position={[0, .025 + y * (h - .05), 0]} color={p.color} />)}{[-1, 1].map(x => <Part key={x} size={[.05, h, d]} position={[x * (w / 2 - .025), h / 2, 0]} color={p.color} />)}<Part size={[w, h, .03]} position={[0, h / 2, -d / 2 + .015]} color={p.color} /></>
      break
    case 'lamp':
      model = <><mesh position={[0, .025, 0]} castShadow receiveShadow><cylinderGeometry args={[w / 2, w / 2, .05, 16]} /><meshStandardMaterial color={leg} /></mesh><Part size={[.035, h * .8, .035]} position={[0, h * .4, 0]} color={leg} /><mesh position={[0, h * .9, 0]} castShadow><cylinderGeometry args={[w * .3, w / 2, h * .2, 16]} /><meshStandardMaterial color={p.color} /></mesh></>
      break
    case 'plant':
      model = <><mesh position={[0, h * .2, 0]} castShadow><cylinderGeometry args={[w * .42, w * .3, h * .4, 12]} /><meshStandardMaterial color="#b48c6b" /></mesh><mesh position={[0, h * .68, 0]} scale={[w / 2, h * .3, d / 2]} castShadow><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color={p.color} /></mesh></>
      break
    default: model = <Part size={[w, h, d]} position={[0, h / 2 + .004, 0]} color={p.color} />
  }
  return <group position={[slot.x, 0, slot.z]} rotation={[0, slot.rotation * Math.PI / 180, 0]} onClick={event => { event.stopPropagation(); onSelect(slot.id) }}>
    {model}
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .031, 0]}><planeGeometry args={[w + .13, d + .13]} /><meshBasicMaterial color="#546f3c" transparent opacity={.28} depthWrite={false} /></mesh>}
  </group>
}
