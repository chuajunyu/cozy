import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Box3, Data3DTexture, FloatType, LinearFilter, Mesh, MeshStandardMaterial, RGBAFormat, Vector3, type Material } from 'three'
import type { Product, Scene, Vec3 } from './catalog'
import { doorOpenings } from './doors'
import { daylightExposure, diffuseSkyRadiance } from './lighting'
import { defaultWindows, sunAt } from './sunlight'
import type { TransportInput } from './daylightTransport'

const size: Vec3 = [7, 4, 7]
const fragment = `
varying vec3 vDaylightPosition;
uniform sampler3D daylight0;
uniform sampler3D daylightX;
uniform sampler3D daylightY;
uniform sampler3D daylightZ;
uniform vec3 daylightExtent;
vec3 roomIrradiance(vec3 position, vec3 n) {
  vec3 low = vec3(-daylightExtent.x * .5 + .08, .08, -daylightExtent.z * .5 + .08);
  vec3 span = daylightExtent - vec3(.16);
  vec3 grid = vec3(7., 4., 7.);
  // Map grid endpoints to texel centers, with a normal offset away from solids.
  vec3 uvw = (clamp((position + n * .06 - low) / span, 0., 1.) * (grid - 1.) + .5) / grid;
  return max(vec3(0.), .8862269255 * texture(daylight0, uvw).rgb +
    1.0233267079 * (texture(daylightX, uvw).rgb * n.x + texture(daylightY, uvw).rgb * n.y + texture(daylightZ, uvw).rgb * n.z));
}
`

/** Spatial irradiance probes integrate diffuse sky and multi-bounce daylight.
 * The directional light separately supplies the unscattered solar beam. */
export default function Daylight({ room, catalog }: { room: Scene; catalog: Product[] }) {
  const { scene, gl, invalidate } = useThree()
  const [pending, setPending] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const worker = useRef<Worker | null>(null)
  const revision = useRef(0)
  const busy = useRef(false)
  const queued = useRef<{ id: number; input: TransportInput } | null>(null)
  const signature = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const patched = useRef(new Map<MeshStandardMaterial, { compile: Material['onBeforeCompile']; key: Material['customProgramCacheKey'] }>())
  const originalExposure = useRef(gl.toneMappingExposure)
  const textures = useMemo(() => Array.from({ length: 4 }, () => {
    const texture = new Data3DTexture(new Float32Array(size[0] * size[1] * size[2] * 4), ...size)
    texture.format = RGBAFormat
    texture.type = FloatType
    texture.minFilter = texture.magFilter = LinearFilter
    texture.needsUpdate = true
    return texture
  }), [])
  const uniforms = useMemo(() => ({
    daylight0: { value: textures[0] }, daylightX: { value: textures[1] },
    daylightY: { value: textures[2] }, daylightZ: { value: textures[3] },
    daylightExtent: { value: new Vector3(room.width, room.height ?? 2.6, room.depth) },
  }), [textures])

  useEffect(() => {
    let instance: Worker
    try { instance = new Worker(new URL('./daylight.worker.ts', import.meta.url), { type: 'module' }) }
    catch { setFailed(true); setPending(false); return }
    setPending(true)
    worker.current = instance
    instance.onmessage = ({ data }) => {
      busy.current = false
      if (queued.current) {
        instance.postMessage(queued.current)
        queued.current = null
        busy.current = true
      }
      if (data.id !== revision.current) return
      if (data.error) { setFailed(true); setPending(false); return }
      const result = data.result as { coefficients: Float32Array; meanIrradiance: number }
      for (let c = 0; c < 4; c++) {
        const pixels = textures[c].image.data as Float32Array
        for (let i = 0; i < pixels.length / 4; i++)
          for (let channel = 0; channel < 4; channel++) pixels[i * 4 + channel] = result.coefficients[i * 16 + c * 4 + channel]
        textures[c].needsUpdate = true
      }
      // Fixture switches never change the exposure of existing daylight.
      gl.toneMappingExposure = daylightExposure(result.meanIrradiance)
      setPending(false)
      setFailed(false)
      invalidate()
    }
    instance.onerror = () => { instance.terminate(); worker.current = null; busy.current = false; setFailed(true); setPending(false) }
    return () => {
      instance.terminate()
      worker.current = null
      busy.current = false
      queued.current = null
      signature.current = ''
      if (timer.current) clearTimeout(timer.current)
      for (const [material, original] of patched.current) {
        material.onBeforeCompile = original.compile
        material.customProgramCacheKey = original.key
        material.needsUpdate = true
      }
      patched.current.clear()
      gl.toneMappingExposure = originalExposure.current
    }
  }, [gl, invalidate, textures, retry])
  useEffect(() => () => { for (const texture of textures) texture.dispose() }, [textures])

  useFrame(() => {
    if (!worker.current) return
    uniforms.daylightExtent.value.set(room.width, room.height ?? 2.6, room.depth)
    scene.updateMatrixWorld(true)
    const boxes: TransportInput['boxes'] = []
    const activeMaterials = new Set<MeshStandardMaterial>()
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial)) continue
        activeMaterials.add(material)
        if (patched.current.has(material)) continue
        const compile = material.onBeforeCompile
        patched.current.set(material, { compile, key: material.customProgramCacheKey })
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer)
          Object.assign(shader.uniforms, uniforms)
          shader.vertexShader = 'varying vec3 vDaylightPosition;\n' + shader.vertexShader
          shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDaylightPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;')
          shader.fragmentShader = fragment + shader.fragmentShader
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\nirradiance += roomIrradiance(vDaylightPosition, inverseTransformDirection(geometryNormal, viewMatrix));')
        }
        material.customProgramCacheKey = () => 'cozy-diffuse-transport-v1'
        material.needsUpdate = true
      }
      let ancestor = object.parent
      while (ancestor && !ancestor.userData.daylightFurniture) ancestor = ancestor.parent
      if (!ancestor || !object.castShadow || !materials.some(m => m instanceof MeshStandardMaterial)) return
      // Per-mesh bounds preserve separate table legs and shelves where the asset does.
      // Direct shadows still use the original triangles; indirect transport uses proxies.
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      const bound = new Box3().copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld)
      if (bound.isEmpty()) return
      const color = materials.find(m => m instanceof MeshStandardMaterial) as MeshStandardMaterial
      boxes.push({ min: bound.min.toArray() as Vec3, max: bound.max.toArray() as Vec3,
        reflectance: [color.color.r, color.color.g, color.color.b].map(v => Math.min(.9, Math.max(0, v))) as Vec3 })
    })
    for (const [material, original] of patched.current) {
      if (activeMaterials.has(material)) continue
      material.onBeforeCompile = original.compile
      material.customProgramCacheKey = original.key
      material.needsUpdate = true
      patched.current.delete(material)
    }
    const sun = sunAt(room.sunHour ?? 9)
    // A bright diffuse outdoor sky continues illuminating sun-facing and shaded windows.
    const sky = diffuseSkyRadiance(sun.intensity)
    const input: TransportInput = {
      width: room.width, depth: room.depth, height: room.height ?? 2.6, windows: room.windows ?? defaultWindows,
      doors: doorOpenings(room, catalog),
      sunDirection: sun.direction, sunIntensity: sun.intensity,
      sunColor: sun.warm ? [1, .644, .356] : [1, .905, .738],
      skyRadiance: [sky * .8, sky * .9, sky], boxes,
      surfaceReflectance: { floor: [.571, .412, .246], wall: [.855, .815, .738], ceiling: [.82, .82, .8] },
      resolution: size, samples: 192, bounces: 5,
    }
    const key = JSON.stringify(input)
    if (signature.current === key) return
    signature.current = key
    const id = ++revision.current
    setPending(true)
    if (timer.current) clearTimeout(timer.current)
    // Immediately discard previous lighting when all apertures close or at night.
    if ((!input.windows.length && !input.doors?.length) || !sun.intensity) {
      for (const texture of textures) { (texture.image.data as Float32Array).fill(0); texture.needsUpdate = true }
      gl.toneMappingExposure = daylightExposure(0)
      invalidate()
    }
    timer.current = setTimeout(() => {
      if (busy.current) queued.current = { id, input }
      else { worker.current?.postMessage({ id, input }); busy.current = true }
    }, 120)
  })
  return pending || failed ? <Html position={[0, (room.height ?? 2.6) + .15, 0]} center><span className="daylight-progress">{failed ? <>Daylight calculation unavailable <button onClick={() => { setFailed(false); setRetry(n => n + 1); invalidate() }}>Retry daylight</button></> : 'Updating daylight…'}</span></Html> : null
}
