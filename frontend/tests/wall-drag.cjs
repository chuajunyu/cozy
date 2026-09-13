const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Ray, Vector3 } = require('three')
const { anchorAtPoint, alongWall, wallPoint } = require('../src/wallDragGeometry.ts')
const { presetWindow, windowPresets } = require('../src/windowPresets.ts')
const { validWindows } = require('../src/sunlight.ts')
const scene = { width: 4, depth: 3.5, height: 2.6, items: [], windows: [], budget: 0 }
const anchor = { wall: 'north', offset: .5, width: 1, height: 1, center: 1.5, gap: .2 }

test('wall dragging preserves the grab offset and clamps horizontal and vertical bounds', () => {
  const placed = anchorAtPoint(anchor, new Vector3(.5, 1.8, -1.75), 'north', scene, { along: .5, up: .3 })
  assert.equal(placed.offset, .5)
  assert.equal(placed.center, 1.5)
  const edge = anchorAtPoint(anchor, new Vector3(30, 40, 0), 'north', scene, { along: 0, up: 0 })
  assert.equal(edge.offset, 1)
  assert.equal(edge.center, 2)
  const low = anchorAtPoint(anchor, new Vector3(-30, -40, 0), 'north', scene, { along: 0, up: 0 })
  assert.equal(low.offset, 0)
  assert.equal(low.center, .55)
})
test('doors remain on the floor and every wall uses one consistent offset orientation', () => {
  assert.equal(anchorAtPoint({ ...anchor, fixedFloor: true, height: 2.1 }, new Vector3(0, 9, 0), 'west', scene, { along: 0, up: 0 }).center, 1.05)
  assert.equal(alongWall(new Vector3(1, 0, 0), 'south', scene), 3)
  assert.equal(alongWall(new Vector3(0, 0, 1), 'west', scene), .75)
  const left = anchorAtPoint({ ...anchor, wall: 'south' }, new Vector3(-1, 1.5, scene.depth / 2), 'south', scene, { along: 0, up: 0 })
  const right = anchorAtPoint({ ...anchor, wall: 'south' }, new Vector3(1, 1.5, scene.depth / 2), 'south', scene, { along: 0, up: 0 })
  assert.ok(left.offset < right.offset)
})
test('drag projections stay on the wall and can cross corners or move walls in top view', () => {
  const previous = new Vector3(0, 1.5, -1.75)
  const ray = new Ray(new Vector3(0, 2, 0), new Vector3(3, -1, -1.75).normalize())
  const next = wallPoint(ray, 'north', scene, previous, false)
  assert.equal(next.wall, 'east')
  assert.equal(next.point.x, 2)
  const top = wallPoint(new Ray(new Vector3(-1.9, 10, 0), new Vector3(0, -1, 0)), 'north', scene, previous, true)
  assert.equal(top.wall, 'west')
  assert.equal(top.point.y, previous.y)
  assert.equal(wallPoint(new Ray(new Vector3(0, 2, 0), new Vector3(0, 1, 0)), 'north', scene, previous, false), null)
})
test('all window styles fit every wall and floor-to-ceiling presets keep frame clearance', () => {
  for (const height of [2, 2.6, 5]) for (const wall of ['north', 'east', 'south', 'west']) for (const p of windowPresets) {
    const room = { ...scene, width: 2, depth: 3, height }
    const window = presetWindow(p.id, room, wall)
    assert.ok(validWindows([window], room), `${p.id} ${wall} ${height}`)
    if (p.id === 'full' || p.id === 'panoramic') {
      assert.equal(window.sill, .05)
      assert.ok(Math.abs(window.height + window.sill - (height - .1)) < .000001)
    }
  }
})


test('dragging a full-height window retains the exact sill clearance', () => {
  const window = presetWindow('full', scene, 'north')
  const next = anchorAtPoint({ ...window, center: window.sill + window.height / 2, gap: .2 }, new Vector3(.4, 3, -1.75), 'north', scene, { along: 0, up: 0 })
  const moved = { ...window, offset: next.offset, sill: Math.round((next.center - window.height / 2) * 100) / 100 }
  assert.equal(moved.sill, .05)
  assert.ok(validWindows([moved], scene))
})
