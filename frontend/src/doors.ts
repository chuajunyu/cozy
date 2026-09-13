import type { Item, Product, Scene } from './catalog.ts'
import { defaultWindows, walls, windowGeometry } from './sunlight.ts'
import type { RoomWindow } from './sunlight.ts'

const EPSILON = .005
const FRAME_GAP = .12

/** Door offsets use the same wall-local direction as windows. */
export function doorGeometry(item: Item, product: Product, scene: Pick<Scene, 'width' | 'depth' | 'height'>) {
  const wall = item.door!.wall
  const length = wall === 'north' || wall === 'south' ? scene.width : scene.depth
  const [width, height] = product.dimensions
  const start = .2 + (length - width - .4) * item.door!.offset
  return { wall, length, width, height, start, end: start + width, bottom: 0 as const, top: height }
}

export function normalizeDoor(item: Item, product: Product, scene: Pick<Scene, 'width' | 'depth' | 'height'>): Item {
  if (!product.door || !item.door) return item
  const opening = doorGeometry(item, product, scene)
  const center = (opening.start + opening.end) / 2
  const { wall } = opening
  return {
    ...item,
    x: (wall === 'west' ? 0 : wall === 'east' ? scene.width : center) - scene.width / 2,
    z: (wall === 'north' ? 0 : wall === 'south' ? scene.depth : scene.depth - center) - scene.depth / 2,
    rotation: wall === 'north' || wall === 'south' ? 0 : 90,
    elevation: 0,
    supportId: undefined,
  }
}

/** Includes the full inward swing so a closed door can always be opened. */
export function doorClearance(item: Item, product: Product, scene: Pick<Scene, 'width' | 'depth' | 'height'>) {
  const { wall, start, end, width, height } = doorGeometry(item, product, scene)
  if (wall === 'north' || wall === 'south') {
    return { minX: start - scene.width / 2, maxX: end - scene.width / 2, minZ: (wall === 'north' ? 0 : scene.depth - width) - scene.depth / 2, maxZ: (wall === 'north' ? width : scene.depth) - scene.depth / 2, height }
  }
  return { minX: (wall === 'west' ? 0 : scene.width - width) - scene.width / 2, maxX: (wall === 'west' ? width : scene.width) - scene.width / 2, minZ: scene.depth / 2 - end, maxZ: scene.depth / 2 - start, height }
}

export function validDoorAnchor(item: Item, product: Product, scene: Pick<Scene, 'width' | 'depth' | 'height'>) {
  const anchor = item.door
  if (!product.door || !anchor || !walls.includes(anchor.wall) || !Number.isFinite(anchor.offset) || anchor.offset < 0 || anchor.offset > 1 || typeof anchor.open !== 'boolean') return false
  if (![scene.width, scene.depth, item.x, item.z, item.rotation, item.elevation ?? 0, ...product.dimensions].every(Number.isFinite) || product.dimensions.some(value => value <= 0) || item.supportId || (item.elevation ?? 0) !== 0) return false
  const opening = doorGeometry(item, product, scene)
  if (opening.width + .4 > opening.length || opening.height > (scene.height ?? 2.6) - .1 || scene.width < opening.width || scene.depth < opening.width) return false
  const normalized = normalizeDoor(item, product, scene)
  return Math.abs(normalized.x - item.x) < EPSILON && Math.abs(normalized.z - item.z) < EPSILON && normalized.rotation === item.rotation
}

export function doorOpenings(scene: Scene, catalog: Product[]): RoomWindow[] {
  return scene.items.flatMap(item => {
    const product = catalog.find(value => value.id === item.productId)
    if (!product?.door || !item.door?.open || !validDoorAnchor(item, product, scene)) return []
    return [{ wall: item.door.wall, offset: item.door.offset, width: product.dimensions[0], height: product.dimensions[1], sill: 0 }]
  })
}

function clearanceOverlapsItem(clearance: ReturnType<typeof doorClearance>, item: Item, product: Product) {
  if (/\b(rug|carpet|floor mat)\b/i.test(`${product.productType ?? ''} ${product.name}`)) return false
  if ((item.elevation ?? 0) >= clearance.height - EPSILON) return false
  const angle = item.rotation * Math.PI / 180
  const axisX = [Math.cos(angle), -Math.sin(angle)]
  const axisZ = [Math.sin(angle), Math.cos(angle)]
  const halfWidth = (clearance.maxX - clearance.minX) / 2
  const halfDepth = (clearance.maxZ - clearance.minZ) / 2
  const dx = item.x - (clearance.minX + clearance.maxX) / 2
  const dz = item.z - (clearance.minZ + clearance.maxZ) / 2
  return [[1, 0], [0, 1], axisX, axisZ].every(axis => {
    const itemRadius = product.dimensions[0] / 2 * Math.abs(axisX[0] * axis[0] + axisX[1] * axis[1]) + product.dimensions[2] / 2 * Math.abs(axisZ[0] * axis[0] + axisZ[1] * axis[1])
    const clearanceRadius = halfWidth * Math.abs(axis[0]) + halfDepth * Math.abs(axis[1])
    return Math.abs(dx * axis[0] + dz * axis[1]) < itemRadius + clearanceRadius - EPSILON
  })
}

/** Validate all architectural openings and reserve usable door swings. */
export function validDoors(scene: Scene, catalog: Product[]) {
  const doors: { item: Item; product: Product; opening: ReturnType<typeof doorGeometry>; clearance: ReturnType<typeof doorClearance> }[] = []
  for (const item of scene.items) {
    const product = catalog.find(value => value.id === item.productId)
    if (!product) return false
    if (!product.door) {
      if (item.door !== undefined) return false
      continue
    }
    if (!validDoorAnchor(item, product, scene)) return false
    doors.push({ item, product, opening: doorGeometry(item, product, scene), clearance: doorClearance(item, product, scene) })
  }
  for (const { item, opening, clearance } of doors) {
    for (const window of scene.windows ?? defaultWindows) {
      if (window.wall !== opening.wall) continue
      const other = windowGeometry(window, scene)
      if (other.bottom < opening.top + FRAME_GAP && other.top > opening.bottom && other.start < opening.end + FRAME_GAP && other.end > opening.start - FRAME_GAP) return false
    }
    for (const other of doors) {
      if (other.item.id === item.id) continue
      if (other.opening.wall === opening.wall && other.opening.start < opening.end + FRAME_GAP && other.opening.end > opening.start - FRAME_GAP) return false
      if (clearance.minX < other.clearance.maxX - EPSILON && clearance.maxX > other.clearance.minX + EPSILON && clearance.minZ < other.clearance.maxZ - EPSILON && clearance.maxZ > other.clearance.minZ + EPSILON) return false
    }
    for (const other of scene.items) {
      if (other.id === item.id) continue
      const product = catalog.find(value => value.id === other.productId)!
      if (!product.door && clearanceOverlapsItem(clearance, other, product)) return false
    }
  }
  return true
}
