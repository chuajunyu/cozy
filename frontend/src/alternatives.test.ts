import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alternativeKind, findAlternatives, replaceItem } from './alternatives.ts'
import { initialCatalog } from './catalog.ts'
import type { Item, Product, Scene } from './catalog.ts'

const sofa: Product = { id: 'sofa', name: 'Soft sofa', category: 'Living', price: 500, dimensions: [2, .8, .9], parts: [] }
const desk: Product = { id: 'desk', name: 'Desk', category: 'Workspace', price: 150, dimensions: [1.4, .75, .8], parts: [], placement: { mode: 'floor', canSupport: true } }
const lamp: Product = { id: 'lamp', name: 'Desk lamp', category: 'Lighting', price: 30, dimensions: [.2, .4, .2], parts: [], lighting: { mount: 'surface', colorMode: 'rgb', dimmable: true, evidence: 'Test lamp' } }
const bed: Product = { id: 'bed', name: 'Bed frame', category: 'Bedroom', price: 300, dimensions: [1.66, 1, 2.1], parts: [], placement: { mode: 'floor', support: { kind: 'mattress', width: 1.5, depth: 2, height: .27, center: [0, 0], evidence: 'Test deck' } } }
const mattress: Product = { id: 'mattress', name: 'Mattress', category: 'Bedroom', price: 100, dimensions: [1.5, .24, 2], parts: [], placement: { mode: 'surface', surfaceKind: 'mattress' } }
const catalog = [sofa, desk, lamp, bed, mattress]
const item = (product: Product, changes: Partial<Item> = {}): Item => ({ id: `${product.id}-1`, productId: product.id, x: 3, z: 2.5, rotation: 0, locked: false, elevation: 0, ...changes })
const room = (items: Item[]): Scene => ({ width: 6, depth: 5, budget: 1500, sunHour: 13.5, items })
const option = (product: Product, changes: Partial<Product> = {}): Product => ({ ...product, id: `${product.id}-option`, ...changes })

test('alternatives distinguish sofas, sofa-beds, armchairs, desk chairs and desks', () => {
  assert.equal(alternativeKind(option(sofa, { name: 'Sofa-bed' })), 'sofa')
  assert.equal(alternativeKind(option(sofa, { name: 'Wing chair', productType: 'Armchair' })), 'armchair')
  assert.equal(alternativeKind(option(desk, { name: 'Desk chair' })), 'office chair')
  assert.notEqual(alternativeKind(option(desk, { name: 'Desk chair' })), alternativeKind(desk))
  const alternatives = findAlternatives(sofa, [sofa, option(sofa), option(sofa, { id: 'chair', name: 'Chair' }), bed])
  assert.deepEqual(alternatives.map(product => product.id), ['sofa-option'])
})

test('samples missing product types map to appropriate real catalog types', () => {
  const expected: Record<string, string> = { sofa: 'sofa', bed: 'bed', desk: 'desk', shelf: 'bookcase', chair: 'office chair', coffee: 'coffee / side table', nightstand: 'bedside table', rug: 'rug', 'demo-lamp': 'surface light', 'demo-ceiling-fan': 'ceiling light', 'room-door': 'door' }
  for (const sample of initialCatalog) assert.equal(alternativeKind(sample), expected[sample.id])
  assert.equal(alternativeKind(option(desk, { name: 'BOLLSIDAN Laptop stand', productType: 'Desk' })), 'desk')
  assert.equal(alternativeKind(option(lamp, { productType: 'Desk' })), 'surface light')
})

test('specific catalog types outrank incidental names and mattress accessories stay separate', () => {
  assert.equal(alternativeKind(option(bed, { name: 'MALM Bed frame with mattress', productType: 'Bed' })), 'bed')
  assert.equal(alternativeKind(option(bed, { name: 'Day-bed with mattress' })), 'bed')
  assert.equal(alternativeKind(option(bed, { name: 'Bed frame with mattress' })), 'bed')
  assert.equal(alternativeKind(option(sofa, { name: 'Convertible sofa with bed frame', productType: 'Sofa' })), 'sofa')
  assert.equal(alternativeKind(option(mattress, { name: 'Bed frame size mattress', productType: 'Mattress' })), 'mattress')
  const pad = option(mattress, { name: 'Mattress pad', productType: 'Mattress pad', placement: undefined })
  assert.equal(alternativeKind(pad), 'mattress pad')
  assert.notEqual(alternativeKind(pad), alternativeKind(mattress))
})

test('recommendations group lights by mounting type and exclude unready IKEA products', () => {
  const ready = option(lamp, { id: 'ikea-ready', readyForPreview: true })
  const unavailable = option(lamp, { id: 'ikea-review', readyForPreview: false })
  const missingReady = option(lamp, { id: 'ikea-missing' })
  const branded = option(lamp, { id: 'branded', brand: 'IKEA' })
  const ceiling = option(lamp, { id: 'ceiling', lighting: { ...lamp.lighting!, mount: 'ceiling' } })
  assert.deepEqual(findAlternatives(lamp, [lamp, ready, unavailable, missingReady, branded, ceiling]), [ready])
})

test('recommendations favor real options, then footprint, price distance and stable ID', () => {
  const sample = option(sofa, { id: 'sample' })
  const close = option(sofa, { id: 'ikea-close', readyForPreview: true, dimensions: [2.1, 1.2, .9], price: 1000 })
  const cheap = option(sofa, { id: 'ikea-cheap', readyForPreview: true, dimensions: [3, .8, 1], price: 500 })
  const a = option(close, { id: 'ikea-a', price: 550 })
  const b = option(a, { id: 'ikea-b', price: 450 })
  const products = [sample, cheap, close, b, a]
  assert.deepEqual(findAlternatives(sofa, products).map(product => product.id), ['ikea-a', 'ikea-b', 'ikea-close', 'ikea-cheap', 'sample'])
  assert.deepEqual(products, [sample, cheap, close, b, a], 'Catalog order is not mutated')
})

test('valid swaps retain selection ID, pose and scene settings without mutating input', () => {
  const original = item(sofa, { rotation: 35 })
  const before = room([original])
  const replacement = option(sofa, { dimensions: [2.1, .9, .95] })
  const result = replaceItem(before, original.id, replacement, [...catalog, replacement])
  assert.equal(result.error, undefined)
  assert.deepEqual(result.scene.items[0], { ...original, productId: replacement.id, supportId: undefined, light: undefined })
  assert.equal(result.scene.budget, before.budget)
  assert.equal(result.scene.sunHour, before.sunHour)
  assert.equal(before.items[0], original)
  assert.equal(original.productId, sofa.id)
  assert.equal(replaceItem(before, original.id, sofa, catalog).scene, before)
})

test('canonical availability and furniture type are enforced even with forged option metadata', () => {
  const before = room([item(sofa)])
  const unready = option(sofa, { id: 'ikea-review', readyForPreview: false })
  const huge = option(sofa, { dimensions: [10, .8, 10] })
  for (const replacement of [option(sofa, { id: 'missing-product' }), { ...unready, readyForPreview: true }, desk, { ...huge, dimensions: sofa.dimensions }]) {
    const result = replaceItem(before, before.items[0].id, replacement, [...catalog, unready, huge])
    assert.equal(result.scene, before)
    assert.ok(result.error)
  }
})

test('locked items, boundary overflows and neighbor collisions reject atomically', () => {
  const replacement = option(sofa, { dimensions: [3, .9, 1] })
  const cases = [
    room([item(sofa, { locked: true })]),
    room([item(sofa, { x: 1 })]),
    room([item(sofa, { x: 1.5 }), item(desk, { x: 3.4 })]),
    room([item(sofa, { z: .6, rotation: 90 })]),
  ]
  for (const before of cases) {
    const result = replaceItem(before, before.items[0].id, replacement, [...catalog, replacement])
    assert.equal(result.scene, before)
    assert.ok(result.error)
  }
})

test('replacing a desk raises its lamp with the new supporting surface', () => {
  const table = item(desk)
  const light = item(lamp, { x: 3.3, elevation: .75, supportId: table.id })
  const before = room([light, table])
  const replacement = option(desk, { dimensions: [1.5, .9, .85] })
  const result = replaceItem(before, table.id, replacement, [...catalog, replacement])
  assert.equal(result.error, undefined)
  assert.equal(result.scene.items[0].x, light.x)
  assert.equal(result.scene.items[0].elevation, .9)
  assert.equal(result.scene.items[0].supportId, table.id)
})

test('a smaller desk cannot silently drop its lamp, including inferred legacy attachments', () => {
  const table = item(desk)
  const replacement = option(desk, { dimensions: [.4, .75, .4] })
  for (const supportId of [table.id, undefined]) {
    const before = room([table, item(lamp, { x: 3.55, elevation: .75, supportId })])
    const result = replaceItem(before, table.id, replacement, [...catalog, replacement])
    assert.equal(result.scene, before)
    assert.match(result.error!, /supporting surface/)
  }
})

test('a locked dependent blocks swaps that would move it', () => {
  const table = item(desk)
  const before = room([table, item(lamp, { elevation: .75, supportId: table.id, locked: true })])
  const replacement = option(desk, { dimensions: [1.4, .9, .8] })
  const result = replaceItem(before, table.id, replacement, [...catalog, replacement])
  assert.equal(result.scene, before)
  assert.match(result.error!, /locked/)
})

test('surface light swaps retain support, elevation and on state while adapting color', () => {
  const table = item(desk)
  const light = item(lamp, { elevation: .75, supportId: table.id, light: { on: false, brightness: .7, color: '#ff92cd' } })
  const before = room([light, table])
  for (const colorMode of ['fixed', 'white-spectrum', 'rgb', 'bulb-dependent'] as const) {
    const replacement = option(lamp, { lighting: { ...lamp.lighting!, colorMode } })
    const result = replaceItem(before, light.id, replacement, [...catalog, replacement])
    assert.equal(result.error, undefined)
    assert.equal(result.scene.items[0].elevation, .75)
    assert.equal(result.scene.items[0].supportId, table.id)
    assert.equal(result.scene.items[0].light?.on, false)
    assert.equal(result.scene.items[0].light?.color, ['fixed', 'white-spectrum'].includes(colorMode) ? '#ffd3a0' : '#ff92cd')
  }
})

test('an oversized surface light cannot replace a lamp on a smaller desk', () => {
  const table = item(desk)
  const light = item(lamp, { elevation: .75, supportId: table.id })
  const before = room([table, light])
  const replacement = option(lamp, { dimensions: [1.5, .4, 1] })
  const result = replaceItem(before, light.id, replacement, [...catalog, replacement])
  assert.equal(result.scene, before)
  assert.ok(result.error)
})

test('bed swaps carry mattresses onto compatible decks and reject incompatible decks', () => {
  const frame = item(bed)
  const bedding = item(mattress, { elevation: .27, supportId: frame.id })
  const before = room([bedding, frame])
  const replacement = option(bed, { placement: { ...bed.placement!, support: { ...bed.placement!.support!, height: .35 } } })
  const valid = replaceItem(before, frame.id, replacement, [...catalog, replacement])
  assert.equal(valid.error, undefined)
  assert.equal(valid.scene.items[0].elevation, .35)
  assert.equal(valid.scene.items[0].supportId, frame.id)
  for (const incompatible of [
    option(bed, { placement: { mode: 'floor' } }),
    option(bed, { placement: { ...bed.placement!, support: { ...bed.placement!.support!, width: 1.2 } } }),
  ]) {
    const result = replaceItem(before, frame.id, incompatible, [...catalog, incompatible])
    assert.equal(result.scene, before)
    assert.ok(result.error)
  }
})

test('mattress swaps keep the bed attachment and reject incompatible sizes', () => {
  const frame = item(bed)
  const bedding = item(mattress, { elevation: .27, supportId: frame.id })
  const before = room([frame, bedding])
  const replacement = option(mattress, { dimensions: [1.5, .3, 2] })
  const valid = replaceItem(before, bedding.id, replacement, [...catalog, replacement])
  assert.equal(valid.error, undefined)
  assert.equal(valid.scene.items[1].elevation, .27)
  assert.equal(valid.scene.items[1].supportId, frame.id)
  const smaller = option(mattress, { dimensions: [1.2, .3, 2] })
  const smallerResult = replaceItem(before, bedding.id, smaller, [...catalog, smaller])
  assert.equal(smallerResult.error, undefined)
  assert.equal(smallerResult.scene.items[1].supportId, frame.id)
  const wrongSize = option(mattress, { dimensions: [1.8, .3, 2] })
  const invalid = replaceItem(before, bedding.id, wrongSize, [...catalog, wrongSize])
  assert.equal(invalid.scene, before)
  assert.ok(invalid.error)
})

test('ceiling replacements preserve mounting height and reject room-height overflows', () => {
  const ceiling = option(lamp, { id: 'ceiling', dimensions: [.5, .3, .5], lighting: { ...lamp.lighting!, mount: 'ceiling' } })
  const mounted = item(ceiling, { elevation: 2.2 })
  const before = room([mounted])
  const replacement = option(ceiling, { dimensions: [.8, .4, .8] })
  const valid = replaceItem(before, mounted.id, replacement, [...catalog, ceiling, replacement])
  assert.equal(valid.error, undefined)
  assert.equal(valid.scene.items[0].elevation, mounted.elevation)
  const tall = option(replacement, { dimensions: [.8, .8, .8] })
  const invalid = replaceItem(before, mounted.id, tall, [...catalog, ceiling, tall])
  assert.equal(invalid.scene, before)
  assert.ok(invalid.error)
})
