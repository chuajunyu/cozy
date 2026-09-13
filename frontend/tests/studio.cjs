// Use the project's TypeScript compiler with Node's test runner; no browser globals.
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  module._compile(compiled.outputText, filename)
}
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Group, Mesh, BoxGeometry, MeshBasicMaterial, Box3, Vector3 } = require('three')
const { normalizeModel } = require('../src/model.ts')
const { migrateLegacy, makeBackup } = require('../src/backup.ts')
const { acceptSnapshot } = require('../src/snapshot.ts')
const { validPlacement, toStudioProduct, parseProduct } = require('../src/catalog.ts')
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('GLB instances sit on the floor and fit dimensions without mutating cached scene', () => {
  const source = new Group()
  source.position.set(1, 2, -3)
  source.scale.set(2, 3, 4)
  const mesh = new Mesh(new BoxGeometry(1, 2, 3), new MeshBasicMaterial())
  mesh.position.set(2, 3, 4)
  source.add(mesh)
  const first = normalizeModel(source, [1.2, .8, .6])
  const second = normalizeModel(source, [.5, 1, .5])
  const box = new Box3().setFromObject(first)
  const size = box.getSize(new Vector3())
  close(box.min.y, 0); close(box.getCenter(new Vector3()).x, 0); close(box.getCenter(new Vector3()).z, 0)
  close(size.x, 1.2); close(size.y, .8); close(size.z, .6)
  assert.notEqual(first.children[0], second.children[0])
  assert.deepEqual(source.position.toArray(), [1, 2, -3])
  assert.deepEqual(source.scale.toArray(), [2, 3, 4])
})

test('degenerate and non-finite GLB bounds cannot produce infinite transforms', () => {
  assert.throws(() => normalizeModel(new Group(), [1, 1, 1]))
  const source = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  assert.throws(() => normalizeModel(source, [NaN, 1, 1]))
})

const desk = { id: 'sample-desk', name: 'Desk', category: 'desk', collection: 'Workspace',
  price: 100, width: 1.2, height: .75, depth: .6, parts: [], readyForPreview: true }
const legacy = { scene: { width: 5, depth: 4.5, budget: 1500,
  items: [{ id: 'desk-1', productId: 'desk', x: 3.7, z: .55, rotation: 90, locked: true }] }, catalog: [] }

test('legacy migration preserves exact world position, rotation, and locks', () => {
  const backup = migrateLegacy(JSON.stringify(legacy), [desk])
  const slot = backup.state.slots['desk-1']
  close(slot.x, 1.2); close(slot.z, -1.7)
  assert.equal(slot.rotation, 90); assert.equal(slot.locked, true)
  assert.equal(slot.catalogId, 'sample-desk'); assert.equal(slot.category, 'desk')
})

test('unresolvable legacy products fail without silently dropping furniture', () => {
  assert.throws(() => migrateLegacy(JSON.stringify(legacy), []), /Missing saved product/)
  assert.throws(() => migrateLegacy('{broken', [desk]))
})

test('legacy custom categories agree with the server and duplicate item IDs fail', () => {
  const custom = { id: 'custom-coffee', name: 'Table', category: 'Tables', price: 20,
    dimensions: [1, .4, .5], parts: [] }
  const data = { ...legacy, catalog: [custom], scene: { ...legacy.scene,
    items: [{ ...legacy.scene.items[0], productId: custom.id }] } }
  assert.equal(migrateLegacy(JSON.stringify(data), []).state.slots['desk-1'].category, 'coffee_table')
  data.scene.items.push(data.scene.items[0])
  assert.throws(() => migrateLegacy(JSON.stringify(data), []), /Duplicate saved item/)
})

test('backups exclude computed fields and preserve approved custom geometry', () => {
  const saved = migrateLegacy(JSON.stringify(legacy), [desk])
  const state = { ...saved.state, total: 100, complete: true, validationIssues: [], undoCount: 3 }
  const backup = makeBackup(state, [{ ...desk, id: 'custom-desk' }])
  assert.equal(backup.state.total, undefined); assert.equal(backup.state.undoCount, undefined)
  assert.deepEqual(backup.products[0].dimensions, [1.2, .75, .6])
})

test('out-of-order snapshots never rewind a room', () => {
  const state = { revision: 4 }
  assert.equal(acceptSnapshot(state, { revision: 3 }), state)
  assert.equal(acceptSnapshot(state, { revision: 5 }).revision, 5)
  assert.equal(acceptSnapshot(null, state), state)
})

test('frontend placement uses center coordinates and height-aware footprints', () => {
  const p = toStudioProduct(desk)
  const item = { id: 'one', productId: p.id, x: 0, z: 0, rotation: 0, locked: false }
  const scene = { width: 4, depth: 3.5, height: 2.6, items: [item] }
  assert.equal(validPlacement({ ...item, x: -1.4 }, scene, [p]), true)
  assert.equal(validPlacement({ ...item, x: -1.5 }, scene, [p]), false)
  assert.equal(validPlacement({ ...item, id: 'two', elevation: .75 }, scene, [p]), true)
  assert.equal(validPlacement({ ...item, id: 'two', elevation: .7 }, scene, [p]), false)
})

test('generated geometry rejects executable model URLs and out-of-bounds parts', () => {
  const product = { id: 'box', name: 'Box', category: 'custom', price: 1, dimensions: [1, 1, 1],
    parts: [{ shape: 'box', size: [1, 1, 1], position: [0, .5, 0], color: '#abcdef' }] }
  assert.equal(parseProduct(product).id, 'box')
  assert.throws(() => parseProduct({ ...product, modelUrl: 'https://other.invalid/model.glb' }))
  assert.throws(() => parseProduct({ ...product, dimensions: [.1, .1, .1] }))
})
