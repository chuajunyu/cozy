import { useEffect, useState } from 'react'
import type { Scene } from './catalog'
import { defaultWallColors, wallColor } from './roomFinishes'
import { walls, type Wall } from './sunlight'

const paints = [
  ['Warm white', '#eee9df'], ['Sage', '#dadfd3'], ['Sand', '#d8bea0'],
  ['Terracotta', '#be7967'], ['Dusty blue', '#8ca5b7'], ['Charcoal', '#454b4e'],
]

export default function RoomCustomization({ scene, onChange }: {
  scene: Scene; onChange: (scene: Scene) => void
}) {
  const [target, setTarget] = useState<Wall | 'all'>('all')
  const selectedColor = wallColor(scene, target === 'all' ? 'north' : target)
  const [custom, setCustom] = useState(selectedColor)
  useEffect(() => { setCustom(selectedColor) }, [selectedColor, target])
  const apply = (color: string) => onChange({ ...scene, wallColors: {
    ...scene.wallColors, ...Object.fromEntries((target === 'all' ? walls : [target]).map(wall => [wall, color])),
  } })
  const mixed = target === 'all' && walls.some(wall => wallColor(scene, wall) !== selectedColor)
  return <section className="room-customization" aria-label="Room customization">
    <div className="customization-heading"><div><h3>Make it yours</h3><p>Choose a color for each wall.</p></div></div>
    <label>Paint area<select aria-label="Paint area" value={target} onChange={e => setTarget(e.target.value as Wall | 'all')}>
      <option value="all">All walls</option>{walls.map(wall => <option key={wall} value={wall}>{wall[0].toUpperCase() + wall.slice(1)} wall</option>)}
    </select></label>
    <div className="paint-swatches" role="group" aria-label="Wall paint colors">{paints.map(([name, color]) =>
      <button key={color} title={name} aria-label={`Paint ${name}`} aria-pressed={!mixed && selectedColor === color} onClick={() => apply(color)}>
        <span style={{ backgroundColor: color }} /><small>{name}</small>
      </button>)}</div>
    <div className="custom-paint"><label>Custom color<input aria-label="Custom wall color" type="color" value={custom} onChange={e => setCustom(e.target.value)} /></label><button onClick={() => apply(custom)}>Apply color</button><button onClick={() => onChange({ ...scene, wallColors: { ...defaultWallColors } })}>Reset wall colors</button></div>
    <div className="wall-color-summary">{walls.map(wall => <span key={wall}><i style={{ backgroundColor: wallColor(scene, wall) }} />{wall[0].toUpperCase() + wall.slice(1)}</span>)}</div>
    <small>Paint also changes reflected daylight. The cutaway shows the north and west walls.</small>
  </section>
}
