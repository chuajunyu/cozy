import type { Scene } from './catalog'
import type { RoomWindow, Wall } from './sunlight'
import { wallLength } from './wallDragGeometry'

export const windowPresets = [
  { id: 'standard', name: 'Classic window', width: 1.8, height: 1.4, sill: .9, description: 'A balanced everyday window.' },
  { id: 'wide', name: 'Wide window', width: 3, height: 1.5, sill: .7, description: 'A broad view and generous daylight.' },
  { id: 'full', name: 'Floor-to-ceiling window', width: 1.8, height: 5, sill: .05, description: 'Full-height glass with a slim frame.' },
  { id: 'panoramic', name: 'Panoramic window', width: 4, height: 5, sill: .05, description: 'Wide, full-height glass.' },
] as const
export function presetWindow(id: string, scene: Scene, wall: Wall, offset = .5): RoomWindow {
  const preset = windowPresets.find(p => p.id === id) ?? windowPresets[0]
  return { wall, offset, width: Math.min(preset.width, wallLength(scene, wall) - .4),
    height: Math.round(Math.min(preset.height, (scene.height ?? 2.6) - preset.sill - .1) * 100) / 100, sill: preset.sill }
}
