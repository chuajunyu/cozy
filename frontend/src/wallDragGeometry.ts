import { Plane, Ray, Vector3 } from 'three'
import type { Scene } from './catalog'
import { walls, type Wall } from './sunlight'

export type WallAnchor = { wall: Wall; offset: number; width: number; height: number; center: number; gap: number; fixedFloor?: boolean; reverseSouth?: boolean }
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function wallLength(scene: Pick<Scene, 'width' | 'depth'>, wall: Wall) {
  return wall === 'north' || wall === 'south' ? scene.width : scene.depth
}
export function alongWall(point: Vector3, wall: Wall, scene: Pick<Scene, 'width' | 'depth'>, reverseSouth = false) {
  return wall === 'west' || wall === 'east' ? scene.depth / 2 - point.z
    : wall === 'south' && reverseSouth ? scene.width / 2 - point.x : point.x + scene.width / 2
}
export function wallPoint(ray: Ray, wall: Wall, scene: Scene, previous: Vector3, top: boolean): { wall: Wall; point: Vector3 } | null {
  if (top) {
    const point = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -previous.y), new Vector3())
    if (!point) return null
    const distances = { north: Math.abs(point.z + scene.depth / 2), south: Math.abs(point.z - scene.depth / 2), west: Math.abs(point.x + scene.width / 2), east: Math.abs(point.x - scene.width / 2) }
    const nearest = [...walls].sort((a, b) => distances[a] - distances[b])[0]
    return { wall: nearest, point }
  }
  const hit = (side: Wall) => {
    const normal = side === 'north' || side === 'south' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)
    const constant = side === 'north' ? scene.depth / 2 : side === 'south' ? -scene.depth / 2 : side === 'west' ? scene.width / 2 : -scene.width / 2
    return ray.intersectPlane(new Plane(normal, constant), new Vector3())
  }
  const current = hit(wall)
  if (current) {
    const along = alongWall(current, wall, scene)
    if (along >= -.12 && along <= wallLength(scene, wall) + .12) return { wall, point: current }
  }
  const options = walls.flatMap(side => {
    const point = hit(side)
    if (!point) return []
    const along = alongWall(point, side, scene)
    return along >= -.12 && along <= wallLength(scene, side) + .12 ? [{ wall: side, point }] : []
  })
  return options.sort((a, b) => a.point.distanceToSquared(previous) - b.point.distanceToSquared(previous))[0] ?? null
}
export function anchorAtPoint(anchor: WallAnchor, point: Vector3, wall: Wall, scene: Scene, grab: { along: number; up: number }): WallAnchor {
  const length = wallLength(scene, wall)
  const span = length - anchor.width - anchor.gap * 2
  const offset = span <= 0 ? .5 : clamp((alongWall(point, wall, scene, anchor.reverseSouth) - grab.along - anchor.width / 2 - anchor.gap) / span, 0, 1)
  return { ...anchor, wall, offset: Math.round(offset * 1000) / 1000,
    center: anchor.fixedFloor ? anchor.height / 2 : Math.round(clamp(point.y - grab.up, anchor.height / 2 + .05, (scene.height ?? 2.6) - anchor.height / 2 - .1) * 1000) / 1000 }
}
