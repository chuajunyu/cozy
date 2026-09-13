import { useEffect, useState } from 'react'
import type { Item, Product, Scene } from './catalog'
import { defaultFloorColor, defaultWallColors, floorColor, wallColor } from './roomFinishes'
import { walls, type Wall } from './sunlight'
import { wallFixtureGeometry } from './wallFixtures'

const paints = [
  ['Warm white', '#eee9df'], ['Sage', '#dadfd3'], ['Sand', '#d8bea0'],
  ['Terracotta', '#be7967'], ['Dusty blue', '#8ca5b7'], ['Charcoal', '#454b4e'],
]
const floors = [
  ['Natural oak', '#c7ac88'], ['Pale oak', '#dfcbaa'], ['Walnut', '#79553e'],
  ['Warm stone', '#b5afa2'], ['Soft white', '#e5e1d8'], ['Slate', '#596064'],
]

export default function RoomCustomization({ scene, onChange }: {
  scene: Scene; onChange: (scene: Scene) => void
}) {
  const [target, setTarget] = useState<Wall | 'all' | 'floor'>('all')
  const selectedColor = target === 'floor' ? floorColor(scene) : wallColor(scene, target === 'all' ? 'north' : target)
  const [custom, setCustom] = useState(selectedColor)
  useEffect(() => { setCustom(selectedColor) }, [selectedColor, target])
  const apply = (color: string) => onChange(target === 'floor' ? { ...scene, floorColor: color } : { ...scene, wallColors: {
    ...scene.wallColors, ...Object.fromEntries((target === 'all' ? walls : [target]).map(wall => [wall, color])),
  } })
  const mixed = target === 'all' && walls.some(wall => wallColor(scene, wall) !== selectedColor)
  const reset = () => onChange(target === 'floor' ? { ...scene, floorColor: defaultFloorColor } : {
    ...scene, wallColors: { ...scene.wallColors, ...Object.fromEntries((target === 'all' ? walls : [target]).map(wall => [wall, defaultWallColors[wall]])) },
  })
  return <section className="room-customization" aria-label="Room surfaces">
    <h3>Surfaces</h3>
    <label>Surface<select aria-label="Paint area" value={target} onChange={e => setTarget(e.target.value as typeof target)}>
      <option value="all">All walls</option><option value="floor">Floor</option>{walls.map(wall => <option key={wall} value={wall}>{wall[0].toUpperCase() + wall.slice(1)} wall</option>)}
    </select></label>
    {target !== 'floor' && <label>Wallpaper pattern<select aria-label="Wallpaper pattern" value={scene.wallpapers?.[target === 'all' ? 'north' : target] ?? 'none'} onChange={e => onChange({ ...scene, wallpapers: { ...scene.wallpapers, ...Object.fromEntries((target === 'all' ? walls : [target]).map(wall => [wall, e.target.value])) } })}>
      <option value="none">Plain paint</option><option value="linen">Linen texture</option><option value="stripes">Soft stripes</option><option value="dots">Nursery dots</option><option value="botanical">Botanical sprigs</option>
    </select><small>Unbranded patterns in your chosen wall color.</small></label>}
    <div className="paint-swatches" role="group" aria-label="Surface colors">{(target === 'floor' ? floors : paints).map(([name, color]) =>
      <button key={color} title={name} aria-label={`Paint ${name}`} aria-pressed={!mixed && selectedColor.toLowerCase() === color} onClick={() => apply(color)}>
        <span style={{ backgroundColor: color }} /><small>{name}</small>
      </button>)}</div>
    <details><summary>Custom color</summary><div className="custom-paint"><label>Color<input aria-label="Custom surface color" type="color" value={custom} onChange={e => setCustom(e.target.value)} /></label><button onClick={() => apply(custom)}>Apply</button><button onClick={reset}>Restore default</button></div></details>
  </section>
}

export function WallLightControls({ item, product, scene, onChange }: {
  item: Item; product: Product; scene: Scene; onChange: (item: Item) => void
}) {
  if (!item.wallMount) return null
  const anchor = item.wallMount
  const area = wallFixtureGeometry(item, product, scene)
  const update = (patch: Partial<NonNullable<Item['wallMount']>>) => onChange({ ...item, wallMount: { ...anchor, ...patch } })
  return <section className="wall-light-controls" aria-label="Wall object placement">
    <h3>Wall mounted</h3>
    <p className="muted">Drag the piece to reposition it on the wall. Drag past a corner to switch walls.</p>
    <details><summary>Precise placement</summary>
    <div className="window-walls" role="group" aria-label="Object wall">{walls.map(wall => <button key={wall} disabled={item.locked} aria-label={`Object on ${wall} wall`} aria-pressed={anchor.wall === wall} onClick={() => update({ wall })}>{wall[0].toUpperCase() + wall.slice(1)}</button>)}</div>
    <label>Position along {anchor.wall} wall · {area.start.toFixed(2)} m from corner<input aria-label="Wall object position" disabled={item.locked} type="range" min="0" max="1" step="0.025" value={anchor.offset} onChange={e => update({ offset: Number(e.target.value) })} /></label>
    <label>Centre above floor · {anchor.height.toFixed(2)} m<input aria-label="Wall object height" disabled={item.locked} type="range" min={Math.ceil((product.dimensions[1] / 2 + .05) * 100) / 100} max={Math.floor(((scene.height ?? 2.6) - .05 - product.dimensions[1] / 2) * 100) / 100} step="0.01" value={anchor.height} onChange={e => update({ height: Number(e.target.value) })} /></label>
    </details>
    <small>{item.locked ? 'Placement locked. Unlock the piece to move it.' : 'It stays attached to the wall, clear of windows, doors and furniture.'}</small>
  </section>
}
