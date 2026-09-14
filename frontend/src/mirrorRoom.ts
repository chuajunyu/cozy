import { Material, Mesh, type Object3D } from 'three'

/** Reflect the enclosed room, then restore the main camera's cutaway exactly. */
export function withMirrorRoom(scene: Object3D, render: () => void): void {
  const materials = new Map<Material, { colorWrite: boolean; depthWrite: boolean }>()
  const mirrors: Mesh[] = []
  try {
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return
      if (object.userData.mirrorSurface && object.visible) {
        mirrors.push(object)
        object.visible = false
      }
      if (!object.userData.roomShell) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (materials.has(material)) continue
        materials.set(material, { colorWrite: material.colorWrite, depthWrite: material.depthWrite })
        material.colorWrite = true
        material.depthWrite = true
      }
    })
    render()
  } finally {
    materials.forEach((original, material) => {
      material.colorWrite = original.colorWrite
      material.depthWrite = original.depthWrite
    })
    mirrors.forEach(mirror => { mirror.visible = true })
  }
}
