import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { HalfFloatType, Matrix4, Mesh, Plane, Shape, Vector3, WebGLRenderTarget } from 'three'
import type { Product } from './catalog'
import { withMirrorRoom } from './mirrorRoom'

/** Each visible mirror renders on demand, without recursive mirror feedback. */
export default function MirrorSurface({ surface, resolution }: { surface: NonNullable<Product['reflection']>; resolution: number }) {
  const mesh = useRef<Mesh>(null)
  const { camera, gl, scene } = useThree()
  const reflected = useMemo(() => camera.clone(), [camera])
  const target = useMemo(() => new WebGLRenderTarget(resolution, resolution, { type: HalfFloatType }), [resolution])
  const textureMatrix = useMemo(() => new Matrix4(), [])
  const shape = useMemo(() => {
    const s = new Shape(), w = surface.width/2, h = surface.height/2
    if (surface.shape === 'ellipse') s.absellipse(0,0,w,h,0,Math.PI*2,false,0)
    else {
      const r = surface.shape === 'rounded' ? Math.min(w,h)*.6 : .001
      s.moveTo(-w+r,-h); s.lineTo(w-r,-h); s.quadraticCurveTo(w,-h,w,-h+r)
      s.lineTo(w,h-r); s.quadraticCurveTo(w,h,w-r,h); s.lineTo(-w+r,h)
      s.quadraticCurveTo(-w,h,-w,h-r); s.lineTo(-w,-h+r); s.quadraticCurveTo(-w,-h,-w+r,-h)
    }
    return s
  }, [surface])
  useEffect(() => () => target.dispose(), [target])
  useFrame(() => {
    if (!mesh.current) return
    const mirror = mesh.current
    mirror.updateWorldMatrix(true, false)
    const origin = new Vector3().setFromMatrixPosition(mirror.matrixWorld)
    const normal = new Vector3(0,0,1).transformDirection(mirror.matrixWorld)
    const eye = camera.getWorldPosition(new Vector3())
    if (eye.clone().sub(origin).dot(normal) <= 0) return
    const reflectPoint = (p: Vector3) => p.addScaledVector(normal,-2*p.clone().sub(origin).dot(normal))
    reflected.copy(camera, false)
    reflected.matrixAutoUpdate = true
    reflected.matrixWorldAutoUpdate = true
    reflected.position.copy(reflectPoint(eye.clone()))
    reflected.up.copy(camera.up).reflect(normal)
    reflected.lookAt(reflectPoint(eye.clone().add(camera.getWorldDirection(new Vector3()))))
    reflected.updateMatrixWorld(true)
    textureMatrix.set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1)
      .multiply(reflected.projectionMatrix).multiply(reflected.matrixWorldInverse)
    const previousTarget = gl.getRenderTarget(), planes = gl.clippingPlanes, autoShadow = gl.shadowMap.autoUpdate
    try {
      gl.clippingPlanes = [new Plane().setFromNormalAndCoplanarPoint(normal, origin)]
      gl.shadowMap.autoUpdate = false
      gl.setRenderTarget(target); gl.clear()
      withMirrorRoom(scene, () => gl.render(scene, reflected))
    } finally {
      gl.setRenderTarget(previousTarget); gl.clippingPlanes = planes
      gl.shadowMap.autoUpdate = autoShadow
    }
  })
  return <mesh ref={mesh} userData={{ mirrorSurface: true }} position={surface.center} raycast={() => {}}>
    <shapeGeometry args={[shape,32]} />
    <meshBasicMaterial key="reflection-hdr" map={target.texture} toneMapped={true} color={[1.25,1.25,1.25]} onBeforeCompile={shader => {
      shader.uniforms.mirrorProjection = { value: textureMatrix }
      shader.vertexShader = 'uniform mat4 mirrorProjection;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvec4 mirrorUV = mirrorProjection * modelMatrix * vec4(transformed, 1.0);\nvMapUv = mirrorUV.xy / mirrorUV.w;')
    }} />
  </mesh>
}
