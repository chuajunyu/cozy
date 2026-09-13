import type { Item, Product, Scene } from './catalog.ts'
import { doorGeometry } from './doors.ts'
import { defaultWindows, walls, windowGeometry } from './sunlight.ts'

const GAP = .05
const EPSILON = .005

export function isWallFixture(product: Product) {
  return product.placement?.mode === 'wall' && !product.door
}

export function wallFixtureGeometry(item: Item, product: Product, scene: Pick<Scene, 'width' | 'depth'>) {
  const anchor = item.wallMount!
  const length = anchor.wall === 'north' || anchor.wall === 'south' ? scene.width : scene.depth
  const [width, height] = product.dimensions
  const start = GAP + (length - width - 2 * GAP) * anchor.offset
  return { wall: anchor.wall, length, start, end: start + width,
    bottom: anchor.height - height / 2, top: anchor.height + height / 2 }
}

/** Local +Z faces into the room; the back of the fixture is flush to the wall. */
export function normalizeWallFixture(item: Item, product: Product, scene: Pick<Scene, 'width' | 'depth'>): Item {
  if (!isWallFixture(product) || !item.wallMount) return item
  const opening = wallFixtureGeometry(item, product, scene)
  const center = (opening.start + opening.end) / 2
  const inset = product.dimensions[2] / 2
  const wall = opening.wall
  return { ...item,
    x: (wall === 'west' ? inset : wall === 'east' ? scene.width - inset : center) - scene.width / 2,
    z: (wall === 'north' ? inset : wall === 'south' ? scene.depth - inset : scene.depth - center) - scene.depth / 2,
    rotation: wall === 'north' ? 0 : wall === 'west' ? 90 : wall === 'south' ? 180 : 270,
    elevation: opening.bottom, supportId: undefined,
  }
}

export function validWallFixture(item: Item, product: Product, scene: Scene, catalog: Product[]) {
  const anchor = item.wallMount
  if (!isWallFixture(product) || !anchor || !walls.includes(anchor.wall) ||
    !Number.isFinite(anchor.offset) || anchor.offset < 0 || anchor.offset > 1 ||
    !Number.isFinite(anchor.height) || item.supportId || item.door) return false
  const area = wallFixtureGeometry(item, product, scene)
  if (![scene.width, scene.depth, item.x, item.z, item.rotation, item.elevation, ...product.dimensions].every(Number.isFinite) ||
    area.start < GAP - EPSILON || area.end > area.length - GAP + EPSILON ||
    area.bottom < GAP - EPSILON || area.top > (scene.height ?? 2.6) - GAP + EPSILON) return false
  const normalized = normalizeWallFixture(item, product, scene)
  if (Math.abs(normalized.x - item.x) > EPSILON || Math.abs(normalized.z - item.z) > EPSILON ||
    Math.abs(normalized.elevation! - item.elevation!) > EPSILON || normalized.rotation !== item.rotation) return false
  const openings = [
    ...(scene.windows ?? defaultWindows).filter(window => window.wall === anchor.wall).map(window => windowGeometry(window, scene)),
    ...scene.items.flatMap(other => {
      const otherProduct = catalog.find(p => p.id === other.productId)
      return otherProduct?.door && other.door?.wall === anchor.wall ? [doorGeometry(other, otherProduct, scene)] : []
    }),
  ]
  return openings.every(other => area.start >= other.end + GAP || area.end <= other.start - GAP ||
    area.bottom >= other.top + GAP || area.top <= other.bottom - GAP)
}
