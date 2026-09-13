const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseProduct, filterProducts } = require('../src/catalog.ts')
const { normalizeWallFixture } = require('../src/wallFixtures.ts')
const { settleScene } = require('../src/placement.ts')
const data = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../../data/unbranded.json'), 'utf8'))
const products = data.map(p => parseProduct({ ...p, id: `sample-${p.id}` }))
const scene = { width: 5, depth: 4, height: 2.6, budget: 1000, windows: [], items: [] }

test('flower stems attach inside a vase and follow it without requiring foliage to fit the rim', () => {
  const vase = { ...products[0], id:'test-vase', dimensions:[.12,.2,.12], lighting:undefined,
    placement:{mode:'surface',canSupport:false,support:{kind:'bouquet',width:.035,depth:.035,height:.11,center:[0,0],evidence:'Approximate insertion'}} }
  const flowers = products.find(p => p.id === 'sample-meadow-bouquet')
  const catalog = [vase,flowers]
  const parent = {id:'vase',productId:vase.id,x:0,z:0,rotation:0,locked:false,elevation:0}
  const child = {id:'flowers',productId:flowers.id,x:0,z:0,rotation:0,locked:false,elevation:.11,supportId:'vase'}
  const before = {...scene,items:[parent,child]}
  const result = settleScene({...before,items:[{...parent,x:.5},child]},before,catalog)
  assert.equal(result.error,undefined)
  assert.equal(result.scene.items.find(i => i.id === 'flowers').x,.5)
  assert.equal(result.scene.items.find(i => i.id === 'flowers').supportId,'vase')
  assert.ok(settleScene({...before,wallpapers:{north:'invalid'}},before,catalog).error)
})

test('every new prop parses, fits its bounds and places in an empty room', () => {
  for (const p of products) {
    let item = { id: 'prop', productId: p.id, x: 0, z: 0, rotation: 0, locked: false }
    if (p.placement.mode === 'wall') item = normalizeWallFixture({ ...item, wallMount: { wall: 'north', offset: .5, height: 1.6 } }, p, scene)
    assert.equal(settleScene({ ...scene, items: [item] }, scene, [p]).error, undefined, p.name)
  }
})

test('sources separate references, unbranded, IKEA and room elements; search includes collection', () => {
  const p = products[0]
  const catalog = [...products, { ...p, id: 'reference-desk', brand: 'Omnidesk' }, { ...p, id: 'ikea-12345678', readyForPreview: true }, { ...p, id: 'ikea-87654321', readyForPreview: false }]
  const filter = { source: 'Unbranded', query: '', category: 'All', color: 'All', feature: 'All', maxPrice: '', productType: 'All' }
  assert.equal(filterProducts(catalog, filter).length, products.length)
  assert.equal(filterProducts(catalog, { ...filter, source: 'Brand references', query: 'Omnidesk' }).length, 1)
  assert.equal(filterProducts(catalog, { ...filter, source: 'IKEA' }).length, 1)
  assert.ok(filterProducts(catalog, { ...filter, query: 'electronics' }).length >= 10)
  assert.equal(filterProducts(catalog, { ...filter, category: 'Wall art' }).length, 6)
})

test('non-light wall art mounts on every wall, rejects openings and survives serialization', () => {
  const p = products.find(p => p.id === 'sample-poster-space')
  for (const wall of ['north', 'east', 'south', 'west']) {
    const item = normalizeWallFixture({ id: 'art', productId: p.id, x: 0, z: 0, rotation: 0, locked: false, wallMount: { wall, offset: .5, height: 1.6 } }, p, scene)
    const next = { ...scene, items: [item] }
    assert.equal(settleScene(JSON.parse(JSON.stringify(next)), scene, [p]).error, undefined)
    assert.ok(settleScene({ ...next, windows: [{ wall, offset: .5, width: 1.2, height: 1, sill: 1.1 }] }, scene, [p]).error)
    assert.equal(item.light, undefined)
  }
})
