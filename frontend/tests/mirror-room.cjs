const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Scene, Mesh, BoxGeometry, MeshStandardMaterial } = require('three')
const { withMirrorRoom } = require('../src/mirrorRoom.ts')

for (const fails of [false, true]) test(`mirror pass restores cutaways and picking after ${fails ? 'render failure' : 'success'}`, () => {
  const scene = new Scene()
  const shell = [false, true, false, false, false].map(visible => {
    const material = new MeshStandardMaterial({ colorWrite: visible, depthWrite: visible })
    const mesh = new Mesh(new BoxGeometry(), material)
    mesh.userData.roomShell = true
    mesh.raycast = () => {}
    scene.add(mesh)
    return mesh
  })
  // Shared materials must be restored to the original state only once.
  const shared = new Mesh(new BoxGeometry(), [shell[0].material, shell[1].material])
  shared.userData.roomShell = true
  scene.add(shared)
  const mirrors = [true, true, false].map(visible => {
    const mesh = new Mesh()
    mesh.userData.mirrorSurface = true
    mesh.visible = visible
    scene.add(mesh)
    return mesh
  })
  const unrelated = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ colorWrite: false, depthWrite: true }))
  scene.add(unrelated)
  const before = shell.map(mesh => [mesh.material.colorWrite, mesh.material.depthWrite, mesh.raycast])
  const render = () => withMirrorRoom(scene, () => {
    shell.forEach(mesh => {
      assert.equal(mesh.material.colorWrite, true)
      assert.equal(mesh.material.depthWrite, true)
    })
    mirrors.forEach(mesh => assert.equal(mesh.visible, false))
    assert.equal(unrelated.material.colorWrite, false)
    assert.equal(unrelated.material.depthWrite, true)
    if (fails) throw new Error('render failed')
  })
  if (fails) assert.throws(render, /render failed/)
  else render()
  assert.deepEqual(shell.map(mesh => [mesh.material.colorWrite, mesh.material.depthWrite, mesh.raycast]), before)
  assert.deepEqual(mirrors.map(mesh => mesh.visible), [true, true, false])
})
