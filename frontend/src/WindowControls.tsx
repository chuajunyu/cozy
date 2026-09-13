import { useEffect, useState } from 'react'
import type { Scene } from './catalog'
import { walls, type RoomWindow } from './sunlight'
import { presetWindow, windowPresets } from './windowPresets'

export default function WindowControls({ window, scene, disabled, onChange, onRemove }: {
  window: RoomWindow; scene: Scene; disabled: boolean; onChange: (next: RoomWindow) => void; onRemove: () => void
}) {
  const [draft, setDraft] = useState(window)
  useEffect(() => { setDraft(window) }, [window])
  return <fieldset disabled={disabled} className="window-details">
    <h3>{window.wall[0].toUpperCase() + window.wall.slice(1)} window</h3>
    <p className="muted">Drag the glass or frame to move it along the wall or change its height. Drag past a corner to switch walls. In Top view, drag toward another wall.</p>
    <label>Window style<select aria-label="Window style" value="" onChange={e => onChange(presetWindow(e.target.value, scene, window.wall, window.offset))}>
      <option value="" disabled>Choose a preset</option>{windowPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <p className="muted">{window.width.toFixed(2)} m wide × {window.height.toFixed(2)} m tall</p>
    <details><summary>Precise placement</summary>
      <form onSubmit={e => { e.preventDefault(); onChange(draft) }}>
        <label>Wall<select aria-label="Window wall" value={draft.wall} onChange={e => setDraft({ ...draft, wall: e.target.value as RoomWindow['wall'] })}>{walls.map(w => <option key={w} value={w}>{w}</option>)}</select></label>
        {([['width', 'Width', .5, 4], ['height', 'Height', .5, 5], ['sill', 'Height above floor', .05, 5], ['offset', 'Position along wall', 0, 1]] as const).map(([field, label, min, max]) =>
          <label key={field}>{label}<input aria-label={`Window ${label.toLowerCase()}`} type="number" step="0.01" min={min} max={max} required value={draft[field]} onChange={e => setDraft({ ...draft, [field]: Number(e.target.value) })} /></label>)}
        <button type="submit">Apply placement</button>
      </form>
    </details>
    <button className="danger" onClick={onRemove}>Remove window</button>
  </fieldset>
}
