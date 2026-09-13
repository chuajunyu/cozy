import type { Item, Product, Scene } from './catalog.ts'
import { settleItem, settleScene } from './placement.ts'

function kindFromText(text: string, category: string): string | undefined {
  if (/\b(sofa|sofas|loveseat|couch)\b/.test(text)) return 'sofa'
  if (/\b(bed frame|bedframe|day[ -]?bed)\b/.test(text)) return 'bed'
  const bedding = text.match(/\bmattress (pad|protector|topper)s?\b/)
  if (bedding) return `mattress ${bedding[1]}`
  if (/\bmattress(?:es)?\b/.test(text)) return 'mattress'
  // Chair checks precede desks and tables: "desk chair" is a seat.
  if (/\b(armchair|wing chair|lounge chair|easy chair)\b/.test(text)) return 'armchair'
  if (/\bchair\b/.test(text)) {
    if (/\b(office|gaming|desk|swivel)\b/.test(text) || category === 'Workspace') return 'office chair'
    if (/\bdining\b/.test(text) || category === 'Dining') return 'dining chair'
    return 'chair'
  }
  if (/\b(bedside|nightstand)\b/.test(text)) return 'bedside table'
  if (/\bbed\b/.test(text)) return 'bed'
  if (/\bwardrobe\b/.test(text)) return 'wardrobe'
  if (/\b(drawers|dresser)\b/.test(text)) return 'chest of drawers'
  if (/\b(bookcase|shelf|shelving)\b/.test(text)) return 'bookcase'
  if (/\bdesk\b/.test(text)) return 'desk'
  if (/\b(coffee|side)\b.*\btable\b/.test(text)) return 'coffee / side table'
  if (/\bdining table\b/.test(text) || (/\btable\b/.test(text) && category === 'Dining')) return 'dining table'
  if (/\btable\b/.test(text)) return 'table'
  if (/\b(rug|carpet|floor mat)\b/.test(text)) return 'rug'
  return undefined
}

/** Match furniture by its use, rather than the broad room category. */
export function alternativeKind(product: Product): string {
  if (product.door) return 'door'
  if (product.lighting) return `${product.lighting.mount} light`
  if (product.placement?.surfaceKind === 'mattress') return 'mattress'
  const type = product.productType?.trim().toLowerCase() ?? ''
  const name = product.name.trim().toLowerCase()
  // Specific catalog types take precedence over incidental words in names,
  // e.g. a bed sold "with mattress" is still a bed.
  return kindFromText(type, product.category) ?? kindFromText(name, product.category) ?? (type || name)
}

function isIkea(product: Product) {
  return product.id.startsWith('ikea-') || product.brand?.toLowerCase() === 'ikea'
}

function isAvailable(product: Product) {
  return !isIkea(product) || product.readyForPreview === true
}

function footprintDistance(product: Product, selected: Product) {
  return [0, 2].reduce((distance, axis) => {
    const reference = selected.dimensions[axis]
    const dimension = product.dimensions[axis]
    return distance + (reference > 0 && dimension > 0 ? Math.abs(Math.log(dimension / reference)) : Infinity)
  }, 0)
}

export function findAlternatives(selected: Product, catalog: Product[]): Product[] {
  const kind = alternativeKind(selected)
  return catalog.filter(product => product.id !== selected.id && isAvailable(product) && alternativeKind(product) === kind)
    .sort((a, b) =>
      Number(isIkea(b)) - Number(isIkea(a)) ||
      footprintDistance(a, selected) - footprintDistance(b, selected) ||
      Math.abs(a.price - selected.price) - Math.abs(b.price - selected.price) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}

function replacementLight(item: Item, product: Product): Item['light'] {
  if (!product.lighting) return undefined
  const whites = ['#ffd3a0', '#fff4dd', '#dceaff']
  const previous = item.light?.color.toLowerCase() ?? whites[0]
  const mode = product.lighting.colorMode
  const color = mode === 'fixed' || !/^#[0-9a-f]{6}$/.test(previous) || (mode === 'white-spectrum' && !whites.includes(previous))
    ? whites[0] : previous
  return {
    on: item.light?.on ?? true,
    brightness: Number.isFinite(item.light?.brightness) ? Math.max(0, Math.min(1, item.light!.brightness)) : .7,
    color,
  }
}

/** Replace in place, retaining support relationships or rolling back atomically. */
export function replaceItem(
  scene: Scene,
  itemId: string,
  replacement: Product,
  catalog: Product[],
): { scene: Scene; error?: string } {
  const item = scene.items.find(candidate => candidate.id === itemId)
  const selected = catalog.find(product => product.id === item?.productId)
  const canonical = catalog.find(product => product.id === replacement.id)
  const reject = (error: string) => ({ scene, error })
  if (!item || !selected) return reject('Select a room item with available product information.')
  if (!canonical || !isAvailable(canonical)) return reject('This option is not ready for preview.')
  if (canonical.id === selected.id) return { scene }
  if (item.locked) return reject('Unlock this item before trying another option.')
  if (alternativeKind(canonical) !== alternativeKind(selected)) return reject('Choose another option of the same furniture type.')

  // Infer legacy links too, so a swap cannot silently move a supported piece
  // to the floor when a smaller replacement no longer reaches it.
  const supports = new Map<string, string>()
  for (const current of scene.items) {
    const support = current.supportId ?? settleItem(current, scene, catalog)?.supportId
    if (support) supports.set(current.id, support)
  }
  const changed: Item = {
    ...item,
    productId: canonical.id,
    supportId: supports.get(item.id),
    light: replacementLight(item, canonical),
  }
  const result = settleScene({ ...scene, items: scene.items.map(current => current.id === itemId ? changed : current) }, scene, catalog)
  if (result.error) return result
  for (const current of result.scene.items) {
    const support = supports.get(current.id)
    if (support && current.supportId !== support) return reject('This option cannot keep every item on its current supporting surface.')
  }
  const settled = result.scene.items.find(current => current.id === itemId)!
  if (Math.abs((settled.elevation ?? 0) - (item.elevation ?? 0)) > .005) return reject('This option cannot stay at the current height.')
  return result
}
