import type { Scene, Vec3 } from './catalog.ts'
import { walls, type Wall } from './sunlight.ts'

export const defaultFloorColor = '#c7ac88'

export function validPaintColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export function floorColor(scene: Pick<Scene, 'floorColor'>) {
  return scene.floorColor ?? defaultFloorColor
}

export const defaultWallColors: Record<Wall, string> = {
  north: '#eee9df', east: '#eee9df', south: '#eee9df', west: '#dadfd3',
}

export function validWallColors(value: unknown): value is Partial<Record<Wall, string>> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([wall, color]) => walls.includes(wall as Wall) &&
      typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
}

export function wallColor(scene: Pick<Scene, 'wallColors'>, wall: Wall) {
  return scene.wallColors?.[wall] ?? defaultWallColors[wall]
}

/** Convert display paint colors to linear diffuse reflectance for daylight. */
export function paintReflectance(hex: string): Vec3 {
  return [1, 3, 5].map(start => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255
    return Math.min(.9, value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  }) as Vec3
}
