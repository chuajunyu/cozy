import { Box3, Group, Object3D, Vector3 } from 'three'

/** Clone without altering cached geometry/materials; normalize in a parent group. */
export function normalizeModel(scene: Object3D, dimensions: [number, number, number]) {
  const object = scene.clone(true)
  object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(object)
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  if ([size.x, size.y, size.z, ...dimensions].some(n => !Number.isFinite(n) || n <= 0)) {
    throw new Error('Invalid model bounds')
  }
  const normalized = new Group()
  normalized.add(object)
  normalized.scale.set(dimensions[0] / size.x, dimensions[1] / size.y, dimensions[2] / size.z)
  normalized.position.set(-center.x * normalized.scale.x, -box.min.y * normalized.scale.y, -center.z * normalized.scale.z)
  object.traverse(o => { o.castShadow = true; o.receiveShadow = true })
  return normalized
}
