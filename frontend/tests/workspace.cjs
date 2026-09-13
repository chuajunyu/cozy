const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Vector3, Matrix4 } = require('three')
const { fitZoom } = require('../src/cameraFit.ts')
const { escapeWorkspace } = require('../src/workspace.ts')
const { automaticRestore, readSavedRoom } = require('../src/recovery.ts')

test('room corners fit within a ten percent border in 3D and top views', () => {
  for (const [width, height, depth] of [[4, 2.6, 3.5], [8, 5, 3], [3, 2, 8]]) {
    for (const [pixelsWide, pixelsHigh] of [[1440, 700], [760, 650], [358, 220]]) {
      for (const top of [true, false]) {
        const zoom = fitZoom(width, height, depth, pixelsWide, pixelsHigh, top)
        const matrix = new Matrix4().lookAt(new Vector3(...(top ? [0, 12, .00001] : [8, 8, 8])), new Vector3(), new Vector3(0, 1, 0)).transpose()
        for (const x of [-width / 2, width / 2]) for (const y of [-height / 2, height / 2]) for (const z of [-depth / 2, depth / 2]) {
          const corner = new Vector3(x, y, z).applyMatrix4(matrix)
          assert.ok(Math.abs(corner.x * zoom) <= pixelsWide * .4 + .001)
          assert.ok(Math.abs(corner.y * zoom) <= pixelsHigh * .4 + .001)
        }
      }
    }
  }
})

test('Escape closes a task panel before clearing its selected piece', () => {
  const first = escapeWorkspace('details', 'sofa-1')
  assert.deepEqual(first, { panel: null, selected: 'sofa-1' })
  assert.deepEqual(escapeWorkspace(first.panel, first.selected), { panel: null, selected: null })
})

test('automatic recovery only applies a valid server preview and preserves required lock adjustments', () => {
  const preview = { previewId: 'preview-1', state: { slots: {} }, blockers: [], adjustments: [
    { slotId: 'bed', locked: true }, { slotId: 'lamp', locked: false }, { text: 'Updated daylight' },
  ] }
  assert.deepEqual(automaticRestore(preview), { type: 'session.restore', previewId: 'preview-1', allowLocked: ['bed'] })
  assert.equal(automaticRestore({ ...preview, state: null }), null)
  assert.equal(automaticRestore({ ...preview, blockers: ['Missing product'] }), null)
  assert.equal(preview.adjustments.length, 3)
})

test('saved rooms retain their full state for server validation; corrupt data is rejected', () => {
  const saved = { version: 3, state: { revision: 4, slots: { bed: { locked: true } } }, products: [] }
  const raw = JSON.stringify(saved)
  assert.deepEqual(readSavedRoom(raw, []), saved)
  assert.throws(() => readSavedRoom('{broken', []))
  assert.throws(() => readSavedRoom('{"version":1}', []))
})
