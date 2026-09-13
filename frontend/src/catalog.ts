import type { Product as WireProduct } from './types'
import type { RoomWindow, Wall } from './sunlight'
import { validDoors } from './doors.ts'
export type Vec3 = [number, number, number]
export type Part = {
  shape: 'box' | 'cylinder'
  size: Vec3
  position: Vec3
  color: string
}
export type Product = {
  id: string
  name: string
  category: string
  price: number
  dimensions: Vec3
  parts: Part[]
  wire?: WireProduct
  floorLayer?: boolean
  modelUrl?: string
  thumbnailUrl?: string
  productUrl?: string
  brand?: string
  color?: string
  fetchedAt?: string
  currency?: string
  productType?: string
  colorFamilies?: string[]
  features?: string[]
  priceBand?: string
  dimensionsMeasuredFromModel?: boolean
  readyForPreview?: boolean
  door?: { kind: 'solid' }
  lighting?: {
    mount: 'floor' | 'surface' | 'ceiling'
    colorMode: 'fixed' | 'white-spectrum' | 'rgb' | 'bulb-dependent'
    dimmable: boolean
    evidence: string
    emitter?: Vec3
    output?: { lumens: number; evidence: string }
  }
  placement?: {
    mode: 'floor' | 'surface' | 'ceiling' | 'wall'
    canSupport?: boolean
    surfaceKind?: 'mattress'
    support?: { kind: 'mattress'; width: number; depth: number; height: number; center: [number, number]; evidence: string }
  }
  priceNote?: string
}
export type Item = {
  id: string
  productId: string
  x: number
  z: number
  rotation: number
  locked: boolean
  supportId?: string
  elevation?: number
  light?: { on: boolean; brightness: number; color: string }
  door?: { wall: Wall; offset: number; open: boolean }
}
export type Scene = {
  revision?: number
  height?: number
  width: number
  depth: number
  budget: number
  windows?: RoomWindow[]
  sunHour?: number
  daylight?: number
  wallColors?: Partial<Record<Wall, string>>
  items: Item[]
}
const box = (size: Vec3, position: Vec3, color: string): Part => ({
  shape: 'box',
  size,
  position,
  color,
})
const wood = '#bd946d',
  cream = '#ece5d9',
  green = '#89957b',
  dark = '#555d50'
function table(w: number, d: number, h: number): Part[] {
  return [
    box([w, 0.07, d], [0, h - 0.035, 0], wood),
    ...[-1, 1].flatMap((x) =>
      [-1, 1].map((z) =>
        box(
          [0.065, h - 0.07, 0.065],
          [x * (w / 2 - 0.07), (h - 0.07) / 2, z * (d / 2 - 0.07)],
          wood,
        ),
      ),
    ),
  ]
}
export const initialCatalog: Product[] = [
  {
    id: 'room-door',
    name: 'Classic door',
    category: 'Doors',
    productType: 'door',
    price: 0,
    priceNote: 'Room element · price not included',
    dimensions: [0.9, 2.1, 0.045],
    door: { kind: 'solid' },
    placement: { mode: 'wall', canSupport: false },
    parts: [box([0.9, 2.1, 0.045], [0, 1.05, 0], cream)],
  },
  {
    id: 'desk',
    placement: { mode: 'floor', canSupport: true },
    name: 'Everyday desk',
    category: 'Workspace',
    price: 149,
    dimensions: [1.2, 0.75, 0.6],
    parts: table(1.2, 0.6, 0.75),
  },
  {
    id: 'bed',
    name: 'Sunday bed',
    category: 'Bedroom',
    price: 399,
    dimensions: [1.5, 0.85, 2.1],
    parts: [
      box([1.5, 0.25, 2.1], [0, 0.2, 0], wood),
      box([1.44, 0.2, 2], [0, 0.425, 0.02], cream),
      box([1.5, 0.85, 0.08], [0, 0.425, -1.01], wood),
      box([1.45, 0.08, 1.15], [0, 0.56, 0.4], green),
      ...[-0.37, 0.37].map((x) =>
        box([0.6, 0.12, 0.4], [x, 0.58, -0.66], '#fff9ed'),
      ),
    ],
  },
  {
    id: 'sofa',
    name: 'Soft corner sofa',
    category: 'Living',
    price: 459,
    dimensions: [1.8, 0.85, 0.85],
    parts: [
      box([1.8, 0.24, 0.85], [0, 0.25, 0], green),
      box([1.8, 0.55, 0.17], [0, 0.575, -0.34], green),
      ...[-0.82, 0.82].map((x) =>
        box([0.16, 0.55, 0.85], [x, 0.425, 0], green),
      ),
      ...[-0.4, 0.4].map((x) =>
        box([0.72, 0.17, 0.65], [x, 0.45, 0.04], '#a0ac91'),
      ),
    ],
  },
  {
    id: 'shelf',
    placement: { mode: 'floor', canSupport: true },
    name: 'Open oak shelf',
    category: 'Storage',
    price: 119,
    dimensions: [0.8, 1.5, 0.3],
    parts: [
      ...[-0.37, 0.37].map((x) => box([0.06, 1.5, 0.3], [x, 0.75, 0], wood)),
      ...[0.05, 0.5, 0.97, 1.47].map((y) =>
        box([0.8, 0.05, 0.3], [0, y, 0], wood),
      ),
      box([0.18, 0.32, 0.2], [-0.15, 0.69, 0], green),
      box([0.25, 0.18, 0.23], [0.1, 1.09, 0], cream),
    ],
  },
  {
    id: 'chair',
    name: 'Studio chair',
    category: 'Workspace',
    price: 79,
    dimensions: [0.48, 0.84, 0.5],
    parts: [
      ...table(0.48, 0.5, 0.46),
      box([0.48, 0.4, 0.055], [0, 0.64, -0.22], dark),
    ],
  },
  {
    id: 'coffee',
    placement: { mode: 'floor', canSupport: true },
    name: 'Gather coffee table',
    category: 'Living',
    price: 89,
    dimensions: [0.9, 0.4, 0.55],
    parts: table(0.9, 0.55, 0.4),
  },
  {
    id: 'nightstand',
    placement: { mode: 'floor', canSupport: true },
    name: 'Little bedside',
    category: 'Bedroom',
    price: 59,
    dimensions: [0.4, 0.5, 0.38],
    parts: [
      ...table(0.4, 0.38, 0.5),
      box([0.3, 0.2, 0.3], [0, 0.34, 0], cream),
    ],
  },
  {
    id: 'rug',
    name: 'Woven rug',
    category: 'Decor',
    price: 69,
    dimensions: [1.6, 0.015, 2.3],
    parts: [box([1.6, 0.015, 2.3], [0, 0.0075, 0], '#d5c6aa')],
  },
]
initialCatalog.push({
  id: 'demo-lamp',
  name: 'Glow study lamp (sample)',
  category: 'Lighting',
  price: 45,
  dimensions: [0.25, 0.45, 0.25],
  parts: [
    {
      shape: 'cylinder',
      size: [0.25, 0.03, 0.25],
      position: [0, 0.015, 0],
      color: '#637556',
    },
    {
      shape: 'cylinder',
      size: [0.025, 0.3, 0.025],
      position: [0, 0.18, 0],
      color: '#a28b69',
    },
    {
      shape: 'cylinder',
      size: [0.23, 0.16, 0.23],
      position: [0, 0.37, 0],
      color: '#e6ddc9',
    },
  ],
  lighting: {
    mount: 'surface',
    colorMode: 'rgb',
    dimmable: true,
    evidence: 'Sample fixture: simulated adjustable bulb.',
    emitter: [0, 0.31, 0],
  },
})
initialCatalog.push({
  id: 'demo-ceiling-fan',
  name: 'Ceiling fan with light (sample)',
  category: 'Lighting',
  price: 180,
  dimensions: [1.2, 0.35, 1.2],
  parts: [
    {
      shape: 'cylinder',
      size: [0.08, 0.17, 0.08],
      position: [0, 0.265, 0],
      color: '#77746a',
    },
    box([1.2, 0.03, 0.13], [0, 0.17, 0], '#b99b74'),
    box([0.13, 0.03, 1.2], [0, 0.17, 0], '#b99b74'),
    {
      shape: 'cylinder',
      size: [0.25, 0.13, 0.25],
      position: [0, 0.08, 0],
      color: '#efeadc',
    },
  ],
  lighting: {
    mount: 'ceiling',
    colorMode: 'white-spectrum',
    dimmable: true,
    evidence:
      'Sample ceiling fan: simulated tunable light; fan blades are static.',
    emitter: [0, 0.025, 0],
  },
})
export const initialScene: Scene = {
  width: 5,
  depth: 4.5,
  budget: 1500,
  items: [
    { id: 'bed-1', productId: 'bed', x: 1, z: 1.2, rotation: 0, locked: false },
    {
      id: 'desk-1',
      productId: 'desk',
      x: 3.7,
      z: 0.55,
      rotation: 0,
      locked: false,
    },
    {
      id: 'chair-1',
      productId: 'chair',
      x: 3.7,
      z: 1.25,
      rotation: 0,
      locked: false,
    },
    {
      id: 'shelf-1',
      productId: 'shelf',
      x: 4.55,
      z: 2.6,
      rotation: 90,
      locked: false,
    },
    {
      id: 'night-1',
      productId: 'nightstand',
      x: 2.1,
      z: 0.5,
      rotation: 0,
      locked: false,
    },
  ],
}
export function footprint(item: Item, product: Product) {
  return item.rotation % 180 === 0
    ? [product.dimensions[0], product.dimensions[2]]
    : [product.dimensions[2], product.dimensions[0]]
}
export function validPlacement(item: Item, scene: Scene, catalog: Product[]) {
  const p = catalog.find((p) => p.id === item.productId)
  if (!p) return false
  if (!validDoors({ ...scene, items: [...scene.items.filter(i => i.id !== item.id), item] }, catalog)) return false
  if (p.door) return true
  const candidate = { ...scene, items: [...scene.items.filter(other => other.id !== item.id), item] }
  if (!validDoors(candidate, catalog)) return false
  if (p.door) return true
  const y = item.elevation ?? 0
  if (!Number.isFinite(y) || y < 0 || y + p.dimensions[1] > (scene.height ?? 2.6) + 1e-6) return false
  const [w, d] = footprint(item, p)
  if (
    item.x - w / 2 < -scene.width / 2 - 1e-6 ||
    item.z - d / 2 < -scene.depth / 2 - 1e-6 ||
    item.x + w / 2 > scene.width / 2 + 1e-6 ||
    item.z + d / 2 > scene.depth / 2 + 1e-6
  )
    return false
  return scene.items.every((other) => {
    if (other.id === item.id) return true
    const q = catalog.find((p) => p.id === other.productId)
    if (!q || Boolean(p.floorLayer) !== Boolean(q.floorLayer)) return true
    const y = item.elevation ?? 0,
      oy = other.elevation ?? 0
    if (y >= oy + q.dimensions[1] - 0.005 || oy >= y + p.dimensions[1] - 0.005)
      return true
    const [ow, od] = footprint(other, q)
    return (
      Math.abs(item.x - other.x) >= (w + ow) / 2 - 1e-6 ||
      Math.abs(item.z - other.z) >= (d + od) / 2 - 1e-6
    )
  })
}
export function parseProduct(raw: unknown): Product {
  const p = raw as Product
  const vector = (v: unknown, positive = false): v is Vec3 =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every(
      (n) =>
        typeof n === 'number' &&
        Number.isFinite(n) &&
        (!positive || (n > 0 && n <= 10)),
    )
  if (
    !p ||
    typeof p.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,60}$/.test(p.id) ||
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    p.name.length > 100 ||
    typeof p.category !== 'string' ||
    p.category.length > 40 ||
    typeof p.price !== 'number' ||
    !Number.isFinite(p.price) ||
    p.price < 0 ||
    !vector(p.dimensions, true) ||
    !Array.isArray(p.parts) ||
    (!p.parts.length && !p.modelUrl) ||
    p.parts.length > 150
  )
    throw new Error(
      'Use a product with an ID, name, category, price, dimensions [width, height, depth], and 1–150 parts.',
    )
  if (p.modelUrl && !/^\/models\/ikea\/[0-9]{8}\.glb$/.test(p.modelUrl))
    throw new Error('Use a local IKEA model path.')
  for (const key of ['thumbnailUrl', 'productUrl'] as const) {
    if (p[key]) {
      const url = new URL(p[key]!)
      if (
        url.protocol !== 'https:' ||
        !(url.hostname === 'ikea.com' || url.hostname.endsWith('.ikea.com'))
      )
        throw new Error('Expected an HTTPS IKEA source link.')
    }
  }
  for (const key of [
    'brand',
    'color',
    'fetchedAt',
    'currency',
    'priceNote',
    'productType',
    'priceBand',
  ] as const) {
    if (
      p[key] !== undefined &&
      (typeof p[key] !== 'string' || p[key]!.length > 500)
    ) {
      throw new Error('Product metadata must be short text values.')
    }
  }
  for (const key of ['features', 'colorFamilies'] as const) {
    const values = p[key]
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.length > 30 ||
        values.some((v) => typeof v !== 'string' || v.length > 100))
    )
      throw new Error('Invalid product filter attributes.')
  }
  if (p.placement && (!['floor', 'surface', 'ceiling', 'wall'].includes(p.placement.mode) || (p.placement.canSupport !== undefined && typeof p.placement.canSupport !== 'boolean'))) throw new Error('Invalid placement capabilities.')
  if (p.door !== undefined && (!p.door || p.door.kind !== 'solid' || p.placement?.mode !== 'wall' || p.dimensions[0] < .5 || p.dimensions[0] > 2 || p.dimensions[1] < 1.8 || p.dimensions[1] > 2.5 || p.dimensions[2] > .2 || p.lighting || p.modelUrl || p.placement.canSupport || p.placement.support || p.placement.surfaceKind))
    throw new Error('Doors need a solid leaf and wall placement with valid doorway dimensions.')
  if (p.placement?.mode === 'wall' && !p.door)
    throw new Error('Wall placement requires door capabilities.')
  if (p.placement?.surfaceKind !== undefined && p.placement.surfaceKind !== 'mattress')
    throw new Error('Invalid supported item kind.')
  const support = p.placement?.support
  if (support && (support.kind !== 'mattress' || ![support.width, support.depth, support.height].every(n => Number.isFinite(n) && n > 0) || !Array.isArray(support.center) || support.center.length !== 2 || !support.center.every(Number.isFinite) || support.height > p.dimensions[1] || Math.abs(support.center[0]) + support.width / 2 > p.dimensions[0] / 2 + .005 || Math.abs(support.center[1]) + support.depth / 2 > p.dimensions[2] / 2 + .005 || typeof support.evidence !== 'string'))
    throw new Error('Invalid mattress deck dimensions or provenance.')
  if (p.lighting) {
    if (
      !['floor', 'surface', 'ceiling'].includes(p.lighting.mount) ||
      !['fixed', 'white-spectrum', 'rgb', 'bulb-dependent'].includes(
        p.lighting.colorMode,
      ) ||
      typeof p.lighting.dimmable !== 'boolean' ||
      typeof p.lighting.evidence !== 'string'
    )
      throw new Error('Invalid light capabilities.')
    if (p.lighting.output && (!Number.isFinite(p.lighting.output.lumens) || p.lighting.output.lumens <= 0 || p.lighting.output.lumens > 20000 || typeof p.lighting.output.evidence !== 'string'))
      throw new Error('Invalid fixed light output.')
    if (p.lighting.emitter && !vector(p.lighting.emitter))
      throw new Error('Invalid light position.')
  }
  for (const part of p.parts) {
    if (
      !part ||
      !['box', 'cylinder'].includes(part.shape) ||
      !vector(part.size, true) ||
      !vector(part.position) ||
      typeof part.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(part.color)
    )
      throw new Error(
        'Each part needs a box/cylinder shape, size and position arrays, and a six-digit hex color.',
      )
    if (
      part.position.some(
        (n, i) =>
          Math.abs(n) + part.size[i] / 2 >
          (i === 1 ? p.dimensions[i] : p.dimensions[i] / 2) + 0.03,
      ) ||
      part.position[1] - part.size[1] / 2 < -0.03
    )
      throw new Error(
        'Parts must fit the declared dimensions, centered horizontally with their base on the floor.',
      )
  }
  return p
}

export type CatalogFilters = {
  source: string
  query: string
  category: string
  color: string
  feature: string
  maxPrice: string
  productType: string
}
export function filterProducts(products: Product[], filters: CatalogFilters) {
  const words = filters.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return products.filter((p) => {
    const isIkea = p.id.startsWith('ikea-')
    if (isIkea && p.readyForPreview !== true) return false
    if (filters.source === 'IKEA' ? !isIkea : filters.source === 'Room elements' ? !p.door : isIkea || !!p.door) return false
    const searchable = [p.name, p.color, p.productType, ...(p.features ?? [])]
      .join(' ')
      .toLowerCase()
    return (
      (filters.category === 'All' || p.category === filters.category) &&
      (filters.color === 'All' || p.colorFamilies?.includes(filters.color)) &&
      (filters.feature === 'All' || p.features?.includes(filters.feature)) &&
      (filters.productType === 'All' ||
        p.productType === filters.productType) &&
      (filters.maxPrice === '' || p.price <= Number(filters.maxPrice)) &&
      words.every((w) => searchable.includes(w))
    )
  })
}

export function toStudioProduct(p: WireProduct): Product {
  return { ...p, wire: p, category: p.collection ?? p.category, dimensions: [p.width, p.height, p.depth], parts: p.parts ?? [], lighting: p.lighting ?? undefined }
}

for (const p of initialCatalog) p.id = `sample-${p.id}`
