import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daylightExposure, diffuseSkyRadiance, fixtureIntensity, fixtureOutput } from './lighting.ts'
import type { Product } from './catalog.ts'

const lamp = (lumens: number): Product => ({ id: 'lamp', name: 'Lamp', category: 'Lighting', price: 1, parts: [], dimensions: [.2, .4, .2], lighting: { mount: 'surface', colorMode: 'fixed', dimmable: false, evidence: 'Test', output: { lumens, evidence: 'Published output' } } })

test('fixture output preserves published lumen ratios on the preview scale', () => {
  assert.equal(fixtureOutput(lamp(85)).lumens, 85)
  assert.ok(Math.abs(fixtureIntensity(lamp(470)) / fixtureIntensity(lamp(50)) - 9.4) < 1e-10)
  assert.ok(Math.abs(fixtureIntensity(lamp(1055)) / fixtureIntensity(lamp(470)) - 1055 / 470) < 1e-10)
})

test('ordinary bulbs visibly light nearby surfaces while outdoor sunlight stays stronger', () => {
  const bulbIntensity = fixtureIntensity(lamp(470))
  // Inverse-square falloff must still leave visible illumination three metres
  // away at the fixed night exposure. At one metre, direct irradiance equals
  // point intensity and should stay below 15% of the 3.2-unit noon solar beam.
  assert.ok(bulbIntensity / (3 * 3) > .03, 'A switched-on bulb should illuminate more than its immediate base')
  assert.ok(bulbIntensity < .15 * 3.2, 'A bulb must not wash out the outdoor sunlight')
})

test('existing daylight stays additive at unchanged exposure when fixtures are enabled', () => {
  for (const daylight of [.01, .1, 1]) {
    const exposure = daylightExposure(daylight)
    const before = daylight * exposure
    const after = (daylight + fixtureIntensity(lamp(470))) * exposure
    assert.ok(after > before)
  }
  assert.equal(daylightExposure(0), 32, 'Night exposure is fixed independently of fixture switches')
  assert.equal(daylightExposure(0), daylightExposure(.0011), 'Exposure must not jump when a tiny amount of daylight enters')
})

test('afternoon diffuse source remains strong without a sun-facing window', () => {
  const middaySun = 3.2 * Math.pow(Math.sin((13.5 - 6) / 12 * Math.PI), .4)
  assert.ok(diffuseSkyRadiance(middaySun) > .6)
  assert.equal(diffuseSkyRadiance(0), 0)
})
