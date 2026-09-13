import { useEffect, useRef, type ReactNode } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Scene } from './catalog'
import { alongWall, anchorAtPoint, wallLength, wallPoint, type WallAnchor } from './wallDragGeometry'

export default function WallDrag({ anchor, scene, version, top, disabled, onSelect, onPreview, onDrop, children }: {
  anchor: WallAnchor; scene: Scene; version: string; top: boolean; disabled?: boolean;
  onSelect: () => void; onPreview: (anchor: WallAnchor | null) => void; onDrop: (anchor: WallAnchor) => void; children: ReactNode
}) {
  const active = useRef<{ anchor: WallAnchor; point: Vector3; grab: { along: number; up: number }; target: Element; pointerId: number; changed: boolean } | null>(null)
  const latest = useRef({ onPreview, onDrop })
  latest.current = { onPreview, onDrop }
  const end = (save: boolean) => {
    const drag = active.current
    if (!drag) return
    active.current = null
    try { drag.target.releasePointerCapture(drag.pointerId) } catch { /* Already released. */ }
    latest.current.onPreview(null)
    if (save && drag.changed) latest.current.onDrop(drag.anchor)
  }
  useEffect(() => { end(false) }, [version, disabled, top])
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape' && active.current) { e.preventDefault(); end(false) } }
    window.addEventListener('keydown', cancel)
    return () => { window.removeEventListener('keydown', cancel); end(false) }
  }, [])
  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onSelect()
    if (disabled || e.button !== 0) return
    const center = anchor.gap + anchor.offset * (wallLength(scene, anchor.wall) - anchor.width - anchor.gap * 2) + anchor.width / 2
    const target = e.target as unknown as Element
    target.setPointerCapture(e.pointerId)
    active.current = { anchor, point: e.point.clone(), target, pointerId: e.pointerId, changed: false,
      grab: { along: alongWall(e.point, anchor.wall, scene) - center, up: e.point.y - anchor.center } }
    onPreview(anchor)
  }
  return <group onPointerDown={down} onPointerMove={e => {
    const drag = active.current
    if (!drag) return
    e.stopPropagation()
    const hit = wallPoint(e.ray, drag.anchor.wall, scene, drag.point, top)
    if (!hit) return
    const next = anchorAtPoint(drag.anchor, hit.point, hit.wall, scene, drag.grab)
    drag.changed ||= next.wall !== anchor.wall || next.offset !== anchor.offset || next.center !== anchor.center
    drag.anchor = next
    drag.point = hit.point
    onPreview(next)
  }} onPointerUp={e => { if (active.current) { e.stopPropagation(); end(true) } }} onPointerCancel={() => end(false)}>
    {children}
  </group>
}
