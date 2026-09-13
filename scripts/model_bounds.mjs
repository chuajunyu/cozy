import fs from 'node:fs'
import { Object3D, Box3, Vector3, Matrix4 } from '../frontend/node_modules/three/build/three.module.js'

export function modelBounds(path) {
  const blob = fs.readFileSync(path)
  const doc = JSON.parse(blob.subarray(20, 20 + blob.readUInt32LE(12)).toString())
  const bounds = new Box3()
  function visit(id, parent) {
    const node = doc.nodes[id], obj = new Object3D()
    if (node.matrix) obj.matrix.fromArray(node.matrix)
    else {
      if (node.translation) obj.position.fromArray(node.translation)
      if (node.rotation) obj.quaternion.fromArray(node.rotation)
      if (node.scale) obj.scale.fromArray(node.scale)
      obj.updateMatrix()
    }
    const matrix = new Matrix4().multiplyMatrices(parent, obj.matrix)
    if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh].primitives) {
      const accessor = doc.accessors[primitive.attributes.POSITION]
      if (accessor.min && accessor.max) bounds.union(new Box3(new Vector3(...accessor.min), new Vector3(...accessor.max)).applyMatrix4(matrix))
    }
    for (const child of node.children ?? []) visit(child, matrix)
  }
  for (const node of doc.scenes[doc.scene ?? 0].nodes) visit(node, new Matrix4())
  return { size: bounds.getSize(new Vector3()).toArray(), min: bounds.min.toArray(), max: bounds.max.toArray() }
}

if (process.argv[2]) {
  const products = JSON.parse(fs.readFileSync('data/ikea-catalog.json')).products
  const report = Object.fromEntries(products.filter(p => p.modelUrl && fs.existsSync('frontend/public' + p.modelUrl))
    .map(p => [p.id, { name: p.name, ...modelBounds('frontend/public' + p.modelUrl) }]))
  fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2))
}
