import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterProducts, initialCatalog, parseProduct, validPlacement } from '../tests/legacyCoordinates'
import type { Item, Product, Scene } from './catalog.ts'
import { doorClearance, doorGeometry, doorOpenings, normalizeDoor, validDoorAnchor, validDoors, isAnchored, settleItem, settleScene, validItemGeometry } from '../tests/legacyCoordinates'
import type { Wall } from './sunlight.ts'

const product = initialCatalog.find(value => value.id === 'room-door')!
const chair = initialCatalog.find(value => value.id === 'chair')!
const rug = initialCatalog.find(value => value.id === 'rug')!
const catalog = [product, chair, rug]
const empty: Scene = { width: 5, depth: 4, budget: 1000, windows: [], items: [] }
const makeDoor = (wall: Wall = 'north', offset = .5, scene = empty, changes: Partial<Item> = {}): Item => normalizeDoor({ id: 'door-1', productId: product.id, x: 0, z: 0, rotation: 0, locked: false, door: { wall, offset, open: false }, ...changes }, product, scene)
const makeChair = (x: number, z: number, changes: Partial<Item> = {}): Item => ({ id: 'chair-1', productId: chair.id, x, z, rotation: 0, locked: false, ...changes })

test('built-in door metadata survives validated JSON persistence', () => {
  const parsed = parseProduct(JSON.parse(JSON.stringify(product)))
  assert.deepEqual(parsed.door, { kind: 'solid' })
  assert.equal(parsed.placement?.mode, 'wall')
  assert.equal(parsed.price, 0)
  assert.ok(parsed.priceNote?.includes('price not included'))
  assert.equal(isAnchored(parsed), true)
})

test('wall capabilities reject invalid or unsupported imported door metadata', () => {
  for (const changes of [
    { door: null }, { door: { kind: 'glass' } }, { door: undefined },
    { placement: { mode: 'floor' } },
    { dimensions: [.9, 2.6, .045] },
    { placement: { mode: 'wall', canSupport: true } },
  ]) assert.throws(() => parseProduct({ ...product, ...changes }))
})

test('room elements have their own collection and do not appear as samples', () => {
  const filters = { source: 'Room elements', query: '', category: 'All', color: 'All', feature: 'All', maxPrice: '', productType: 'All' }
  assert.deepEqual(filterProducts(catalog, filters).map(value => value.id), [product.id])
  assert.equal(filterProducts(catalog, { ...filters, source: 'Samples' }).some(value => value.id === product.id), false)
})

test('all wall anchors share window offsets and normalize to floor-level boundaries', () => {
  const expected = { north: [2.5, 0, 0], east: [5, 2, 90], south: [2.5, 4, 0], west: [0, 2, 90] }
  for (const wall of ['north', 'east', 'south', 'west'] as Wall[]) {
    const item = makeDoor(wall)
    assert.deepEqual([item.x, item.z, item.rotation], expected[wall])
    assert.equal(item.elevation, 0)
    assert.equal(validDoorAnchor(item, product, empty), true)
    assert.equal(validItemGeometry(item, product, empty), true)
    assert.equal(doorGeometry(item, product, empty).width, .9)
  }
})

test('east and west offsets run from south to north with fixed product dimensions', () => {
  for (const wall of ['east', 'west'] as Wall[]) {
    const first = makeDoor(wall, 0)
    const last = makeDoor(wall, 1)
    assert.ok(first.z > last.z)
    assert.equal(doorGeometry(first, product, empty).start, .2)
    assert.ok(Math.abs(doorGeometry(last, product, empty).end - 3.8) < 1e-8)
  }
})

test('malformed anchors and noncanonical stored door transforms are rejected', () => {
  const door = makeDoor()
  for (const changes of [
    { door: undefined }, { door: { wall: 'ceiling', offset: .5, open: false } },
    { door: { wall: 'north', offset: NaN, open: false } },
    { door: { wall: 'north', offset: 1.01, open: false } },
    { door: { wall: 'north', offset: .5, open: 1 } },
    { x: door.x + .1 }, { rotation: 90 }, { elevation: .2 }, { supportId: 'table-1' },
  ]) assert.equal(validItemGeometry({ ...door, ...changes } as Item, product, empty), false)
  assert.equal(validItemGeometry({ ...makeChair(2, 2), door: door.door }, chair, empty), false)
  assert.equal(validDoors({ ...empty, items: [{ ...makeChair(2, 2), door: door.door }] }, catalog), false)
})

test('doors cannot shrink their leaf to fit a wall or exceed room height', () => {
  const smallRoom = { ...empty, width: 1.2 }
  assert.equal(validDoorAnchor(makeDoor('north', .5, smallRoom), product, smallRoom), false)
  assert.equal(validDoorAnchor(makeDoor(), { ...product, dimensions: [.9, 2.6, .045] }, empty), false)
})

test('only open doors contribute floor-level daylight openings', () => {
  const closed = makeDoor()
  assert.deepEqual(doorOpenings({ ...empty, items: [closed] }, catalog), [])
  const open = { ...closed, door: { ...closed.door!, open: true } }
  assert.deepEqual(doorOpenings({ ...empty, items: [open] }, catalog), [{ wall: 'north', offset: .5, width: .9, height: 2.1, sill: 0 }])
})

test('door and window openings cannot overlap or crowd their frames', () => {
  const scene: Scene = { ...empty, windows: [{ wall: 'north', offset: .5, width: 1, height: 1, sill: 1 }], items: [makeDoor()] }
  assert.equal(validDoors(scene, catalog), false)
  assert.equal(validDoors({ ...scene, items: [makeDoor('north', 0)] }, catalog), true)
  assert.equal(validDoors({ ...scene, items: [makeDoor('south')] }, catalog), true)
  assert.equal(validDoors({ ...empty, items: [makeDoor('east')] }, catalog), true)
  assert.equal(validDoors({ ...empty, windows: undefined, items: [makeDoor('east')] }, catalog), false, 'Legacy default window is retained')
})

test('multiple doors need distinct apertures and nonintersecting swing areas', () => {
  const first = makeDoor('north', 0)
  const duplicate = { ...first, id: 'door-2' }
  assert.equal(validDoors({ ...empty, items: [first, duplicate] }, catalog), false)
  const separated = makeDoor('north', 1, empty, { id: 'door-2' })
  assert.equal(validDoors({ ...empty, items: [first, separated] }, catalog), true)
  const nearCorner = makeDoor('west', 1, empty, { id: 'door-2' })
  assert.equal(validDoors({ ...empty, items: [first, nearCorner] }, catalog), false)
})

test('each door reserves the inward swing on its own wall', () => {
  for (const wall of ['north', 'east', 'south', 'west'] as Wall[]) {
    const door = makeDoor(wall)
    const clearance = doorClearance(door, product, empty)
    const obstacle = makeChair((clearance.minX + clearance.maxX) / 2, (clearance.minZ + clearance.maxZ) / 2)
    const scene = { ...empty, items: [door, obstacle] }
    assert.equal(validDoors(scene, catalog), false, wall)
    assert.equal(settleItem(obstacle, scene, catalog), null, wall)
    assert.equal(validPlacement(obstacle, scene, catalog), false, wall)
  }
})

test('rugs and fixtures above the door do not block its swing', () => {
  const door = makeDoor()
  const carpet = makeChair(2.5, .6, { productId: rug.id })
  assert.equal(validDoors({ ...empty, items: [door, carpet] }, catalog), true)
  const fan: Product = { ...chair, id: 'fan', name: 'Ceiling fan', dimensions: [.5, .3, .5], placement: { mode: 'ceiling' } }
  const fitting = makeChair(2.5, .5, { productId: fan.id, elevation: 2.35 })
  assert.equal(validDoors({ ...empty, items: [door, fitting] }, [...catalog, fan]), true)
})

test('closed and open doors protect identical clearances', () => {
  const door = makeDoor()
  const obstacle = makeChair(2.5, .5)
  for (const open of [false, true]) {
    assert.equal(validDoors({ ...empty, items: [{ ...door, door: { ...door.door!, open } }, obstacle] }, catalog), false)
  }
})

test('rotated furniture respects the full swing while nearby clear furniture fits', () => {
  const door = makeDoor()
  const obstacle = makeChair(3.1, .7, { rotation: 45 })
  assert.equal(validDoors({ ...empty, items: [door, obstacle] }, catalog), false)
  assert.equal(validDoors({ ...empty, items: [door, { ...obstacle, x: 3.5 }] }, catalog), true)
})

test('anchored doors normalize on resize and stay out of furniture gravity', () => {
  const door = makeDoor('east', .25)
  const previous = { ...empty, items: [door] }
  const result = settleScene({ ...previous, width: 6, depth: 5 }, previous, catalog)
  assert.equal(result.error, undefined)
  assert.equal(result.scene.items[0].x, 6)
  assert.ok(result.scene.items[0].z > door.z)
  assert.equal(result.scene.items[0].door?.offset, .25)
  assert.equal(result.scene.items[0].elevation, 0)
  assert.equal(result.scene.items[0].supportId, undefined)
  assert.equal(validPlacement(door, previous, catalog), true)
})

test('locked doors reject movement and resizing but still open and close', () => {
  const door = makeDoor('east', .5, empty, { locked: true })
  const previous = { ...empty, items: [door] }
  const resized = settleScene({ ...previous, width: 6 }, previous, catalog)
  assert.equal(resized.scene, previous)
  assert.match(resized.error!, /locked/)
  const moved = settleScene({ ...previous, items: [{ ...door, door: { ...door.door!, offset: .7 } }] }, previous, catalog)
  assert.equal(moved.scene, previous)
  assert.match(moved.error!, /locked/)
  const opened = settleScene({ ...previous, items: [{ ...door, door: { ...door.door!, open: true } }] }, previous, catalog)
  assert.equal(opened.error, undefined)
  assert.equal(opened.scene.items[0].door?.open, true)
  const removed = settleScene({ ...previous, items: [] }, previous, catalog)
  assert.equal(removed.scene, previous)
  assert.match(removed.error!, /locked/)
})

test('room edits reject window overlap and furniture blocking doors atomically', () => {
  const door = makeDoor()
  const previous = { ...empty, items: [door] }
  const blocked = settleScene({ ...previous, items: [makeChair(2.5, .5), door] }, previous, catalog)
  assert.equal(blocked.scene, previous)
  assert.ok(blocked.error)
  const window = settleScene({ ...previous, windows: [{ wall: 'north', offset: .5, width: 1, height: 1.4, sill: .9 }] }, previous, catalog)
  assert.equal(window.scene, previous)
  assert.ok(window.error)
})

test('resizing cannot compress a door into the neighboring window', () => {
  const previous: Scene = { ...empty, windows: [{ wall: 'north', offset: 1, width: 1.8, height: 1.4, sill: .9 }], items: [makeDoor('north', 0)] }
  assert.equal(validDoors(previous, catalog), true)
  const resized = settleScene({ ...previous, width: 3 }, previous, catalog)
  assert.equal(resized.scene, previous)
  assert.ok(resized.error)
})

test('objects cannot fall from above a door into its swing area', () => {
  const object: Product = { ...chair, id: 'small-object', dimensions: [.2, .2, .2], placement: { mode: 'surface' } }
  const falling = makeChair(2.5, .5, { productId: object.id, elevation: 2.4 })
  const scene = { ...empty, items: [makeDoor(), falling] }
  assert.equal(validDoors(scene, [...catalog, object]), true, 'The initial height clears the door')
  assert.equal(settleItem(falling, scene, [...catalog, object]), null, 'The floor landing would block the swing')
})
