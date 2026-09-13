import type { Scene } from './catalog'

export type Wall = 'north' | 'east' | 'south' | 'west'
export type RoomWindow = { wall: Wall; offset: number; width: number; height: number; sill: number; curtain?: 'none' | 'sheer' | 'linen' | 'blackout' }
export const walls: Wall[] = ['north', 'east', 'south', 'west']
export const defaultWindows: RoomWindow[] = [{ wall: 'east', offset: 0.5, width: 1.8, height: 1.4, sill: 0.9 }]
export function windowGeometry(window: RoomWindow, scene: Pick<Scene, 'width' | 'depth'>) {
  const length = window.wall === 'north' || window.wall === 'south' ? scene.width : scene.depth
  const width = Math.min(window.width, length - 0.4)
  const start = 0.2 + (length - width - 0.4) * window.offset
  return { length, width, start, end: start + width, bottom: window.sill, top: window.sill + window.height }
}
// Representative clear-sky arc: 06:00 sunrise in the east, noon in the south,
// 18:00 sunset in the west. This is solar time, not a location/date calculation.
export function sunAt(hour: number) {
  const angle = (hour - 6) / 12 * Math.PI
  const above = hour > 6 && hour < 18
  const direction: [number, number, number] = [Math.cos(angle), Math.sin(angle) * Math.sin(Math.PI / 3), Math.sin(angle) * 0.5]
  return { direction, intensity: above ? 3.2 * Math.pow(Math.sin(angle), 0.4) : 0, ambient: above ? 0.12 + 0.15 * Math.sin(angle) : 0.045, warm: above && (hour < 8 || hour > 16) }
}
export function directSun(wall: Wall, hour: number) {
  const sun = sunAt(hour)
  const [x, , z] = sun.direction
  return sun.intensity > 0 && ({ east: x, west: -x, south: z, north: -z }[wall]) > 0.05
}
export function validWindows(value: unknown, scene?: Pick<Scene, 'width' | 'depth' | 'height'>): value is RoomWindow[] {
  return Array.isArray(value) && value.length <= 4 && new Set(value.map(w => w?.wall)).size === value.length && value.every(w => w && (w.curtain === undefined || ['none', 'sheer', 'linen', 'blackout'].includes(w.curtain)) && walls.includes(w.wall) && [w.offset, w.width, w.height, w.sill].every(Number.isFinite) && w.offset >= 0 && w.offset <= 1 && w.width >= 0.5 && w.width <= 4 && w.height >= 0.5 && w.sill >= 0.05 && w.height + w.sill <= (scene?.height ?? 2.6) - .1 + .000001 && (!scene || w.width <= (w.wall === 'north' || w.wall === 'south' ? scene.width : scene.depth) - .4 + .000001))
}
