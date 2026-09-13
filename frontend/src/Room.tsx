import { fixtureIntensity } from './lighting'
import { liftToSupport, isAnchored, settleItem } from './placement'
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
import { Box3, Group, Mesh, Plane, Vector3 } from 'three'
import { type Item, type Product, type Scene } from './catalog'

class ModelBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <Html center>
        <div className="model-message">
          Model could not load. Try another product.
        </div>
      </Html>
    ) : (
      this.props.children
    )
  }
}
function GlbFurniture({ product }: { product: Product }) {
  const gltf = useGLTF(product.modelUrl!)
  const model = useMemo(() => {
    const object = gltf.scene.clone(true)
    object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(object)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    // Catalog dimensions determine the real-world footprint; all assets sit on y=0.
    object.scale.set(
      product.dimensions[0] / size.x,
      product.dimensions[1] / size.y,
      product.dimensions[2] / size.z,
    )
    object.position.set(
      -center.x * object.scale.x,
      -box.min.y * object.scale.y,
      -center.z * object.scale.z,
    )
    object.traverse((o) => {
      if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone()
      o.castShadow = true
      o.receiveShadow = true
    })
    return object
  }, [gltf, product])
  useEffect(() => () => {
    model.traverse(object => {
      if (object instanceof Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach(material => material.dispose())
      }
    })
  }, [model])
  return <primitive object={model} />
}
export function Furniture({ product }: { product: Product }) {
  if (product.door) return <DoorVisual product={product} />
  if (product.modelUrl)
    return (
      <ModelBoundary key={product.modelUrl}>
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
function Camera({
  top,
  extent,
  disabled,
  focusHeight,
  productView,
}: {
  top: boolean
  extent: number
  disabled: boolean
  focusHeight: number
  productView: boolean
}) {
  const { size } = useThree()
  const zoom = productView
    ? Math.min(size.width / (extent * 2), size.height / (extent * 1.8), 450)
    : Math.min(size.width / (extent + 3), size.height / (extent + 3.5), 90)
  return (
    <>
      <OrthographicCamera
        key={`camera-${top}`}
        makeDefault
        position={top ? [0, 12, 0.001] : [8, 8, 8]}
        zoom={zoom}
        near={0.1}
        far={80}
      />
      <OrbitControls
        key={`orbit-${top}`}
        makeDefault
        enabled={!disabled}
        target={[0, focusHeight, 0]}
        enablePan={false}
        enableRotate={!top}
        minZoom={zoom * 0.5}
        maxZoom={zoom * 2.5}
        maxPolarAngle={Math.PI / 2 - 0.1}
      />
    </>
  )
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
  const offset = useRef({ x: 0, z: 0 })
  const current = useRef<Item | null>(null)
  const plane = new Plane(new Vector3(0, 1, 0), -(item.elevation ?? 0))
  const active = preview ?? item
  const landing = settleItem(active, scene, catalog)
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
      if (dragging.current) onDrag(false)
    },
    [onDrag],
  )
  function down(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    onSelect(item.id)
    if (item.locked) return
    const p = e.ray.intersectPlane(plane, new Vector3())
    if (!p) return
    offset.current = {
      x: p.x - (item.x - scene.width / 2),
      z: p.z - (item.z - scene.depth / 2),
    }
    current.current = null
    dragging.current = true
    onDrag(true)
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
  }
  function move(e: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return
    e.stopPropagation()
    const p = e.ray.intersectPlane(plane, new Vector3())
    if (p) {
      let next: Item = {
        ...item,
        supportId: undefined,
        x: Math.round((p.x + scene.width / 2 - offset.current.x) * 20) / 20,
        z: Math.round((p.z + scene.depth / 2 - offset.current.z) * 20) / 20,
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
    ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
    if (current.current) onMove(current.current)
    current.current = null
    setPreview(null)
  }
  function cancel(e?: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return
    e?.stopPropagation()
    if (e) (e.target as unknown as Element).releasePointerCapture(e.pointerId)
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
    {preview && landing && <mesh position={[landing.x - scene.width / 2, (landing.elevation ?? 0) + .012, landing.z - scene.depth / 2]} rotation={[-Math.PI / 2, 0, -(landing.rotation * Math.PI) / 180]}>
      <planeGeometry args={[product.dimensions[0], product.dimensions[2]]} />
      <meshBasicMaterial color="#88b676" transparent opacity={.4} depthWrite={false} />
    </mesh>}
    <group
      ref={group}
      userData={{ daylightFurniture: true }}
      position={[
        active.x - scene.width / 2,
        height.current,
        active.z - scene.depth / 2,
      ]}
      rotation={[0, (active.rotation * Math.PI) / 180, 0]}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
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
  preview,
  bounds = false,
}: {
  scene: Scene
  catalog: Product[]
  selected: string | null
  onSelect: (id: string | null) => void
  onMove: (item: Item) => void
  top: boolean
  preview?: Product
  bounds?: boolean
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
        intensity={preview ? 1.2 : 0}
      />
      <directionalLight
        position={preview ? [6, 8, 6] : sun.direction.map(v => v * 20) as [number, number, number]}
        color={!preview && sun.warm ? '#ffd2a1' : '#fff4df'}
        intensity={preview ? 2 : sun.intensity * WINDOW_TRANSMITTANCE}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-normalBias={0.012}
        shadow-bias={-0.0001}
        shadow-camera-far={50}
      />
      {preview ? (
        <>
          <mesh position={[0, -0.06, 0]} receiveShadow>
            <boxGeometry
              args={[
                Math.max(...preview.dimensions) * 2.5,
                0.1,
                Math.max(...preview.dimensions) * 2.5,
              ]}
            />
            <meshStandardMaterial color="#e6dfd2" />
          </mesh>
          <Furniture product={preview} />
          <FixtureLight product={preview} />
          {bounds && (
            <mesh position={[0, preview.dimensions[1] / 2, 0]}>
              <boxGeometry args={preview.dimensions} />
              <meshBasicMaterial transparent opacity={0} />
              <Edges color="#667b5c" />
            </mesh>
          )}
        </>
      ) : (
        <>
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
          <RoomShell scene={scene} catalog={catalog} top={top} />
          <Daylight room={scene} catalog={catalog} />
          {scene.items.map((item) => {
            const p = catalog.find((p) => p.id === item.productId)
            return p?.door ? <DoorPiece key={item.id} item={item} product={p} scene={scene} selected={selected === item.id} onSelect={onSelect} />
              : p && (!p.id.startsWith('ikea-') || p.readyForPreview === true) ? (
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
        </>
      )}
      <Camera
        top={top}
        extent={
          preview
            ? Math.max(...preview.dimensions)
            : Math.max(scene.width, scene.depth)
        }
        disabled={drag}
        focusHeight={preview ? preview.dimensions[1] / 2 : 0.6}
        productView={!!preview}
      />
    </Canvas>
  )
}
