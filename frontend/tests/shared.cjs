const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const assert = require('node:assert/strict')
const {test} = require('node:test')
const fixtures = require('../../data/placement-fixtures.json')
const {settleScene} = require('../src/placement.ts')
for (const scenario of fixtures.cases) test(`shared: ${scenario.name}`, () => {
  const before = { ...fixtures.room, ...scenario.room, budget:0, items:scenario.before.map(i => ({rotation:0,elevation:0,locked:false,...i})) }
  const next = { ...before, items:[...before.items.filter(i => !scenario.remove?.includes(i.id)).map(i => ({...i,...scenario.changes?.[i.id]})), ...(scenario.add ?? []).map(i => ({rotation:0,elevation:0,locked:false,...i}))] }
  const saved = JSON.stringify(before)
  const result = settleScene(next,before,fixtures.products)
  if (scenario.invalid) { assert.ok(result.error); assert.equal(result.scene,before) }
  else { assert.equal(result.error,undefined); for (const [id, expected] of Object.entries(scenario.expected)) { const i = result.scene.items.find(i => i.id===id); [i.x,i.z,i.elevation,i.rotation].forEach((v,n) => assert.ok(Math.abs(v-expected[n])<1e-7)) } }
  assert.equal(JSON.stringify(before),saved)
})
