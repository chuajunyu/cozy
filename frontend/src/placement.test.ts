import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canSupportItems, liftToSupport, isAnchored, settleItem, settleScene } from '../tests/legacyCoordinates'
import type { Item, Product, Scene } from './catalog.ts'

const table: Product = {
  id: 'table', name: 'Table', category: 'Workspace', price: 50,
  dimensions: [1.4, 0.75, 0.8], parts: [],
  placement: { mode: 'floor', canSupport: true },
}
const lamp: Product = {
  id: 'lamp', name: 'Lamp', category: 'Lighting', price: 20,
  dimensions: [0.2, 0.4, 0.2], parts: [],
  lighting: { mount: 'surface', colorMode: 'fixed', dimmable: false, evidence: 'Test fixture' },
}
const chair: Product = {
  id: 'chair', name: 'Chair', category: 'Workspace', price: 40,
  dimensions: [0.5, 0.85, 0.5], parts: [],
}
const tray: Product = {
  id: 'tray', name: 'Stackable tray', category: 'Decor', price: 10,
  dimensions: [0.5, 0.1, 0.4], parts: [],
  placement: { mode: 'surface', canSupport: true },
}
const rug: Product = {
  id: 'rug', name: 'Rug', category: 'Decor', price: 20,
  dimensions: [2, 0.015, 2], parts: [],
  placement: { mode: 'floor', canSupport: true },
}
const fan: Product = {
  id: 'fan', name: 'Ceiling fan', category: 'Lighting', price: 80,
  dimensions: [1, 0.3, 1], parts: [],
  lighting: { mount: 'ceiling', colorMode: 'fixed', dimmable: false, evidence: 'Test fixture' },
}
const catalog = [table, lamp, chair, tray, rug, fan]
const item = (id: string, productId: string, changes: Partial<Item> = {}): Item => ({
  id, productId, x: 2, z: 2, rotation: 0, locked: false, ...changes,
})
const room = (items: Item[]): Scene => ({ width: 6, depth: 5, budget: 500, items })
const tabletop = item('table-1', 'table')
const tableLamp = item('lamp-1', 'lamp', { x: 2.3, elevation: 0.75, supportId: tabletop.id })

test('unsupported items fall to the floor and discard stale support links', () => {
  const floating = item('chair-1', 'chair', { elevation: 1.2, supportId: 'missing' })
  const landed = settleItem(floating, room([floating]), catalog)
  assert.equal(landed?.elevation, 0)
  assert.equal(landed?.supportId, undefined)
  assert.equal(floating.elevation, 1.2, 'Input is not mutated')
})

test('a table lamp lands on the highest fully containing support below it', () => {
  const upper = item('tray-1', 'tray', { elevation: 0.75 })
  const falling = item('lamp-1', 'lamp', { elevation: 1.8 })
  const landed = settleItem(falling, room([tabletop, upper, falling]), catalog)
  assert.equal(landed?.elevation, 0.85)
  assert.equal(landed?.supportId, upper.id)
})

test('a lamp cannot float over the floor when moved off a table', () => {
  const moved = { ...tableLamp, x: 4 }
  const landed = settleItem(moved, room([tabletop, moved]), catalog)
  assert.equal(landed?.elevation, 0)
  assert.equal(landed?.supportId, undefined)
})

test('partial overhang is rejected rather than dropping through a tabletop', () => {
  const partial = { ...tableLamp, x: 2.65, elevation: 1.4 }
  assert.equal(settleItem(partial, room([tabletop, partial]), catalog), null)
})

test('floor furniture cannot be stacked on a desk', () => {
  const stacked = item('chair-1', 'chair', { elevation: 1.3 })
  assert.equal(settleItem(stacked, room([tabletop, stacked]), catalog), null)
})

test('rugs are non-solid overlays and cannot supply elevated support', () => {
  const carpet = item('rug-1', 'rug')
  const falling = item('lamp-1', 'lamp', { elevation: 1 })
  const landed = settleItem(falling, room([carpet, falling]), catalog)
  assert.equal(canSupportItems(rug), false)
  assert.equal(landed?.elevation, 0)
  assert.equal(landed?.supportId, undefined)
})

test('Decor does not generally bypass collision checks', () => {
  const obstacle = item('tray-1', 'tray')
  const falling = item('lamp-1', 'lamp', { elevation: 1 })
  const landed = settleItem(falling, room([obstacle, falling]), catalog)
  assert.equal(landed?.elevation, 0.1)
  const overlapping = item('chair-1', 'chair')
  assert.equal(settleItem(overlapping, room([obstacle, overlapping]), catalog), null)
})

test('ceiling fixtures stay anchored but still respect room bounds and collisions', () => {
  const ceiling = item('fan-1', 'fan', { elevation: 2.35 })
  assert.equal(isAnchored(fan), true)
  assert.equal(settleItem(ceiling, room([ceiling]), catalog)?.elevation, 2.35)
  assert.equal(settleItem({ ...ceiling, elevation: 2.6 }, room([]), catalog), null)
  assert.equal(settleItem({ ...ceiling, x: 0.2 }, room([]), catalog), null)
  const second = { ...ceiling, id: 'fan-2' }
  assert.equal(settleItem(ceiling, room([ceiling, second]), catalog), null)
})

test('vertical sweep cannot pass through a non-supporting obstacle', () => {
  const suspended = item('fan-1', 'fan', { elevation: 1.4 })
  const falling = item('lamp-1', 'lamp', { elevation: 2.1 })
  assert.equal(settleItem(falling, room([suspended, falling]), catalog), null)
})

test('rotated containment uses the actual footprint rather than an axis-aligned shortcut', () => {
  const rotated = { ...tabletop, rotation: 45 }
  const centered = { ...tableLamp, x: 2, rotation: 45 }
  assert.equal(settleItem(centered, room([rotated, centered]), catalog)?.supportId, rotated.id)
  const outside = { ...centered, x: 2.35, z: 2.25 }
  assert.equal(settleItem(outside, room([rotated, outside]), catalog), null)
})

test('invalid and non-finite geometry is rejected', () => {
  for (const changes of [{ x: NaN }, { rotation: Infinity }, { elevation: -0.1 }, { z: -1 }]) {
    assert.equal(settleItem(item('lamp-1', 'lamp', changes), room([]), catalog), null)
  }
  assert.equal(settleItem(item('unknown', 'missing'), room([]), catalog), null)
  assert.equal(settleItem(item('lamp-1', 'lamp'), { ...room([]), width: NaN }, catalog), null)
})

test('moving and rotating a support carries its lamp using its local offset', () => {
  const previous = room([tabletop, tableLamp])
  const movedTable = { ...tabletop, x: 3, z: 3, rotation: 90 }
  const result = settleScene(room([movedTable, tableLamp]), previous, catalog)
  assert.equal(result.error, undefined)
  const carried = result.scene.items[1]
  assert.ok(Math.abs(carried.x - 3) < 1e-8)
  assert.ok(Math.abs(carried.z - 2.7) < 1e-8)
  assert.equal(carried.rotation, 90)
  assert.equal(carried.elevation, 0.75)
  assert.equal(carried.supportId, tabletop.id)
})

test('a legacy tabletop lamp gains a support link and follows its table', () => {
  const legacy = { ...tableLamp, supportId: undefined }
  const previous = room([tabletop, legacy])
  const result = settleScene(room([{ ...tabletop, x: 3 }, legacy]), previous, catalog)
  assert.equal(result.error, undefined)
  assert.equal(result.scene.items[1].x, 3.3)
  assert.equal(result.scene.items[1].supportId, tabletop.id)
})

test('carried item rotation wraps into the persisted 0–359 degree range', () => {
  const turnedTable = { ...tabletop, rotation: 270 }
  const turnedLamp = { ...tableLamp, x: 2, z: 2.3, rotation: 0 }
  const previous = room([turnedTable, turnedLamp])
  const result = settleScene(room([{ ...turnedTable, rotation: 0 }, turnedLamp]), previous, catalog)
  assert.equal(result.error, undefined)
  assert.equal(result.scene.items[1].rotation, 90)
})

test('removing a support drops its lamp onto the floor', () => {
  const previous = room([tabletop, tableLamp])
  const result = settleScene(room([tableLamp]), previous, catalog)
  assert.equal(result.error, undefined)
  assert.equal(result.scene.items[0].elevation, 0)
  assert.equal(result.scene.items[0].supportId, undefined)
})

test('stacked supports carry descendants recursively and settle after removal', () => {
  const upper = item('tray-1', 'tray', { elevation: 0.75, supportId: tabletop.id })
  const stackedLamp = item('lamp-1', 'lamp', { elevation: 0.85, supportId: upper.id })
  const previous = room([stackedLamp, upper, tabletop])
  const moved = settleScene(room([stackedLamp, upper, { ...tabletop, x: 3 }]), previous, catalog)
  assert.equal(moved.error, undefined)
  assert.equal(moved.scene.items[0].x, 3)
  assert.equal(moved.scene.items[0].elevation, 0.85)
  const removed = settleScene(room([stackedLamp, upper]), previous, catalog)
  assert.equal(removed.error, undefined)
  assert.equal(removed.scene.items[1].elevation, 0)
  assert.ok(Math.abs((removed.scene.items[0].elevation ?? -1) - 0.1) < 1e-8)
  assert.equal(removed.scene.items[0].supportId, upper.id)
})

test('a locked child prevents moving or deleting its support atomically', () => {
  const locked = { ...tableLamp, locked: true }
  const previous = room([tabletop, locked])
  for (const next of [room([{ ...tabletop, x: 3 }, locked]), room([locked])]) {
    const result = settleScene(next, previous, catalog)
    assert.equal(result.scene, previous)
    assert.match(result.error ?? '', /locked/i)
  }
})

test('moving a lamp explicitly detaches it instead of following a moved table', () => {
  const previous = room([tabletop, tableLamp])
  const result = settleScene(room([{ ...tabletop, x: 3 }, { ...tableLamp, x: 4 }]), previous, catalog)
  assert.equal(result.error, undefined)
  assert.equal(result.scene.items[1].x, 4)
  assert.equal(result.scene.items[1].elevation, 0)
})

test('invalid support moves roll back the whole arrangement', () => {
  const previous = room([tabletop, tableLamp])
  const result = settleScene(room([{ ...tabletop, x: 5.8 }, tableLamp]), previous, catalog)
  assert.equal(result.scene, previous)
  assert.ok(result.error)
})

test('legacy locked furniture requires an explicit server migration preview', () => {
  const legacy = room([item('chair-1', 'chair', { x: 4, elevation: 1, locked: true })])
  const normalized = settleScene(legacy, legacy, catalog)
  assert.match(normalized.error!, /locked/)
  assert.equal(normalized.scene.items[0].elevation, 1)
  assert.equal(normalized.scene.items[0].locked, true)
})

test('new linked stacks resolve independently of array order', () => {
  const upper = item('tray-1', 'tray', { elevation: 0.75, supportId: tabletop.id })
  const stacked = item('lamp-1', 'lamp', { elevation: 0.85, supportId: upper.id })
  const result = settleScene(room([stacked, upper, tabletop]), room([]), catalog)
  assert.equal(result.error, undefined)
  assert.equal(result.scene.items[0].supportId, upper.id)
})

test('duplicate IDs and explicit support cycles are rejected', () => {
  const previous = room([])
  assert.ok(settleScene(room([tabletop, tabletop]), previous, catalog).error)
  const a = item('a', 'tray', { x: 1, elevation: 1, supportId: 'b' })
  const b = item('b', 'tray', { x: 4, elevation: 1, supportId: 'a' })
  assert.match(settleScene(room([a, b]), previous, catalog).error ?? '', /loop/)
})

const bed: Product = {
  id: 'frame', name: 'Bed frame', category: 'Bedroom', price: 200,
  dimensions: [1.66, 1, 2.09], parts: [],
  placement: { mode: 'floor', support: { kind: 'mattress', width: 1.5, depth: 2, height: .27, center: [0, .01], evidence: 'Test deck' } },
}
const mattress: Product = {
  id: 'mattress', name: 'Mattress', category: 'Bedroom', price: 100,
  dimensions: [1.5, .24, 2], parts: [], placement: { mode: 'surface', surfaceKind: 'mattress' },
}
const beddingCatalog = [...catalog, bed, mattress]
const frame = item('frame-1', 'frame')
const bedding = item('mattress-1', 'mattress', { z: 2.01, elevation: .7 })

test('mattress lands on the internal deck, below the headboard', () => {
  const landed = settleItem(bedding, room([frame]), beddingCatalog)!
  assert.equal(landed.elevation, .27)
  assert.equal(landed.supportId, frame.id)
  const scene = room([frame, landed])
  assert.equal(settleScene(scene, scene, beddingCatalog).error, undefined)
})

test('mattress fit accepts smaller mattresses but excludes overhang, tables and unverified beds', () => {
  const smaller = settleItem(bedding, room([frame]), [...catalog, bed, { ...mattress, dimensions: [1.2, .24, 2] }])
  assert.equal(smaller?.supportId, frame.id)
  assert.equal(smaller?.elevation, .27)
  assert.equal(settleItem(bedding, room([frame]), [...catalog, bed, { ...mattress, dimensions: [1.8, .24, 2] }]), null)
  assert.equal(settleItem(bedding, room([frame]), [...catalog, bed, { ...mattress, dimensions: [1.5, .24, 2.1] }]), null)
  assert.equal(settleItem(bedding, room([frame]), [...catalog, { ...bed, placement: undefined }, mattress]), null)
  assert.equal(settleItem({ ...bedding, elevation: 1 }, room([item('wide-table', 'table')]), [...catalog.map(p => p.id === 'table' ? { ...p, dimensions: [2, .75, 2.4] as [number, number, number] } : p), mattress]), null)
})

test('bed and mattress move, rotate, persist, detach and reject locked support changes', () => {
  const landed = settleItem(bedding, room([frame]), beddingCatalog)!
  const before = room([frame, landed])
  const rotated = settleScene(room([{ ...frame, x: 3, rotation: 90 }, landed]), before, beddingCatalog)
  assert.equal(rotated.error, undefined)
  assert.equal(rotated.scene.items[1].rotation, 90)
  assert.ok(Math.abs(rotated.scene.items[1].x - 3.01) < 1e-8)
  const restored = JSON.parse(JSON.stringify(rotated.scene)) as Scene
  assert.equal(settleScene(restored, restored, beddingCatalog).error, undefined)
  const dropped = settleScene(room([landed]), before, beddingCatalog)
  assert.equal(dropped.error, undefined)
  assert.equal(dropped.scene.items[0].elevation, 0)
  const locked = room([frame, { ...landed, locked: true }])
  assert.match(settleScene(room([locked.items[1]]), locked, beddingCatalog).error!, /locked/)
})

test('occupied decks and overhangs reject a second mattress', () => {
  const landed = settleItem(bedding, room([frame]), beddingCatalog)!
  assert.equal(settleItem({ ...bedding, id: 'second' }, room([frame, landed]), beddingCatalog), null)
  assert.equal(settleItem({ ...bedding, x: 2.1 }, room([frame]), beddingCatalog), null)
  assert.equal(canSupportItems({ ...chair, name: 'Desk chair' }), false)
})

test('dragging a mattress near a matching deck aligns it and raises it for a visible fall', () => {
  const rotatedFrame = { ...frame, rotation: 90 }
  const preview = liftToSupport({ ...bedding, x: 2.15, elevation: 0 }, room([rotatedFrame]), beddingCatalog)
  assert.equal(preview.rotation, 90)
  assert.ok(Math.abs(preview.x - 2.01) < 1e-8)
  assert.equal(preview.elevation, .52)
  assert.equal(settleItem(preview, room([rotatedFrame]), beddingCatalog)?.elevation, .27)
})

test('a mattress aligns from the visible bed area beyond the former 30 cm centre target', () => {
  for (const [x, z] of [[2.55, 2.01], [2, 2.8], [2.25, 2.55]]) {
    const preview = liftToSupport({ ...bedding, x, z, elevation: 0 }, room([frame]), beddingCatalog)
    assert.equal(preview.x, frame.x)
    assert.equal(preview.z, 2.01)
    assert.equal(settleItem(preview, room([frame]), beddingCatalog)?.supportId, frame.id)
  }
  const away = { ...bedding, x: 3, z: 3.01, elevation: 0 }
  assert.equal(liftToSupport(away, room([frame]), beddingCatalog), away, 'A small corner overlap must not pull the mattress across the room')
})

test('mattress drag snapping respects rotated beds and occupied decks', () => {
  const rotatedFrame = { ...frame, rotation: 90 }
  const scene = room([rotatedFrame])
  const dragged = { ...bedding, x: 2.7, z: 2, elevation: 0 }
  const preview = liftToSupport(dragged, scene, beddingCatalog)
  assert.equal(preview.rotation, 90)
  const landed = settleItem(preview, scene, beddingCatalog)!
  assert.equal(landed.supportId, frame.id)
  const occupied = room([rotatedFrame, { ...landed, id: 'existing-mattress' }])
  assert.equal(liftToSupport(dragged, occupied, beddingCatalog), dragged, 'An occupied bed is not shown as an available snap target')
})

test('a smaller mattress centres on a larger deck without changing dimensions', () => {
  const smaller: Product = { ...mattress, dimensions: [1.2, .24, 1.9] }
  const products = [...catalog, bed, smaller]
  const source = { ...bedding, x: 2.55, z: 2.2, elevation: 0 }
  const preview = liftToSupport(source, room([frame]), products)
  const settled = settleItem(preview, room([frame]), products)!
  assert.equal(settled.supportId, frame.id)
  assert.equal(settled.x, 2)
  assert.equal(settled.z, 2.01)
  assert.deepEqual(smaller.dimensions, [1.2, .24, 1.9])
})

test('real IKEA MALM and mattress models attach through add, dropdown and dragging in every orientation', () => {
  type IkeaRecord = Product & { dimensionsMeters: { width: number; height: number; depth: number } }
  const data = JSON.parse(readFileSync(new URL('../../data/ikea-ready.json', import.meta.url), 'utf8')) as { products: IkeaRecord[] }
  const products: Product[] = data.products.map(value => ({ ...value, dimensions: [value.dimensionsMeters.width, value.dimensionsMeters.height, value.dimensionsMeters.depth], parts: [] }))
  const pairs = [
    ['ikea-00274924', 'ikea-20450643'],
    ['ikea-00274924', 'ikea-30450671'],
    ['ikea-20249486', 'ikea-10552114'],
    ['ikea-39199269', 'ikea-10552114'],
    ['ikea-00274924', 'ikea-10552114'],
    ['ikea-30249476', 'ikea-10552114'],
    ['ikea-30249476', 'ikea-20450643'],
    ['ikea-30249476', 'ikea-30450671'],
  ]
  for (const [bedId, mattressId] of pairs) for (const rotation of [0, 90, 180, 270]) {
    const bedProduct = products.find(value => value.id === bedId)!
    const mattressProduct = products.find(value => value.id === mattressId)!
    assert.ok(bedProduct && mattressProduct, 'Known complete model pair is still available')
    const bedItem = item('real-bed', bedId, { x: 3, z: 3, rotation })
    const scene = room([bedItem])
    const direct = item('real-mattress', mattressId, { x: 3, z: 3, rotation, elevation: bedProduct.placement!.support!.height })
    const settled = settleItem(direct, scene, products)!
    assert.equal(settled?.supportId, bedItem.id, `${bedId}/${mattressId} at ${rotation}°`)
    const added = settleScene({ ...scene, items: [...scene.items, settled] }, scene, products)
    assert.equal(added.error, undefined)
    const ground = { ...direct, x: 3.45, elevation: 0, rotation: 0 }
    const preview = liftToSupport(ground, scene, products)
    assert.equal(preview.rotation, rotation)
    assert.equal(settleItem(preview, scene, products)?.supportId, bedItem.id)
    assert.ok(mattressProduct.dimensions[0] <= bedProduct.placement!.support!.width)
  }
})
