import { floorColor, defaultFloorColor, validPaintColor } from './roomFinishes.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialCatalog, parseProduct } from './catalog.ts'
import type { Item, Product, Scene } from './catalog.ts'
import { normalizeDoor } from './doors.ts'
import { settleScene, validItemGeometry } from './placement.ts'
import { defaultWallColors, paintReflectance, validWallColors, wallColor } from './roomFinishes.ts'
import { normalizeWallFixture } from './wallFixtures.ts'
import { walls, type Wall } from './sunlight.ts'

// Synthetic geometry is confined to collision tests; the UI uses real IKEA assets.
const lamp: Product = { id: 'test-wall-lamp', name: 'Test lamp', category: 'Lighting', price: 1, dimensions: [.24, .32, .16], parts: [{ shape: 'box', size: [.24, .32, .16], position: [0, .16, 0], color: '#ffffff' }], placement: { mode: 'wall', canSupport: false }, lighting: { mount: 'wall', colorMode: 'rgb', dimmable: false, evidence: 'Test fixture' } }
const door = initialCatalog.find(p => p.id === 'sample-room-door')!
const shelf = initialCatalog.find(p => p.id === 'sample-shelf')!
const scene: Scene = { width: 5, depth: 4, height: 2.7, budget: 1000, windows: [], items: [] }
const makeLamp = (wall: Wall = 'north', offset = .5, height = 1.7): Item => normalizeWallFixture({
  id: 'light', productId: lamp.id, x: 0, z: 0, rotation: 0, locked: false,
  wallMount: { wall, offset, height }, light: { on: true, brightness: .7, color: '#ffd3a0' },
}, lamp, scene)

test('wall fixtures stay flush and face inward on all four walls', () => {
  const expected = { north: [0, -1.92, 0], west: [-2.42, 0, 90], south: [0, 1.92, 180], east: [2.42, 0, 270] }
  for (const wall of walls) {
    const item = makeLamp(wall)
    assert.deepEqual([item.x, item.z, item.rotation], expected[wall])
    assert.equal(item.elevation, 1.54)
    assert.equal(validItemGeometry(item, lamp, scene), true)
    assert.equal(settleScene({ ...scene, items: [item] }, scene, [lamp]).error, undefined)
  }
})

test('missing, invalid, detached and out-of-height wall mounts reject', () => {
  const item = makeLamp()
  for (const change of [
    { wallMount: undefined }, { wallMount: { wall: 'north', offset: 2, height: 1.7 } },
    { wallMount: { wall: 'north', offset: .5, height: NaN } },
    { wallMount: { wall: 'north', offset: .5, height: 2.7 } },
    { x: 3 }, { rotation: 90 }, { supportId: 'table' },
  ]) assert.equal(validItemGeometry({ ...item, ...change } as Item, lamp, scene), false)
  assert.equal(validItemGeometry({ ...item, productId: shelf.id }, shelf, scene), false)
})

test('window moves and lights in apertures reject while lights above an opening fit', () => {
  const window = { wall: 'north' as const, offset: .5, width: 1.8, height: 1.4, sill: .9 }
  const item = makeLamp()
  assert.ok(settleScene({ ...scene, windows: [window], items: [item] }, scene, [lamp]).error)
  assert.equal(settleScene({ ...scene, windows: [window], items: [makeLamp('north', .1)] }, scene, [lamp]).error, undefined)
  assert.equal(settleScene({ ...scene, windows: [{ ...window, height: .8 }], items: [makeLamp('north', .5, 2.35)] }, scene, [lamp]).error, undefined)
})

test('doors cannot occupy fixture footprints and above-door lights respect clearance', () => {
  const entry = normalizeDoor({ id: 'door', productId: door.id, x: 0, z: 0, rotation: 0, locked: false, door: { wall: 'north', offset: .5, open: false } }, door, scene)
  for (const items of [[entry, makeLamp()], [makeLamp(), entry]])
    assert.ok(settleScene({ ...scene, items }, scene, [lamp, door]).error)
  assert.equal(settleScene({ ...scene, items: [entry, makeLamp('north', .5, 2.4)] }, scene, [lamp, door]).error, undefined)
})

test('fixture collisions and tall furniture reject regardless of resolution order', () => {
  const item = makeLamp('north', .5, 1.3)
  const obstacle: Item = { id: 'shelf', productId: shelf.id, x: 0, z: -2 + shelf.dimensions[2] / 2, rotation: 0, locked: false }
  for (const items of [[item, obstacle], [obstacle, item], [item, { ...item, id: 'second' }]])
    assert.ok(settleScene({ ...scene, items }, scene, [lamp, shelf]).error)
})

test('room resizing remounts fixtures but cannot move or delete a locked fixture', () => {
  const item = makeLamp('east')
  const previous = { ...scene, items: [item] }
  const resized = settleScene({ ...previous, width: 6 }, previous, [lamp])
  assert.equal(resized.error, undefined)
  assert.equal(resized.scene.items[0].x, 2.92)
  const locked = { ...previous, items: [{ ...item, locked: true }] }
  assert.ok(settleScene({ ...locked, width: 6 }, locked, [lamp]).error)
  assert.ok(settleScene({ ...locked, items: [] }, locked, [lamp]).error)
  assert.ok(settleScene({ ...locked, items: [{ ...locked.items[0], wallMount: { ...item.wallMount!, height: 2 } }] }, locked, [lamp]).error)
  assert.equal(settleScene({ ...locked, items: [{ ...locked.items[0], light: { ...item.light!, on: false, color: '#ff92cd' } }] }, locked, [lamp]).error, undefined)
})

test('wall paint and mounts survive serialization without changing placement', () => {
  const painted: Scene = { ...scene, wallColors: { north: '#be7967' }, items: [makeLamp()] }
  const saved = JSON.parse(JSON.stringify({ scene: painted, catalog: [lamp] }))
  const restored = settleScene(saved.scene, saved.scene, saved.catalog.map(parseProduct))
  assert.equal(restored.error, undefined)
  assert.deepEqual(restored.scene, painted)
  assert.equal(wallColor(scene, 'west'), defaultWallColors.west)
  assert.equal(wallColor(painted, 'east'), defaultWallColors.east)
})

test('paint validation and linear conversion reject malformed input and preserve defaults', () => {
  for (const value of [null, [], '#ffffff', { north: 'red' }, { roof: '#ffffff' }, { north: '#fff' }]) assert.equal(validWallColors(value), false)
  assert.equal(validWallColors({ west: '#Aa99Ff' }), true)
  assert.deepEqual(paintReflectance('#000000'), [0, 0, 0])
  assert.deepEqual(paintReflectance('#ffffff'), [.9, .9, .9])
  assert.ok(Math.abs(paintReflectance('#808080')[0] - .21586) < .00001)
  assert.ok(settleScene({ ...scene, wallColors: { north: 'red' } }, scene, [lamp]).error)
})

test('imported wall lights require consistent placement and cannot support furniture', () => {
  assert.deepEqual(parseProduct(lamp), lamp)
  for (const change of [{ placement: { mode: 'floor' } }, { placement: { mode: 'wall', canSupport: true } }, { lighting: { ...lamp.lighting, mount: 'floor' } }])
    assert.throws(() => parseProduct({ ...lamp, ...change }))
})


test('floor finish survives settling and uses safe defaults for old rooms', () => {
  assert.equal(floorColor(scene), defaultFloorColor)
  const painted = { ...scene, floorColor: '#79553e', wallColors: { north: '#be7967' } }
  const restored = settleScene(JSON.parse(JSON.stringify(painted)), scene, [lamp])
  assert.equal(restored.error, undefined)
  assert.equal(floorColor(restored.scene), '#79553e')
  assert.equal(restored.scene.wallColors?.north, '#be7967')
  for (const color of ['red', '#fff', null, 42]) assert.equal(validPaintColor(color), false)
  assert.ok(settleScene({ ...scene, floorColor: 'red' }, scene, [lamp]).error)
  const walnut = paintReflectance(floorColor(painted))
  assert.ok(walnut[0] > walnut[1] && walnut[1] > walnut[2])
})


test('server null wall anchors do not block ordinary furniture', () => {
  const ordinary: Product = { ...lamp, id: 'ordinary', lighting: undefined, placement: { mode: 'floor' } }
  const item = { id: 'ordinary', productId: ordinary.id, x: 0, z: 0, rotation: 0, locked: false, wallMount: null }
  const next = { ...scene, items: [item as unknown as Item] }
  assert.equal(settleScene(next, scene, [ordinary]).error, undefined)
})
