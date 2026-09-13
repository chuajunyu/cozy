import { fitZoom } from './cameraFit'
import { dragState } from './dragState'
import { fixtureIntensity } from './lighting'
import { liftToSupport, isAnchored, settleScene } from './placement'
import { WINDOW_TRANSMITTANCE } from './daylightTransport'
import Daylight from './Daylight'
import RoomShell from './RoomShell'
import DoorPiece, { DoorVisual } from './DoorPiece'
import { sunAt } from './sunlight'
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls,
  OrthographicCamera,
  Edges,
  Html,
  useGLTF,
} from '@react-three/drei'
import { Group, Mesh, Plane, Vector3, OrthographicCamera as ThreeCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { normalizeModel } from './model'
import ProceduralFurniture from './Furniture'
import { type Item, type Product, type Scene } from './catalog'

class ModelBoundary extends Component<
  { children: ReactNode; product: Product },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <group><mesh position={[0, this.props.product.dimensions[1] / 2, 0]}>
        <boxGeometry args={this.props.product.dimensions} /><meshStandardMaterial color="#c8bba5" wireframe />
      </mesh><Html center><div className="model-message">Model unavailable. Select to replace or delete.</div></Html></group>
    ) : (
      this.props.children
    )
  }
}
function GlbFurniture({ product }: { product: Product }) {
  const gltf = useGLTF(product.modelUrl!, '/draco/')
  const model = useMemo(() => {
    const instance = normalizeModel(gltf.scene, product.dimensions)
    instance.traverse(o => { if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone() })
    return instance
  }, [gltf, product])
  useEffect(() => () => { model.traverse(o => { if (o instanceof Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()) }) }, [model])
  return <primitive object={model} />
}
export function Furniture({ product }: { product: Product }) {
  if (product.door) return <DoorVisual product={product} />
  if (product.modelUrl)
    return (
      <ModelBoundary key={product.modelUrl} product={product}>
        <Suspense
          fallback={
            <Html center>
              <div className="model-message">Loading furniture…</div>
            </Html>
          }
        >
          <GlbFurniture product={product} />
        </Suspense>
      </ModelBoundary>
    )

  if (product.wire && !product.parts.length) return <ProceduralFurniture product={product.wire} />
  return (
    <group>
      {product.parts.map((part, i) => (
        <mesh
          key={i}
          position={part.position}
          scale={part.shape === 'cylinder' ? part.size : undefined}
          castShadow
          receiveShadow
        >
          {part.shape === 'box' ? (
            <boxGeometry args={part.size} />
          ) : (
            <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
          )}
          <meshStandardMaterial color={part.color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}
function FixtureLight({
  product,
  settings,
}: {
  product: Product
  settings?: Item['light']
}) {
  if (!product.lighting || settings?.on === false) return null
  const color = product.lighting.colorMode === 'fixed' ? '#ffd3a0' : settings?.color ?? '#ffd3a0'
  const emitter = product.lighting.emitter ?? [
    0,
    product.dimensions[1] *
      (product.lighting.mount === 'ceiling' ? 0.15 : 0.78),
    0,
  ]
  return (
    <group position={emitter}>
      <pointLight
        color={color}
        intensity={fixtureIntensity(product)}
        distance={7}
        decay={2}
      />
      <mesh>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}
function Camera({ top, width, height, depth, disabled, fitRequest }: {
  top: boolean; width: number; height: number; depth: number; disabled: boolean; fitRequest: number
}) {
  const { size, invalidate } = useThree()
  const camera = useRef<ThreeCamera>(null)
  const controls = useRef<OrbitControlsImpl>(null)
  const viewport = useRef(size)
  const fittedZoom = useRef<number | null>(null)
  viewport.current = size
  useEffect(() => {
    if (!camera.current || !controls.current) return
    const { width: pixelsWide, height: pixelsHigh } = viewport.current
    const zoom = fitZoom(width + .3, height + .2, depth + .3, pixelsWide - 32, pixelsHigh - 140, top)
    const center = top ? 0 : height / 2
    camera.current.position.set(top ? 0 : 8, top ? 12 : center + 8, top ? .001 : 8)
    camera.current.zoom = zoom
    fittedZoom.current = zoom
    camera.current.updateProjectionMatrix()
    controls.current.target.set(0, center, 0)
    controls.current.minZoom = zoom * .3
    controls.current.maxZoom = zoom * 4
    controls.current.update()
    invalidate()
  }, [width, height, depth, top, fitRequest, invalidate])
  useEffect(() => {
    if (!camera.current || !controls.current || !fittedZoom.current) return
    const zoom = fitZoom(width + .3, height + .2, depth + .3, size.width - 32, size.height - 140, top)
    // Keep the user's relative magnification and orbit when a panel changes the available space.
    camera.current.zoom *= zoom / fittedZoom.current
    fittedZoom.current = zoom
    camera.current.updateProjectionMatrix()
    controls.current.minZoom = zoom * .3
    controls.current.maxZoom = zoom * 4
    invalidate()
  }, [size.width, size.height, width, height, depth, top, invalidate])
  return <>
    <OrthographicCamera ref={camera} makeDefault position={[8, 8, 8]} near={.1} far={80} />
    <OrbitControls ref={controls} makeDefault enabled={!disabled} enablePan={false} enableRotate={!top} maxPolarAngle={Math.PI / 2 - .1} />
  </>
}
function Placed({
  item,
  product,
  scene,
  catalog,
  selected,
  onSelect,
  onMove,
  onDrag,
}: {
  item: Item
  product: Product
  scene: Scene
  catalog: Product[]
  selected: boolean
  onSelect: (id: string) => void
  onMove: (item: Item) => void
  onDrag: (drag: boolean) => void
}) {
  const [preview, setPreview] = useState<Item | null>(null)
  const dragging = useRef(false)
  const capture = useRef<{ target: Element; pointerId: number } | null>(null)
  const dragVersion = dragState(scene, item)
  function releaseCapture() {
    if (!capture.current) return
    try { capture.current.target.releasePointerCapture(capture.current.pointerId) } catch { /* The browser may have already released the pointer. */ }
    capture.current = null
  }
  const offset = useRef({ x: 0, z: 0 })
  const current = useRef<Item | null>(null)
  const plane = new Plane(new Vector3(0, 1, 0), -(item.elevation ?? 0))
  const active = preview ?? item
  const drop = settleScene({ ...scene, items: scene.items.map(i => i.id === active.id ? active : i) }, scene, catalog)
  const landing = drop.error ? null : drop.scene.items.find(i => i.id === active.id)!
  const valid = landing !== null
  const group = useRef<Group>(null)
  const height = useRef(item.elevation ?? 0)
  const velocity = useRef(0)
  const { invalidate } = useThree()
  useFrame((_, delta) => {
    const destination = active.elevation ?? 0
    if (dragging.current || isAnchored(product) || destination >= height.current) {
      height.current = destination
      velocity.current = 0
    } else if (height.current > destination) {
      // Free fall from rest: y = y0 - 1/2*g*t², stopped at stable support.
      const dt = Math.min(delta, 0.05)
      height.current = Math.max(destination, height.current - velocity.current * dt - 4.905 * dt * dt)
      velocity.current += 9.81 * dt
      if (height.current > destination) invalidate()
      else velocity.current = 0
    }
    if (group.current) group.current.position.y = height.current
  })
  useEffect(() => { invalidate() }, [item.elevation, invalidate])
  useEffect(
    () => () => {
      releaseCapture()
      if (dragging.current) onDrag(false)
    },
    [onDrag],
  )
  useEffect(() => {
    if (dragging.current) { releaseCapture(); dragging.current = false; current.current = null; setPreview(null); onDrag(false) }
  }, [dragVersion, onDrag])
  function down(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    onSelect(item.id)
    if (item.locked) return
    const p = e.ray.intersectPlane(plane, new Vector3())
    if (!p) return
    offset.current = {
      x: p.x - (item.x),
      z: p.z - (item.z),
    }
    current.current = null
    dragging.current = true
    onDrag(true)
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    capture.current = { target: e.target as unknown as Element, pointerId: e.pointerId }
  }
  function move(e: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return
    e.stopPropagation()
    const p = e.ray.intersectPlane(plane, new Vector3())
    if (p) {
      let next: Item = {
        ...item,
        supportId: undefined,
        x: Math.round((p.x - offset.current.x) * 20) / 20,
        z: Math.round((p.z - offset.current.z) * 20) / 20,
      }
      next = liftToSupport(next, scene, catalog)
      current.current = next
      setPreview(next)
    }
  }
  function up(e: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return
    e.stopPropagation()
    dragging.current = false
    onDrag(false)
    releaseCapture()
    if (current.current) onMove(current.current)
    current.current = null
    setPreview(null)
  }
  function cancel(e?: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return
    e?.stopPropagation()
    releaseCapture()
    dragging.current = false
    onDrag(false)
    current.current = null
    height.current = item.elevation ?? 0
    velocity.current = 0
    setPreview(null)
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  })
  return (
    <>
    {preview && landing && <mesh position={[landing.x, (landing.elevation ?? 0) + .012, landing.z]} rotation={[-Math.PI / 2, 0, -(landing.rotation * Math.PI) / 180]}>
      <planeGeometry args={[product.dimensions[0], product.dimensions[2]]} />
      <meshBasicMaterial color="#88b676" transparent opacity={.4} depthWrite={false} />
    </mesh>}
    <group
      ref={group}
      userData={{ daylightFurniture: true }}
      position={[
        active.x,
        height.current,
        active.z,
      ]}
      rotation={[0, (active.rotation * Math.PI) / 180, 0]}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => cancel()}
    >
      <Furniture product={product} />
      <FixtureLight product={product} settings={item.light} />
      {selected && (
        <mesh position={[0, product.dimensions[1] / 2, 0]}>
          <boxGeometry args={product.dimensions} />
          <meshBasicMaterial
            transparent
            opacity={0.03}
            color={valid ? '#546b4b' : '#b44e3e'}
          />
          <Edges color={valid ? '#546b4b' : '#b44e3e'} />
        </mesh>
      )}
    </group>
    </>
  )
}
export default function Room({
  scene,
  catalog,
  selected,
  onSelect,
  onMove,
  top,
  fitRequest = 0,
  showCompass = false,
}: {
  scene: Scene
  catalog: Product[]
  selected: string | null
  onSelect: (id: string | null) => void
  onMove: (item: Item) => void
  top: boolean
  fitRequest?: number
  showCompass?: boolean
}) {
  const [drag, setDrag] = useState(false)
  const sun = sunAt(scene.sunHour ?? 9)
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 1.5]}
      onPointerMissed={() => onSelect(null)}
      fallback={<p>Enable WebGL to view your room.</p>}
    >
      <ambientLight
        intensity={0}
      />
      <directionalLight
        position={sun.direction.map(v => v * 20) as [number, number, number]}
        color={sun.warm ? '#ffd2a1' : '#fff4df'}
        intensity={sun.intensity * WINDOW_TRANSMITTANCE}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-normalBias={0.012}
        shadow-bias={-0.0001}
        shadow-camera-far={50}
      />
          <mesh position={[0, -0.1, 0]} receiveShadow>
            <boxGeometry args={[scene.width + 0.16, 0.2, scene.depth + 0.16]} />
            <meshStandardMaterial color="#c7ac88" />
          </mesh>
          {Array.from({ length: Math.ceil(scene.width / 0.25) }, (_, i) => (
            <mesh
              key={i}
              receiveShadow
              rotation={[-Math.PI / 2, 0, 0]}
              position={[-scene.width / 2 + i * 0.25, 0.001, 0]}
            >
              <planeGeometry args={[0.008, scene.depth]} />
              <meshStandardMaterial color="#b99c78" />
            </mesh>
          ))}
          <RoomShell scene={scene} catalog={catalog} top={top} showCompass={showCompass} />
          <Daylight room={scene} catalog={catalog} />
          {scene.items.map((item) => {
            const p = catalog.find((p) => p.id === item.productId)
            return p?.door ? <DoorPiece key={item.id} item={item} product={p} scene={scene} selected={selected === item.id} onSelect={onSelect} /> : p ? (
              <Placed
                key={item.id}
                item={item}
                product={p}
                scene={scene}
                catalog={catalog}
                selected={selected === item.id}
                onSelect={onSelect}
                onMove={onMove}
                onDrag={setDrag}
              />
            ) : null
          })}
      <Camera top={top} width={scene.width} height={scene.height ?? 2.6}
        depth={scene.depth} disabled={drag} fitRequest={fitRequest} />
    </Canvas>
  )
}
