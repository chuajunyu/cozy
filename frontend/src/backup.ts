import type { Backup, DesignState, GeneratedProduct, Product } from './types'
import type { Product as StudioProduct, Scene } from './catalog'

export const backupKey = 'cozy.studio.v3'
const samples = new Set(['room-door', 'desk', 'bed', 'sofa', 'shelf', 'chair', 'coffee', 'nightstand', 'rug', 'demo-lamp', 'demo-ceiling-fan'])
const categories = new Set(['room-door', 'desk', 'bed', 'sofa', 'shelf', 'chair', 'coffee_table', 'side_table', 'rug', 'lamp', 'dining_table', 'wardrobe', 'dresser', 'plant', 'custom', 'mattress', 'door'])
function customCategory(p: GeneratedProduct): string {
  if (p.door) return 'door'
  if (p.lighting) return 'lamp'
  const basename = p.id.replace(/^custom-/, '')
  const aliases: Record<string, string> = { desk: 'desk', bed: 'bed', sofa: 'sofa', shelf: 'shelf', chair: 'chair', coffee: 'coffee_table', nightstand: 'side_table', rug: 'rug' }
  const category = aliases[basename] ?? p.category
  return categories.has(category) ? category : 'custom'
}

export function generatedProduct(p: StudioProduct): GeneratedProduct {
  return { id: p.id, name: p.name, category: p.category, price: p.price, dimensions: p.dimensions,
    parts: p.parts, productType: p.productType, priceNote: p.priceNote, placement: p.placement, door: p.door, ...(p.lighting ? { lighting: p.lighting } : {}) }
}

export function makeBackup(state: DesignState, products: Product[]): Backup {
  const { total: _total, complete: _complete, validationIssues: _issues, undoCount: _undo, ...saved } = state
  return { version: 4, state: saved, products: products.filter(p => p.id.startsWith('custom-')).map(p => ({
    id: p.id, name: p.name, category: p.category, price: p.price, dimensions: [p.width, p.height, p.depth],
    parts: p.parts ?? [], productType: p.productType, priceNote: p.priceNote, placement: p.placement, door: p.door, ...(p.lighting ? { lighting: p.lighting } : {}),
  })) }
}

export function migrateLegacy(raw: string, catalog: Product[]): Backup {
  const legacy = JSON.parse(raw) as { scene: Scene; catalog: StudioProduct[] }
  const { scene } = legacy
  if (!scene || !Array.isArray(scene.items) || !Array.isArray(legacy.catalog)) throw new Error('This saved room cannot be read.')
  if (new Set(scene.items.map(i => i.id)).size !== scene.items.length) throw new Error('Duplicate saved item IDs. Your backup is unchanged.')
  const idFor = (id: string) => id.startsWith('ikea-') ? id : samples.has(id) ? `sample-${id}` : id.startsWith('custom-') ? id : `custom-${id}`
  const custom = legacy.catalog.filter(p => !samples.has(p.id) && !p.id.startsWith('ikea-')).map(p => ({ ...generatedProduct(p), id: idFor(p.id) }))
  const slots = Object.fromEntries(scene.items.map(i => {
    const id = idFor(i.productId)
    const p = catalog.find(p => p.id === id)
    const generated = custom.find(p => p.id === id)
    if (!p && !generated) throw new Error(`Missing saved product: ${i.productId}. Your backup is unchanged.`)
    return [i.id, { id: i.id, label: (p?.name ?? generated!.name).slice(0, 80), catalogId: id,
      category: p?.category ?? customCategory(generated!), zone: 'Room', group: 'Your additions', anchor: false,
      x: i.x - scene.width / 2, z: i.z - scene.depth / 2, rotation: i.rotation, elevation: i.elevation ?? 0,
      wallMount: i.wallMount, supportId: i.supportId ?? null, door: i.door ?? null, light: i.light ?? null, locked: i.locked, liked: false, replacing: false, explanation: 'Restored from this device.' }]
  }))
  return { version: 2, products: custom, state: { revision: 0,
    room: { width: scene.width, depth: scene.depth, height: scene.height ?? 2.7, wallpapers: scene.wallpapers, floorColor: scene.floorColor, wallColors: scene.wallColors, windows: scene.windows ?? [{ wall: 'east', offset: .5, width: Math.min(1.8, scene.depth - .4), height: 1.4, sill: .9 }], sunHour: scene.sunHour ?? ((scene.daylight ?? 1) === 0 ? 20 : 9), daylight: scene.daylight ?? 1 },
    brief: '', budget: scene.budget || null, concept: { title: 'Your saved room', summary: '', palette: [], materials: [] },
    slots, feedback: [], rejected: {}, rerollTargets: null } }
}
