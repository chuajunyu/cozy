import type { Product } from './catalog.ts'

export function daylightExposure(meanIrradiance: number) {
  return meanIrradiance > .001 ? Math.min(32, Math.max(1, .9 / meanIrradiance)) : 32
}

export function fixtureOutput(product: Product) {
  return product.lighting?.output ?? {
    lumens: product.lighting?.mount === 'ceiling' ? 1055 : 470,
    evidence: 'Assumed standard bulb output for this preview; verify the installed bulb.',
  }
}

// The sun/sky renderer uses artistic units, so absolute outdoor lux cannot
// calibrate indoor bulbs. Use one fixed preview gain for every fixture while
// retaining lumen ratios and inverse-square falloff. A 470 lm bulb has intensity
// ≈0.37: visible on nearby surfaces without changing the exposure of daylight.
// This is an illustrative appearance scale, not a photometric conversion.
export function fixtureIntensity(product: Product) {
  return fixtureOutput(product).lumens / (4 * Math.PI) * .01
}

// Bright outdoor diffuse sky, kept independent of whether a window faces the sun.
// This artistic sky preset is 3.25× the previous diffuse source, not added ambient.
export function diffuseSkyRadiance(sunIntensity: number) {
  return Math.max(0, sunIntensity) * .65 / Math.PI
}
