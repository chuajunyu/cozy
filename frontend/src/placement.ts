import type { Item, Product, Scene } from './catalog.ts'
import { normalizeDoor, validDoorAnchor, validDoors } from './doors.ts'
import { isWallFixture, normalizeWallFixture, validWallFixture } from './wallFixtures.ts'
import { validPaintColor, validWallColors } from './roomFinishes.ts'

const EPSILON = 0.005
const DEFAULT_HEIGHT = 2.6

function placementMode(product: Product) {
  return product.placement?.mode ?? product.lighting?.mount ?? 'floor'
}

function isRug(product: Product) {
  if (product.floorLayer !== undefined) return product.floorLayer
  return /\b(rug|carpet|floor mat)\b/i.test(
    `${product.productType ?? ''} ${product.name}`,
  )
}

export function isAnchored(product: Product, _item?: Item) {
  return placementMode(product) === 'ceiling' || placementMode(product) === 'wall'
}

export function canSupportItems(product: Product) {
  if (product.placement?.support) return true
  if (isRug(product) || isAnchored(product) || product.lighting) return false
  if (product.placement?.canSupport !== undefined)
    return product.placement.canSupport
  if (/\b(chair|bed|sofa)\b/i.test(`${product.productType ?? ''} ${product.name}`)) return false
  return /\b(desk|table|sideboard|cabinet|drawer|drawers|bedside|nightstand|shelf|shelving|bookcase)\b/i.test(
    `${product.productType ?? ''} ${product.name}`,
  )
}

export function supportHeight(product: Product) {
  return product.placement?.support?.height ?? product.dimensions[1]
}

export function acceptsSupport(support: Product, product: Product) {
  if (!canSupportItems(support)) return false
  const deck = support.placement?.support
  const kind = product.placement?.surfaceKind
  if (kind) {
    const stem = kind === 'bouquet' ? product.placement?.stemDiameter : undefined
    return !!deck && deck.kind === kind && (stem ?? product.dimensions[0]) <= deck.width + EPSILON * 2 && (stem ?? product.dimensions[2]) <= deck.depth + EPSILON * 2
  }
  return !deck
}

export function supportPosition(item: Item, product: Product) {
  const [x, z] = product.placement?.support?.center ?? [0, 0]
  const angle = item.rotation * Math.PI / 180
  return { x: item.x + x * Math.cos(angle) + z * Math.sin(angle), z: item.z - x * Math.sin(angle) + z * Math.cos(angle), rotation: item.rotation, elevation: (item.elevation ?? 0) + supportHeight(product) }
}

type Rectangle = {
  x: number
  z: number
  halfWidth: number
  halfDepth: number
  // Three.js rotates positive Y from local +X towards world -Z.
  axisX: [number, number]
  axisZ: [number, number]
}

function rectangle(item: Item, product: Product): Rectangle {
  const angle = (item.rotation * Math.PI) / 180
  return {
    x: item.x,
    z: item.z,
    halfWidth: product.dimensions[0] / 2,
    halfDepth: product.dimensions[2] / 2,
    axisX: [Math.cos(angle), -Math.sin(angle)],
    axisZ: [Math.sin(angle), Math.cos(angle)],
  }
}

/** Keep a dragged footprint inside the room, including at arbitrary rotations. */
export function clampItemToRoom(item: Item, product: Product, scene: Pick<Scene, 'width' | 'depth'>): Item {
  if (isAnchored(product)) return item
  const box = rectangle(item, product)
  const halfWidth = radius(box, [1, 0])
  const halfDepth = radius(box, [0, 1])
  const minX = -scene.width / 2 + halfWidth
  const maxX = scene.width / 2 - halfWidth
  const minZ = -scene.depth / 2 + halfDepth
  const maxZ = scene.depth / 2 - halfDepth
  if (minX > maxX || minZ > maxZ) return item
  return {
    ...item,
    x: Math.min(maxX, Math.max(minX, item.x)),
    z: Math.min(maxZ, Math.max(minZ, item.z)),
  }
}

function attachmentRectangle(item: Item, product: Product) {
  const stem = product.placement?.surfaceKind === 'bouquet' ? product.placement.stemDiameter : undefined
  return stem ? rectangle(item, { ...product, dimensions: [stem, product.dimensions[1], stem] }) : rectangle(item, product)
}

function supportRectangle(item: Item, product: Product) {
  const deck = product.placement?.support
  return deck ? rectangle({ ...item, ...supportPosition(item, product) }, { ...product, dimensions: [deck.width, deck.height, deck.depth] }) : rectangle(item, product)
}

function overlapsMattressDeck(item: Item, product: Product, support: Rectangle) {
  const dx = item.x - support.x
  const dz = item.z - support.z
  const across = Math.abs(dx * support.axisX[0] + dz * support.axisX[1])
  const along = Math.abs(dx * support.axisZ[0] + dz * support.axisZ[1])
  // A fitting mattress aligns with this deck on release. Let the bed's visible
  // area be the drop target instead of requiring its exact centre under a cursor.
  const width = product.dimensions[0], depth = product.dimensions[2]
  const overlapWidth = Math.max(0, Math.min(support.halfWidth, across + width / 2) - Math.max(-support.halfWidth, across - width / 2)) / width
  const overlapDepth = Math.max(0, Math.min(support.halfDepth, along + depth / 2) - Math.max(-support.halfDepth, along - depth / 2)) / depth
  return overlapWidth * overlapDepth >= .5
}

/** Resolve a horizontal drag into a lifted preview over a fitting surface. */
export function liftToSupport(item: Item, scene: Scene, catalog: Product[]): Item {
  const product = catalog.find(p => p.id === item.productId)
  if (!product || placementMode(product) !== 'surface') return item
  let next = item
  let highest = -1
  let nearest = Infinity
  let bestFit = Infinity
  for (const other of scene.items) {
    const support = catalog.find(p => p.id === other.productId)
    if (!support || other.id === item.id || !acceptsSupport(support, product)) continue
    const position = supportPosition(other, support)
    const mattress = product.placement?.surfaceKind === 'mattress'
    const deck = supportRectangle(other, support)
    const distance = Math.hypot(item.x - position.x, item.z - position.z)
    const fit = Math.abs(deck.halfWidth * 2 - product.dimensions[0]) <= .02 && Math.abs(deck.halfDepth * 2 - product.dimensions[2]) <= .02 ? 0 : 1
    const candidate = (product.placement?.surfaceKind === 'bouquet' && distance < .2) || (mattress && overlapsMattressDeck(item, product, deck))
      ? { ...item, ...position } : item
    if (!contains(deck, attachmentRectangle(candidate, product)) || (mattress ? fit > bestFit || (fit === bestFit && distance >= nearest) : position.elevation <= highest)) continue
    const lifted = { ...candidate, elevation: Math.max(item.elevation ?? 0, position.elevation + (mattress ? .25 : 0)) }
    if (mattress && !settleItem(lifted, scene, catalog)) continue
    highest = position.elevation
    nearest = distance
    bestFit = fit
    next = lifted
  }
  return next
}

function radius(box: Rectangle, axis: [number, number]) {
  return (
    box.halfWidth * Math.abs(box.axisX[0] * axis[0] + box.axisX[1] * axis[1]) +
    box.halfDepth * Math.abs(box.axisZ[0] * axis[0] + box.axisZ[1] * axis[1])
  )
}

function overlaps(a: Rectangle, b: Rectangle) {
  return [a.axisX, a.axisZ, b.axisX, b.axisZ].every(
    (axis) =>
      Math.abs((a.x - b.x) * axis[0] + (a.z - b.z) * axis[1]) <
      radius(a, axis) + radius(b, axis) - EPSILON,
  )
}

function contains(support: Rectangle, item: Rectangle) {
  return [support.axisX, support.axisZ].every(
    (axis, index) =>
      Math.abs((item.x - support.x) * axis[0] + (item.z - support.z) * axis[1]) +
        radius(item, axis) <=
      (index === 0 ? support.halfWidth : support.halfDepth) + EPSILON,
  )
}

export function validItemGeometry(item: Item, product: Product, scene: Scene, catalog: Product[] = []) {
  if (isWallFixture(product) ? !validWallFixture(item, product, scene, catalog) : item.wallMount != null) return false
  if (product.door) return validDoorAnchor(item, product, scene)
  if (item.door !== undefined) return false
  const y = item.elevation ?? 0
  if (
    ![scene.width, scene.depth, item.x, item.z, item.rotation, y].every(Number.isFinite) ||
    scene.width <= 0 ||
    scene.depth <= 0 ||
    !product.dimensions.every((value) => Number.isFinite(value) && value > 0) ||
    y < 0 ||
    y + product.dimensions[1] > (scene.height ?? DEFAULT_HEIGHT) + EPSILON
  )
    return false
  const box = rectangle(item, product)
  const halfWidth = radius(box, [1, 0])
  const halfDepth = radius(box, [0, 1])
  return (
    box.x - halfWidth >= -scene.width / 2 - EPSILON &&
    box.z - halfDepth >= -scene.depth / 2 - EPSILON &&
    box.x + halfWidth <= scene.width / 2 + EPSILON &&
    box.z + halfDepth <= scene.depth / 2 + EPSILON
  )
}

/** Settle vertically; reject unsafe landings instead of tipping or teleporting. */
export function settleItem(item: Item, scene: Scene, catalog: Product[]): Item | null {
  const product = catalog.find((value) => value.id === item.productId)
  if (product && isWallFixture(product)) {
    if (item.supportId || item.door) return null
    item = normalizeWallFixture(item, product, scene)
  }
  if (product?.door) {
    const anchored = normalizeDoor(item, product, scene)
    return validDoors({ ...scene, items: [...scene.items.filter(other => other.id !== item.id), anchored] }, catalog) ? anchored : null
  }
  if (!product || !validItemGeometry(item, product, scene, catalog)) return null
  const shape = rectangle(item, product)
  const start = item.elevation ?? 0
  let landing = isAnchored(product) ? start : 0
  let supportId: string | undefined
  if (placementMode(product) === 'surface') {
    for (const other of scene.items) {
      if (other.id === item.id) continue
      const support = catalog.find((value) => value.id === other.productId)
      if (!support || !acceptsSupport(support, product)) continue
      const top = (other.elevation ?? 0) + supportHeight(support)
      if (
        top <= start + EPSILON &&
        top > landing &&
        contains(supportRectangle(other, support), attachmentRectangle(item, product))
      ) {
        landing = top
        supportId = other.id
      }
    }
  }

  // Check the entire vertical sweep, including non-supporting obstructions.
  // Rugs are deliberately non-solid overlays; other Decor items are solid.
  {
    for (const other of scene.items) {
      if (other.id === item.id || other.id === supportId) continue
      if (other.supportId === item.id && previousSupport(other, scene, catalog)?.id === item.id) continue
      const obstacle = catalog.find((value) => value.id === other.productId)
      if (!obstacle || obstacle.door || isRug(obstacle) !== isRug(product)) continue
      const bottom = other.elevation ?? 0
      const top = bottom + obstacle.dimensions[1]
      if (
        bottom < start + product.dimensions[1] - EPSILON &&
        top > landing + EPSILON &&
        overlaps(shape, rectangle(other, obstacle))
      )
        return null
    }
  }
  const settled = { ...item, elevation: landing, supportId }
  return validItemGeometry(settled, product, scene, catalog) && validDoors({ ...scene, items: [...scene.items.filter(other => other.id !== item.id), settled] }, catalog) ? settled : null
}

function transformChanged(a: Item, b: Item) {
  return (
    Math.abs(a.x - b.x) > 1e-8 ||
    Math.abs(a.z - b.z) > 1e-8 ||
    Math.abs(a.rotation - b.rotation) > 1e-8 ||
    Math.abs((a.elevation ?? 0) - (b.elevation ?? 0)) > 1e-8 ||
    a.productId !== b.productId ||
    a.wallMount?.wall !== b.wallMount?.wall ||
    a.wallMount?.offset !== b.wallMount?.offset ||
    a.wallMount?.height !== b.wallMount?.height
  )
}

function previousSupport(item: Item, scene: Scene, catalog: Product[]) {
  const product = catalog.find((value) => value.id === item.productId)
  if (!product || placementMode(product) !== 'surface') return undefined
  const itemShape = attachmentRectangle(item, product)
  return scene.items.find((candidate) => {
    if (candidate.id === item.id) return false
    const support = catalog.find((value) => value.id === candidate.productId)
    return (
      support &&
      acceptsSupport(support, product) &&
      Math.abs((candidate.elevation ?? 0) + supportHeight(support) - (item.elevation ?? 0)) <= EPSILON &&
      contains(supportRectangle(candidate, support), itemShape)
    )
  })
}

/** Apply support relationships atomically, so invalid drops leave the room unchanged. */
export function settleScene(
  next: Scene,
  previous: Scene,
  catalog: Product[],
): { scene: Scene; error?: string } {
  const products = new Map(catalog.map((product) => [product.id, product]))
  const nextItems = new Map(next.items.map((item) => [item.id, item]))
  const oldItems = new Map(previous.items.map((item) => [item.id, item]))
  const resolved = new Map<string, Item>()
  const processing = new Set<string>()
  let error: string | undefined
  if (next.floorColor !== undefined && !validPaintColor(next.floorColor))
    return { scene: previous, error: 'Choose a valid six-digit hex color for the floor.' }
  if (next.wallpapers !== undefined && (typeof next.wallpapers !== 'object' || next.wallpapers === null || Object.entries(next.wallpapers).some(([wall, pattern]) => !['north', 'east', 'south', 'west'].includes(wall) || !['none', 'linen', 'stripes', 'dots', 'botanical'].includes(pattern)))) return { scene: previous, error: 'Invalid wallpaper pattern.' }
  if (next.wallColors !== undefined && !validWallColors(next.wallColors))
    return { scene: previous, error: 'Choose a valid six-digit hex color for each wall.' }
  if (nextItems.size !== next.items.length)
    return { scene: previous, error: 'Every room item needs a unique ID.' }
  for (const item of previous.items) {
    if (item.locked && (products.get(item.productId)?.door || item.wallMount) && !nextItems.has(item.id))
      return { scene: previous, error: 'This fitting is locked. Unlock it before removing it.' }
  }

  function resolve(id: string): Item | undefined {
    if (error) return undefined
    if (resolved.has(id)) return resolved.get(id)
    const original = nextItems.get(id)
    if (!original) return undefined
    const product = products.get(original.productId)
    if (!product) {
      error = 'This item is missing its product information.'
      return undefined
    }
    if (processing.has(id)) {
      error = 'Items cannot support each other in a loop.'
      return undefined
    }
    processing.add(id)
    let candidate = product.door ? normalizeDoor(original, product, next) : isWallFixture(product) ? normalizeWallFixture(original, product, next) : { ...original }
    const old = oldItems.get(id)
    const oldSupport = old && previousSupport(old, previous, catalog)

    if (old && oldSupport && !transformChanged(old, original)) {
      const support = resolve(oldSupport.id)
      if (support) {
        const oldProduct = products.get(oldSupport.productId)!
        const supportProduct = products.get(support.productId)!
        const angle = ((support.rotation - oldSupport.rotation) * Math.PI) / 180
        const dx = old.x - oldSupport.x
        const dz = old.z - oldSupport.z
        candidate = {
          ...candidate,
          x: support.x + dx * Math.cos(angle) + dz * Math.sin(angle),
          z: support.z - dx * Math.sin(angle) + dz * Math.cos(angle),
          rotation:
            ((old.rotation + support.rotation - oldSupport.rotation) % 360 + 360) %
            360,
          elevation:
            (old.elevation ?? 0) +
            (support.elevation ?? 0) +
            supportHeight(supportProduct) -
            (oldSupport.elevation ?? 0) -
            supportHeight(oldProduct),
          supportId: support.id,
        }
      } else {
        candidate.supportId = undefined
      }
    } else if (candidate.supportId && nextItems.has(candidate.supportId)) {
      // Explicit support links also allow new, multi-level groups to resolve.
      resolve(candidate.supportId)
    }
    if (error) return undefined
    const settled = settleItem(
      candidate,
      { ...next, items: [...resolved.values()] },
      catalog,
    )
    if (!settled) {
      error = product.door ? 'Place the door clear of windows, other doors, and furniture, with room to swing inward.' : isWallFixture(product) ? 'Place the wall object on a clear section of wall, away from windows, doors, other fixtures and furniture.' : `Place ${product.name} fully on a clear floor or supporting surface, clear of door swings.`
      return undefined
    }
    const normalizingUnsupportedLegacyItem =
      false // Saved locks are only adjusted by the explicit server migration preview.
    if (
      old?.locked &&
      original.locked &&
      transformChanged(old, settled) &&
      !normalizingUnsupportedLegacyItem
    ) {
      error = `${product.name} is locked. Unlock it before moving or removing its support.`
      return undefined
    }
    resolved.set(id, settled)
    processing.delete(id)
    return settled
  }

  // Floor furniture and anchored fittings precede objects that can rest on them.
  const order = [...next.items].sort((a, b) => {
    const pa = products.get(a.productId)
    const pb = products.get(b.productId)
    const aSurface = pa && placementMode(pa) === 'surface' ? 1 : 0
    const bSurface = pb && placementMode(pb) === 'surface' ? 1 : 0
    return aSurface - bSurface || (a.elevation ?? 0) - (b.elevation ?? 0)
  })
  for (const item of order) resolve(item.id)
  if (error) return { scene: previous, error }
  const scene = { ...next, items: next.items.map((item) => resolved.get(item.id)!) }
  if (!validDoors(scene, catalog))
    return { scene: previous, error: 'Keep doorways clear of windows, other doors, and furniture so each door can open.' }
  // A final pass catches collisions introduced by later-resolved items.
  for (const item of scene.items) {
    const settled = settleItem(item, scene, catalog)
    if (!settled || transformChanged(item, settled))
      return {
        scene: previous,
        error: 'That arrangement leaves an item overlapping or without stable support.',
      }
  }
  return { scene }
}
