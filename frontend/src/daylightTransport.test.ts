import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solveDaylight } from './daylightTransport.ts'
import type { TransportInput, Vec3 } from './daylightTransport.ts'

const black: Vec3 = [0, 0, 0]
const grey: Vec3 = [0.7, 0.7, 0.7]
const base: TransportInput = {
  width: 5,
  depth: 4,
  windows: [{ wall: 'east', offset: 0.5, width: 1.8, height: 1.4, sill: 0.9 }],
  sunDirection: [0.8, 0.55, 0.2],
  sunIntensity: 0,
  sunColor: [1, 1, 1],
  skyRadiance: [1, 1, 1],
  boxes: [],
  resolution: [3, 3, 3],
  samples: 192,
  bounces: 4,
  surfaceReflectance: { floor: grey, wall: grey, ceiling: grey },
}

test('individual wall paint changes bounced light while keeping other surfaces independent', () => {
  const darkRoom = { ...base, surfaceReflectance: { floor: black, wall: black, ceiling: black } }
  const dark = solveDaylight(darkRoom)
  const redWest = solveDaylight({ ...darkRoom, wallReflectance: { west: [.8, 0, 0] } })
  assert.ok(redWest.meanIrradiance > dark.meanIrradiance)
  let redIncrease = 0
  for (let i = 0; i < dark.coefficients.length; i += 4) {
    redIncrease += Math.abs(redWest.coefficients[i] - dark.coefficients[i])
    assert.equal(redWest.coefficients[i + 1], dark.coefficients[i + 1])
    assert.equal(redWest.coefficients[i + 2], dark.coefficients[i + 2])
  }
  assert.ok(redIncrease > 0)
  assert.deepEqual(solveDaylight({ ...base, wallReflectance: { north: grey, south: grey, east: grey, west: grey } }), solveDaylight(base))
})

test('a sealed room receives no outdoor light, even with a bright sun and sky', () => {
  const result = solveDaylight({ ...base, windows: [], sunIntensity: 100 })
  assert.equal(result.meanIrradiance, 0)
  assert.ok(result.coefficients.every(value => value === 0))
})

test('night is dark without lamps, regardless of windows or reflective surfaces', () => {
  const result = solveDaylight({ ...base, skyRadiance: black, sunIntensity: 0 })
  assert.equal(result.meanIrradiance, 0)
  assert.ok(result.coefficients.every(value => value === 0))
})

test('a window facing away from the sun still admits diffuse sky daylight', () => {
  const result = solveDaylight({ ...base, windows: [{ ...base.windows[0], wall: 'north' }] })
  assert.ok(result.meanIrradiance > 0.025, `Diffuse daylight was ${result.meanIrradiance}`)
})

test('Lambertian bounces illuminate the room beyond direct sky visibility', () => {
  const directSky = solveDaylight({ ...base, bounces: 0 })
  const bounced = solveDaylight(base)
  assert.ok(bounced.meanIrradiance > directSky.meanIrradiance * 1.4)
})

test('black surfaces remove reflected daylight while retaining directly visible sky', () => {
  const directSky = solveDaylight({ ...base, bounces: 0 })
  const absorbed = solveDaylight({ ...base,
    surfaceReflectance: { floor: black, wall: black, ceiling: black },
  })
  assert.deepEqual(absorbed.coefficients, directSky.coefficients)
})

test('doubling source radiance doubles computed irradiance before tone mapping', () => {
  const original = solveDaylight({ ...base, sunIntensity: 3 })
  const doubled = solveDaylight({ ...base, sunIntensity: 6, skyRadiance: [2, 2, 2] })
  assert.ok(Math.abs(doubled.meanIrradiance / original.meanIrradiance - 2) < 1e-6)
  original.coefficients.forEach((value, i) => {
    assert.ok(Math.abs(doubled.coefficients[i] - value * 2) < 1e-6)
  })
})

test('an opaque furniture proxy covering the window prevents sky leakage', () => {
  const blocked = solveDaylight({ ...base, boxes: [{
    min: [2.3, 0, -2], max: [2.5, 2.7, 2], reflectance: grey,
  }] })
  assert.equal(blocked.meanIrradiance, 0)
})

test('solar next-event estimation adds bounced sun, excluding direct sun from probes', () => {
  const directOnly = solveDaylight({ ...base, skyRadiance: black, sunIntensity: 10, bounces: 0 })
  const bouncedSun = solveDaylight({ ...base, skyRadiance: black, sunIntensity: 10 })
  assert.equal(directOnly.meanIrradiance, 0)
  assert.ok(bouncedSun.meanIrradiance > 0.02)
})

test('source-free boxes cannot emit energy and unsafe reflectances are bounded', () => {
  const tooBright = solveDaylight({ ...base, surfaceReflectance: {
    floor: [2, 2, 2], wall: [2, 2, 2], ceiling: [2, 2, 2],
  } })
  const bounded = solveDaylight({ ...base, surfaceReflectance: {
    floor: [0.9, 0.9, 0.9], wall: [0.9, 0.9, 0.9], ceiling: [0.9, 0.9, 0.9],
  } })
  assert.deepEqual(tooBright.coefficients, bounded.coefficients)
  // With only a unit-radiance exterior source, all path throughputs are <=1.
  assert.ok(bounded.meanIrradiance < Math.PI)
})

test('identical inputs produce deterministic, finite SH coefficients with unused alpha', () => {
  const a = solveDaylight(base)
  const b = solveDaylight(base)
  assert.deepEqual(a, b)
  assert.equal(a.coefficients.length, 3 * 3 * 3 * 16)
  assert.ok(a.coefficients.every(Number.isFinite))
  a.coefficients.forEach((value, i) => { if (i % 4 === 3) assert.equal(value, 0) })
})

test('probes embedded in solid furniture are relocated without NaNs or trapped rays', () => {
  const result = solveDaylight({ ...base, boxes: [{
    min: [-1, 0, -1], max: [1, 1.7, 1], reflectance: grey,
  }] })
  assert.ok(result.meanIrradiance > 0)
  assert.ok(result.coefficients.every(Number.isFinite))
  const full = solveDaylight({ ...base, boxes: [{
    min: [-2.5, 0, -2], max: [2.5, 2.7, 2], reflectance: grey,
  }] })
  assert.equal(full.meanIrradiance, 0)
})

test('transport rejects invalid room dimensions instead of sending broken GPU data', () => {
  assert.throws(() => solveDaylight({ ...base, width: NaN }), /room dimensions/)
})

const eastDoor: NonNullable<TransportInput['doors']>[number] = {
  wall: 'east', offset: 0.5, width: 0.9, height: 2.1, sill: 0,
}

test('an open door admits diffuse daylight and closing the last opening seals the room', () => {
  const open = solveDaylight({ ...base, windows: [], doors: [eastDoor] })
  const closed = solveDaylight({ ...base, windows: [], doors: [], sunIntensity: 10 })
  assert.ok(open.meanIrradiance > 0.025)
  assert.equal(closed.meanIrradiance, 0)
  assert.ok(closed.coefficients.every(value => value === 0))
})

test('open doors admit bounced direct sunlight on every sun-facing wall', () => {
  for (const [wall, direction] of [
    ['east', [1, 0.4, 0]], ['west', [-1, 0.4, 0]],
    ['north', [0, 0.4, -1]], ['south', [0, 0.4, 1]],
  ] as const) {
    const input: TransportInput = { ...base, windows: [], doors: [{ ...eastDoor, wall }],
      skyRadiance: black, sunIntensity: 10, sunDirection: [...direction] }
    const facing = solveDaylight(input)
    const away = solveDaylight({ ...input, sunDirection: [-direction[0], direction[1], -direction[2]] })
    assert.ok(facing.meanIrradiance > 0.01, `${wall} door did not admit sunlight`)
    assert.equal(away.meanIrradiance, 0, `${wall} door leaked sun from the opposite wall`)
  }
})

test('an open doorway remains dark at night and opaque furniture can block it', () => {
  const night = solveDaylight({ ...base, windows: [], doors: [eastDoor], skyRadiance: black })
  assert.equal(night.meanIrradiance, 0)
  const blocked = solveDaylight({ ...base, windows: [], doors: [eastDoor], sunIntensity: 10,
    boxes: [{ min: [2.3, 0, -2], max: [2.5, 2.7, 2], reflectance: grey }] })
  assert.equal(blocked.meanIrradiance, 0)
})

test('doorway centers have no window mullion and admit unfiltered sky through a central gap', () => {
  // Two opaque screens leave a narrow gap along the opening's centerline.
  // The same rays are blocked by the center mullion when this aperture is glazing.
  const screened: TransportInput = { ...base, windows: [], doors: [eastDoor],
    resolution: [7, 4, 7], samples: 1024, bounces: 0,
    boxes: [
      { min: [2.48, 0, -2], max: [2.51, 2.7, -0.01], reflectance: black },
      { min: [2.48, 0, 0.01], max: [2.51, 2.7, 2], reflectance: black },
    ],
  }
  const door = solveDaylight(screened)
  const window = solveDaylight({ ...screened, windows: [eastDoor], doors: [] })
  assert.ok(door.meanIrradiance > 0, 'The central doorway gap should admit sky')
  assert.equal(window.meanIrradiance, 0, 'The window mullion should block the central gap')
  const unglazed = solveDaylight({ ...base, windows: [], doors: [eastDoor], bounces: 0 })
  const glazed = solveDaylight({ ...base, windows: [eastDoor], bounces: 0 })
  assert.ok(unglazed.meanIrradiance > glazed.meanIrradiance / 0.82,
    'Open doors should avoid both glass attenuation and the window mullion')
})
