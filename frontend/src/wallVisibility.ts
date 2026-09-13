import type { Wall } from './sunlight'

// x/z point from the camera toward the room; an inward-facing wall is visible.
export function wallVisible(wall: Wall, x: number, z: number, top: boolean, previous?: boolean): boolean {
  if (top) return false
  const length = Math.hypot(x, z)
  if (length < 1e-6) return previous ?? false
  const dot = (wall === 'east' ? x : wall === 'west' ? -x : wall === 'south' ? z : -z) / length
  if (previous !== undefined && Math.abs(dot) < .04) return previous
  return dot > 0
}
