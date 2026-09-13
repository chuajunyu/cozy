import { useState } from 'react'
import type { Product, Scene } from './catalog'
import { doorOpenings } from './doors'
import { defaultWindows, directSun, walls, windowGeometry, type Wall, type RoomWindow } from './sunlight'

export default function SunlightControls({ scene, catalog, onChange, mode }: { scene: Scene; catalog: Product[]; onChange: (scene: Scene) => void; mode: 'windows' | 'lighting' }) {
  const [wall, setWall] = useState<Wall>('east')
  const windows = scene.windows ?? defaultWindows
  const hour = scene.sunHour ?? 9
  const doors = scene.items.filter(item => catalog.find(product => product.id === item.productId)?.door)
  const openDoors = doorOpenings(scene, catalog)
  const direct = [
    ...windows.filter(window => directSun(window.wall, hour)).map(window => `${window.wall} window`),
    ...openDoors.filter(door => directSun(door.wall, hour)).map(door => `${door.wall} doorway`),
  ]
  const status = hour <= 6 || hour >= 18 ? 'Sun below the horizon · try your lamps.'
    : direct.length ? `Direct sun through ${direct.join(' & ')}.`
      : windows.length || openDoors.length ? 'Diffuse sky light and reflected daylight · no direct sun.'
        : doors.length ? 'Doors closed · add a window or open a door for daylight.'
          : 'No openings · daylight is blocked.'
  const window = windows.find(w => w.wall === wall)
  const time = `${String(Math.floor(hour)).padStart(2, '0')}:${hour % 1 ? '30' : '00'}`
  const update = (patch: Partial<RoomWindow>) => onChange({ ...scene, windows: windows.map(w => w.wall === wall ? { ...w, ...patch } : w) })
  return <section className="sunlight-panel" aria-label={mode === 'windows' ? 'Windows' : 'Sunlight'}>
    {mode === 'lighting' && <>
    <div className="sunlight-heading"><div><h3>Windows & sunlight</h3><p>Follow the light through your room.</p></div><strong>{time}</strong></div>
    <label className="sun-time">Time of day<input aria-label="Time of day" type="range" min="6" max="20" step="0.5" value={hour} onChange={e => onChange({ ...scene, sunHour: Number(e.target.value) })} /></label>
    <div className="sun-presets">{[[9, 'Morning'], [12, 'Noon'], [16, 'Afternoon'], [20, 'Night']].map(([value, label]) => <button key={value} aria-pressed={hour === value} onClick={() => onChange({ ...scene, sunHour: Number(value) })}>{label}</button>)}</div>
    <p className="sun-status" role="status">{status}{!!doors.length && <span> {openDoors.length} of {doors.length} {doors.length === 1 ? 'door' : 'doors'} open.</span>}</p>
    </>}
    {mode === 'windows' && <details open><summary>Edit windows <span>{windows.length} installed</span></summary>
      <p>Choose a wall, then adjust its window. Compass labels in the room identify each wall.</p>
      <div className="window-walls">{walls.map(w => <button key={w} aria-pressed={wall === w} onClick={() => setWall(w)}>{w[0].toUpperCase() + w.slice(1)} {windows.some(v => v.wall === w) ? '▣' : '+'}</button>)}</div>
      <label className="window-enabled"><input type="checkbox" checked={!!window} onChange={e => onChange({ ...scene, windows: e.target.checked ? [...windows, { wall, offset: 0.5, width: Math.min(1.8, (wall === 'north' || wall === 'south' ? scene.width : scene.depth) - .4), height: Math.min(1.4, (scene.height ?? 2.6) - 1), sill: 0.9 }] : windows.filter(w => w.wall !== wall) })} /> Window on {wall} wall</label>
      {window && <div className="window-inputs">
        <label>Position along wall<input aria-label="Window position" type="range" min="0" max="1" step="0.05" value={window.offset} onChange={e => update({ offset: Number(e.target.value) })} /></label>
        <label>Width · {windowGeometry(window, scene).width.toFixed(1)} m<input aria-label="Window width" type="range" min="0.5" max={Math.min(4, windowGeometry(window, scene).length - 0.4)} step="0.1" value={windowGeometry(window, scene).width} onChange={e => update({ width: Number(e.target.value) })} /></label>
        <label>Height · {window.height.toFixed(1)} m<input aria-label="Window height" type="range" min="0.5" max={Number(((scene.height ?? 2.6) - .1 - window.sill).toFixed(1))} step="0.1" value={window.height} onChange={e => update({ height: Number(e.target.value) })} /></label>
        <label>Sill above floor · {window.sill.toFixed(1)} m<input aria-label="Window sill height" type="range" min="0.2" max={Number(((scene.height ?? 2.6) - .1 - window.height).toFixed(1))} step="0.1" value={window.sill} onChange={e => update({ sill: Number(e.target.value) })} /></label>
      </div>}
    </details>}
    <details><summary>About this preview</summary><small>Illustrative solar time: sunrise 06:00 east, sunset 18:00 west. Clear sky, southern midday arc; location, date and surrounding buildings are not modeled. Windows and open doors admit daylight from outside. Diffuse sky light and surface reflections illuminate the interior. Indoor exposure adapts automatically.</small></details>
  </section>
}
