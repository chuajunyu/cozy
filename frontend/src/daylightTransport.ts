import type { RoomWindow, Wall } from './sunlight'

export type Vec3 = [number, number, number]
export type TransportBox = { min: Vec3; max: Vec3; reflectance: Vec3 }
export type TransportInput = {
  width: number
  depth: number
  height?: number
  windows: RoomWindow[]
  /** Only open doorways are apertures; a closed solid door is part of the wall. */
  doors?: RoomWindow[]
  sunDirection: Vec3
  sunIntensity: number
  sunColor: Vec3
  skyRadiance: Vec3
  boxes: TransportBox[]
  surfaceReflectance?: { floor: Vec3; wall: Vec3; ceiling: Vec3 }
  wallReflectance?: Partial<Record<Wall, Vec3>>
  samples?: number
  bounces?: number
  resolution?: [number, number, number]
}
export type TransportResult = {
  size: [number, number, number]
  coefficients: Float32Array
  meanIrradiance: number
}

export const ROOM_HEIGHT = 2.7
export const PROBE_INSET = 0.08
export const WINDOW_TRANSMITTANCE = 0.82
const EPSILON = 0.0002
const SH_ZERO = 0.28209479177387814
const SH_ONE = 0.4886025119029199
const IRRADIANCE_ZERO = 0.886226925452758
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

type Opening = {
  axis: 0 | 2
  side: -1 | 1
  start: number
  end: number
  bottom: number
  top: number
  kind: 'window' | 'door'
  transmission: number
}
type Hit = { kind: 'surface'; point: Vec3; normal: Vec3; reflectance: Vec3 } |
  { kind: 'opening'; transmission: number }
type Context = {
  min: Vec3
  max: Vec3
  openings: Opening[]
  boxes: TransportBox[]
  floor: Vec3
  wall: Vec3
  wallReflectance: Partial<Record<Wall, Vec3>>
  ceiling: Vec3
  sunDirection: Vec3
  sunRadiance: Vec3
  sky: Vec3
  bounces: number
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const addScaled = (a: Vec3, b: Vec3, scale: number): Vec3 => [
  a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale,
]
const clampedReflectance = (value: Vec3): Vec3 => value.map(v =>
  Math.max(0, Math.min(0.9, Number.isFinite(v) ? v : 0)),
) as Vec3
const nonnegative = (value: Vec3): Vec3 => value.map(v =>
  Math.max(0, Number.isFinite(v) ? v : 0),
) as Vec3
const insideBox = (p: Vec3, box: TransportBox) => p.every((v, axis) =>
  v > box.min[axis] - EPSILON && v < box.max[axis] + EPSILON,
)

function createContext(input: TransportInput): Context {
  if (!Number.isFinite(input.width) || !Number.isFinite(input.depth) ||
    input.width < 0.5 || input.depth < 0.5 || !Number.isFinite(input.height ?? ROOM_HEIGHT) || (input.height ?? ROOM_HEIGHT) < .5) {
    throw new Error('Daylight room dimensions must be finite and at least 0.5 m.')
  }
  const sunLength = Math.hypot(...input.sunDirection)
  const sunDirection: Vec3 = sunLength > 0 && Number.isFinite(sunLength)
    ? input.sunDirection.map(v => v / sunLength) as Vec3
    : [0, -1, 0]
  const sunPower = sunDirection[1] > 0 && Number.isFinite(input.sunIntensity)
    ? Math.max(0, input.sunIntensity) : 0
  const aperture = (window: RoomWindow, kind: Opening['kind']): Opening => {
    const axis = window.wall === 'east' || window.wall === 'west' ? 0 : 2
    const side = window.wall === 'east' || window.wall === 'south' ? 1 : -1
    const length = axis === 0 ? input.depth : input.width
    const width = Math.min(window.width, length - 0.4)
    const start = 0.2 + (length - width - 0.4) * window.offset
    // RoomShell rotates both E/W walls by +pi/2: local +x is world -z.
    return { axis, side, start, end: start + width,
      bottom: window.sill, top: window.sill + window.height, kind,
      transmission: kind === 'window' ? WINDOW_TRANSMITTANCE : 1 }
  }
  const openings = [
    ...input.windows.map(window => aperture(window, 'window')),
    ...(input.doors ?? []).map(door => aperture(door, 'door')),
  ]
  return {
    min: [-input.width / 2, 0, -input.depth / 2],
    max: [input.width / 2, input.height ?? ROOM_HEIGHT, input.depth / 2],
    openings,
    boxes: input.boxes.filter(box => box.min.every((v, axis) =>
      Number.isFinite(v) && Number.isFinite(box.max[axis]) && box.max[axis] > v,
    )).map(box => ({ ...box, reflectance: clampedReflectance(box.reflectance) })),
    // Linear reflectances, not display/sRGB colors. All energy is source driven.
    floor: clampedReflectance(input.surfaceReflectance?.floor ?? [0.5, 0.4, 0.28]),
    wall: clampedReflectance(input.surfaceReflectance?.wall ?? [0.78, 0.76, 0.7]),
    wallReflectance: Object.fromEntries(Object.entries(input.wallReflectance ?? {}).map(([wall, color]) => [wall, clampedReflectance(color)])),
    ceiling: clampedReflectance(input.surfaceReflectance?.ceiling ?? [0.82, 0.82, 0.8]),
    sunDirection,
    sunRadiance: nonnegative(input.sunColor).map(v => v * sunPower) as Vec3,
    sky: nonnegative(input.skyRadiance),
    bounces: Math.max(0, Math.min(8, Math.round(input.bounces ?? 5))),
  }
}

function openingAt(context: Context, axis: number, side: number, p: Vec3) {
  if (axis === 1) return undefined
  const coordinate = axis === 0 ? context.max[2] - p[2] : p[0] - context.min[0]
  return context.openings.find(opening => opening.axis === axis && opening.side === side &&
    coordinate > opening.start + 0.0275 && coordinate < opening.end - 0.0275 &&
    p[1] > opening.bottom + (opening.kind === 'window' ? 0.0275 : 0) && p[1] < opening.top - 0.0275 &&
    (opening.kind === 'door' || Math.abs(coordinate - (opening.start + opening.end) / 2) > 0.0175),
  )
}

/** Closest room/furniture surface, or the transmission of the aperture a ray exits. */
function intersect(context: Context, origin: Vec3, direction: Vec3): Hit {
  let distance = Infinity
  let normal: Vec3 = [0, 1, 0]
  let boundaryAxis = 1
  let boundarySide = 1
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-12) continue
    const side = direction[axis] > 0 ? 1 : -1
    const boundary = side === 1 ? context.max[axis] : context.min[axis]
    const t = (boundary - origin[axis]) / direction[axis]
    if (t > EPSILON / 2 && t < distance) {
      distance = t
      normal = [0, 0, 0]
      normal[axis] = -side
      boundaryAxis = axis
      boundarySide = side
    }
  }
  let reflectance = boundaryAxis === 1
    ? boundarySide === -1 ? context.floor : context.ceiling
    : context.wallReflectance[boundaryAxis === 0 ? boundarySide === -1 ? 'west' : 'east' : boundarySide === -1 ? 'north' : 'south'] ?? context.wall
  let furnitureHit = false
  for (const box of context.boxes) {
    let enter = -Infinity
    let exit = Infinity
    let enterAxis = 0
    let enterSign = -1
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(direction[axis]) < 1e-12) {
        if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) {
          exit = -Infinity
          break
        }
        continue
      }
      const a = (box.min[axis] - origin[axis]) / direction[axis]
      const b = (box.max[axis] - origin[axis]) / direction[axis]
      const near = Math.min(a, b)
      if (near > enter) {
        enter = near
        enterAxis = axis
        enterSign = direction[axis] > 0 ? -1 : 1
      }
      exit = Math.min(exit, Math.max(a, b))
      if (exit < enter) break
    }
    if (enter > EPSILON / 2 && enter < distance && exit >= enter) {
      distance = enter
      normal = [0, 0, 0]
      normal[enterAxis] = enterSign
      reflectance = box.reflectance
      furnitureHit = true
    }
  }
  if (!Number.isFinite(distance)) return { kind: 'opening', transmission: 0 }
  const point = addScaled(origin, direction, distance)
  const opening = !furnitureHit && openingAt(context, boundaryAxis, boundarySide, point)
  if (opening) return { kind: 'opening', transmission: opening.transmission }
  return { kind: 'surface', point, normal, reflectance }
}

function randomGenerator(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function cosineDirection(normal: Vec3, random: () => number): Vec3 {
  const angle = random() * Math.PI * 2
  const radius = Math.sqrt(random())
  const a = Math.cos(angle) * radius
  const b = Math.sin(angle) * radius
  const c = Math.sqrt(Math.max(0, 1 - radius * radius))
  // All transport primitives are axis aligned, so their tangent bases are exact.
  if (normal[0]) return [c * normal[0], a, b]
  if (normal[1]) return [a, c * normal[1], b]
  return [a, b, c * normal[2]]
}

/** Backward path tracing with cosine-weighted Lambertian sampling and solar NEE. */
function radianceAlong(context: Context, probe: Vec3, initial: Vec3, seed: number): Vec3 {
  let origin = probe
  let direction = initial
  let throughput: Vec3 = [1, 1, 1]
  const radiance: Vec3 = [0, 0, 0]
  const random = randomGenerator(seed)
  for (let bounce = 0; bounce <= context.bounces; bounce++) {
    const hit = intersect(context, origin, direction)
    if (hit.kind === 'opening') {
      // A uniform diffuse sky and a darker diffuse ground are explicit sources.
      // The solar disc is deliberately excluded: rasterization renders direct sun.
      const transmission = hit.transmission * (direction[1] >= 0 ? 1 : 0.2)
      for (let channel = 0; channel < 3; channel++) {
        radiance[channel] += throughput[channel] * context.sky[channel] * transmission
      }
      break
    }
    if (bounce === context.bounces) break
    origin = addScaled(hit.point, hit.normal, EPSILON * 2)
    const cosine = Math.max(0, dot(hit.normal, context.sunDirection))
    const sunlight = cosine > 0 && context.sunRadiance.some(v => v > 0)
      ? intersect(context, origin, context.sunDirection) : null
    if (sunlight?.kind === 'opening') {
      // fr = rho/pi. The directional sun is sampled explicitly at each bounce.
      for (let channel = 0; channel < 3; channel++) {
        radiance[channel] += throughput[channel] * hit.reflectance[channel] *
          context.sunRadiance[channel] * cosine * sunlight.transmission / Math.PI
      }
    }
    throughput = throughput.map((v, channel) => v * hit.reflectance[channel]) as Vec3
    if (Math.max(...throughput) < 1e-6) break
    // fr*cos(theta)/pdf = rho with cosine-weighted sampling, conserving energy.
    direction = cosineDirection(hit.normal, random)
  }
  return radiance
}

/** Relocate solid-embedded probes to the closest clear proxy surface. */
function clearProbe(context: Context, probe: Vec3): Vec3 | null {
  if (!context.boxes.some(box => insideBox(probe, box))) return probe
  let nearest: Vec3 | null = null
  let nearestDistance = Infinity
  for (const box of context.boxes) {
    for (let axis = 0; axis < 3; axis++) {
      for (const side of [-1, 1]) {
        const candidate: Vec3 = [...probe]
        candidate[axis] = (side === -1 ? box.min[axis] : box.max[axis]) + side * EPSILON * 4
        if (candidate.some((v, i) => v <= context.min[i] + EPSILON ||
          v >= context.max[i] - EPSILON)) continue
        const distance = candidate.reduce((sum, v, i) => sum + (v - probe[i]) ** 2, 0)
        if (distance < nearestDistance && !context.boxes.some(b => insideBox(candidate, b))) {
          nearest = candidate
          nearestDistance = distance
        }
      }
    }
  }
  // A room filled entirely by opaque proxies has no clear probe location.
  return nearest
}

/**
 * A deterministic, finite-bounce diffuse transport estimate, evaluated off-thread.
 * Grid order is x fastest, then y, then z; endpoints are inset 0.08 m.
 * Each voxel contains four RGBA radiance SH coefficients: [Y00, Y1x, Y1y, Y1z].
 * RGB carries energy and alpha is unused. The basis is [0.28209479, 0.48860251*x,
 * 0.48860251*y, 0.48860251*z]. Irradiance at unit normal n is approximated by
 * max(0, 0.88622693*c0 + 1.02332671*(cx*n.x + cy*n.y + cz*n.z)).
 * This low-order reconstruction and furniture proxies are realtime approximations;
 * the traced transport uses actual visibility, cosine factors, and reflectance.
 */
export function solveDaylight(input: TransportInput): TransportResult {
  const context = createContext(input)
  const size = (input.resolution ?? [7, 4, 7]).map(v =>
    Math.max(2, Math.min(12, Number.isFinite(v) ? Math.round(v) : 2)),
  ) as [number, number, number]
  const samples = Math.max(16, Math.min(1024, Math.round(input.samples ?? 128)))
  const coefficients = new Float32Array(size[0] * size[1] * size[2] * 16)
  if (!context.openings.length ||
    (!context.sky.some(v => v > 0) && !context.sunRadiance.some(v => v > 0))) {
    return { size, coefficients, meanIrradiance: 0 }
  }
  let meanIrradiance = 0
  let clearCount = 0
  for (let z = 0; z < size[2]; z++) {
    for (let y = 0; y < size[1]; y++) {
      for (let x = 0; x < size[0]; x++) {
        const voxel = (z * size[1] + y) * size[0] + x
        const grid: Vec3 = [x, y, z]
        const probe = clearProbe(context, grid.map((v, axis) =>
          context.min[axis] + PROBE_INSET + v / (size[axis] - 1) *
          (context.max[axis] - context.min[axis] - 2 * PROBE_INSET),
        ) as Vec3)
        if (!probe) continue
        clearCount++
        const offset = voxel * 16
        const rotation = randomGenerator(Math.imul(voxel + 1, 2654435761))() * 2 * Math.PI
        const sums = new Float64Array(12)
        for (let sample = 0; sample < samples; sample++) {
          // Equal-area Fibonacci directions give stable, uniform-sphere SH estimates.
          const vertical = 1 - 2 * (sample + 0.5) / samples
          const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical))
          const angle = sample * GOLDEN_ANGLE + rotation
          const direction: Vec3 = [Math.cos(angle) * horizontal, vertical, Math.sin(angle) * horizontal]
          const radiance = radianceAlong(context, probe, direction,
            Math.imul(voxel + 1, 73856093) ^ Math.imul(sample + 1, 19349663))
          const basis = [SH_ZERO, SH_ONE * direction[0], SH_ONE * direction[1], SH_ONE * direction[2]]
          for (let band = 0; band < 4; band++) {
            for (let channel = 0; channel < 3; channel++) {
              sums[band * 3 + channel] += radiance[channel] * basis[band]
            }
          }
        }
        for (let band = 0; band < 4; band++) {
          for (let channel = 0; channel < 3; channel++) {
            coefficients[offset + band * 4 + channel] = sums[band * 3 + channel] * 4 * Math.PI / samples
          }
        }
        meanIrradiance += IRRADIANCE_ZERO * (
          coefficients[offset] * 0.2126 + coefficients[offset + 1] * 0.7152 + coefficients[offset + 2] * 0.0722)
      }
    }
  }
  return { size, coefficients, meanIrradiance: clearCount ? meanIrradiance / clearCount : 0 }
}
