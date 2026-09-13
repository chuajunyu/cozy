const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { lightingDraft } = require('../src/LightingPresets.tsx')
const { fixtureOutput, fixtureColor, validBulbSettings } = require('../src/lighting.ts')

test('preset previews preserve their source and resolve bulbs by capability', () => {
  const catalog = ['fixed', 'white-spectrum', 'rgb', 'bulb-dependent'].map((mode, id) => ({ id: String(id), lighting: { mount: 'surface', colorMode: mode, output: { lumens: 700, evidence: 'Fixture' } } }))
  const scene = { revision: 3, sunHour: 9, items: catalog.map(p => ({ id: p.id, productId: p.id, locked: true })) }
  const before = JSON.stringify(scene)
  const draft = lightingDraft(scene, catalog, 'focus')
  assert.equal(JSON.stringify(scene), before)
  assert.equal(draft.revision, 3)
  assert.equal(draft.sunHour, 10)
  assert.equal(draft.fixtures['0'].color, '#ffd3a0')
  assert.equal(draft.fixtures['1'].bulbProfile, null)
  assert.equal(draft.fixtures['3'].bulbProfile, 'neutral')
  assert.equal(fixtureOutput(catalog[3], draft.fixtures['3']).lumens, 470)
  assert.equal(fixtureOutput(catalog[1], draft.fixtures['1']).lumens, 700)
  assert.equal(fixtureColor(catalog[3], draft.fixtures['3']), '#dceaff')
  assert.equal(validBulbSettings(catalog[0], draft.fixtures['3']), false)
  assert.equal(validBulbSettings(catalog[3], { ...draft.fixtures['3'], color: '#ff0000' }), false)
})

test('daytime turns fixtures off without losing the bulb and empty rooms still preview', () => {
  const catalog = [{ id: 'lamp', lighting: { mount: 'ceiling', colorMode: 'bulb-dependent' } }]
  const scene = { items: [{ id: 'lamp', productId: 'lamp', light: { on: true, brightness: .7, color: '#ffd3a0', bulbProfile: 'warm' } }] }
  const draft = lightingDraft(scene, catalog, 'daytime')
  assert.equal(draft.fixtures.lamp.on, false)
  assert.equal(draft.fixtures.lamp.bulbProfile, 'warm')
  assert.equal(fixtureOutput(catalog[0], draft.fixtures.lamp).lumens, 1055)
  assert.deepEqual(lightingDraft({ items: [] }, [], 'cozy').fixtures, {})
})
