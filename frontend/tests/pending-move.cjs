const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
let saved, effect
require.extensions['.ts'] = (module, filename) => {
  const original = module.require.bind(module)
  module.require = id => id === 'react' ? {
    useState: () => [saved, value => { saved = value }],
    useEffect: fn => { effect = fn },
  } : original(id)
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
const { usePendingMove } = require('../src/usePendingMove.ts')
const { settleScene } = require('../src/placement.ts')
function setup() {
  saved = null
  const catalog = [
    { id: 'desk', name: 'Desk', dimensions: [1.4, .75, .8], placement: { mode: 'floor', canSupport: true } },
    { id: 'headphones', name: 'Headphones', dimensions: [.2, .29, .16], placement: { mode: 'surface', canSupport: false } },
  ]
  const scene = { width: 5, depth: 4, height: 2.6, revision: 1, items: [
    { id: 'desk', productId: 'desk', x: 0, z: 0, rotation: 0, elevation: 0, locked: false },
    { id: 'headphones', productId: 'headphones', x: 0, z: 0, rotation: 0, elevation: .75, supportId: 'desk', locked: false },
  ] }
  const preview = settleScene({ ...scene, items: scene.items.map(i => i.id === 'desk' ? { ...i, x: .5 } : i) }, scene, catalog)
  assert.equal(preview.error, undefined)
  const render = (current = scene, pending = false, connected = true) => {
    const result = usePendingMove(current, pending, connected)
    effect()
    return result
  }
  return { scene, preview: preview.scene, render }
}

test('the dropped desk and its headphones stay at their landing until server confirmation', () => {
  const { scene, preview, render } = setup()
  const original = JSON.stringify(scene)
  render().show(preview)
  for (let i = 0; i < 3; i++) {
    const visible = render(scene, true).scene
    assert.equal(visible.items[0].x, .5)
    assert.equal(visible.items[1].x, .5)
    assert.equal(visible.items[1].supportId, 'desk')
  }
  assert.equal(JSON.stringify(scene), original, 'The saved room is untouched while awaiting acknowledgment')
  const authoritative = { ...preview, revision: 2 }
  assert.equal(render(authoritative, true).scene, authoritative)
  assert.equal(render(authoritative, false).scene, authoritative)
})

test('rejection, disconnect and an intervening snapshot discard the pending drop', () => {
  for (const reason of ['rejected', 'disconnected', 'snapshot']) {
    const { scene, preview, render } = setup()
    render().show(preview)
    assert.equal(render(scene, true).scene, preview)
    const current = reason === 'snapshot' ? { ...scene, revision: 2 } : scene
    assert.equal(render(current, reason !== 'rejected', reason !== 'disconnected').scene, current)
    assert.equal(render(current, true).scene, current, 'A later command cannot revive the old preview')
  }
})
