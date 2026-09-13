import type { Item, Product, Scene } from './catalog'
import { doorGeometry } from './doors'
import { walls } from './sunlight'

export default function DoorControls({ item, product, scene, onChange }: {
  item: Item
  product: Product
  scene: Scene
  onChange: (item: Item) => void
}) {
  if (!item.door) return null
  const anchor = item.door
  const opening = doorGeometry(item, product, scene)
  const update = (patch: Partial<NonNullable<Item['door']>>) => onChange({ ...item, door: { ...anchor, ...patch } })
  return <section className="door-controls" aria-label="Door settings">
    <div className="door-heading">
      <div><h3>Doorway</h3><p>{Math.round(opening.width * 100)} × {Math.round(opening.height * 100)} cm · opens inward</p></div>
      <button aria-pressed={anchor.open} onClick={() => update({ open: !anchor.open })}>{anchor.open ? 'Close door' : 'Open door'}</button>
    </div>
    <p className="muted">Drag the door along the wall. Drag past a corner to switch walls, or use Top view to move it around the room.</p>
    <details><summary>Precise placement</summary><div className="window-walls" role="group" aria-label="Door wall">
      {walls.map(wall => <button key={wall} disabled={item.locked} aria-label={`Door on ${wall} wall`} aria-pressed={anchor.wall === wall} onClick={() => update({ wall })}>{wall[0].toUpperCase() + wall.slice(1)}</button>)}
    </div>
    <label>Position along {anchor.wall} wall · {opening.start.toFixed(2)} m from the corner
      <input aria-label="Door position" disabled={item.locked} type="range" min="0" max="1" step="0.025" value={anchor.offset} onChange={e => update({ offset: Number(e.target.value) })} />
    </label></details>
    <p className="door-status" role="status">{anchor.open ? 'Open to outdoors · sky light and sunlight can enter.' : 'Closed · the solid door blocks daylight.'}</p>
    <small>{item.locked ? 'Position locked. You can still open and close the door. ' : 'The door stays attached to its wall. Keep the inward swing clear. '}This room element has no purchase price and is excluded from the budget.</small>
  </section>
}
