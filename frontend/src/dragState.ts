import type { Item, Scene } from './catalog'

export function dragState(scene: Scene, item: Item): string {
  return JSON.stringify([scene.width, scene.depth, scene.height, item.id, item.productId,
    item.x, item.z, item.rotation, item.elevation, item.supportId, item.locked])
}
