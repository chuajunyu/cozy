import definitions from '../../data/bulb-profiles.json'
import type { Item } from './catalog.ts'
import type { Product } from './catalog.ts'

export function daylightExposure(meanIrradiance: number) {
  return meanIrradiance > .001 ? Math.min(32, Math.max(1, .9 / meanIrradiance)) : 32
}

export const bulbProfiles = definitions.profiles
export const lightingPresets = definitions.presets
export type BulbProfile = keyof typeof bulbProfiles
export type LightingPreset = keyof typeof lightingPresets
export function fixtureColor(product: Product, settings?: Item['light']) {
  return product.lighting?.colorMode === 'fixed' ? '#ffd3a0' : settings?.bulbProfile && product.lighting?.colorMode === 'bulb-dependent' ? bulbProfiles[settings.bulbProfile].color : settings?.color ?? '#ffd3a0'
}
export function fixtureOutput(product: Product, settings?: Item['light']) {
  if (settings?.bulbProfile && product.lighting?.colorMode === 'bulb-dependent') return {
    lumens: definitions.lumens[product.lighting.mount], evidence: 'Simulated bulb output; not a verified product specification.',
  }
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
export function fixtureIntensity(product: Product, settings?: Item['light']) {
  return fixtureOutput(product, settings).lumens / (4 * Math.PI) * .01
}

// Bright outdoor diffuse sky, kept independent of whether a window faces the sun.
// This artistic sky preset is 3.25× the previous diffuse source, not added ambient.
export function diffuseSkyRadiance(sunIntensity: number) {
  return Math.max(0, sunIntensity) * .65 / Math.PI
}

export function validBulbSettings(product: Product, settings: NonNullable<Item['light']>) {
  if (!product.lighting || !/^#[0-9a-f]{6}$/i.test(settings.color)) return false
  if (settings.bulbProfile && (product.lighting.colorMode !== 'bulb-dependent' || !(settings.bulbProfile in bulbProfiles) || bulbProfiles[settings.bulbProfile].color !== settings.color.toLowerCase())) return false
  if (product.lighting.colorMode === 'fixed') return settings.color.toLowerCase() === '#ffd3a0'
  return product.lighting.colorMode !== 'white-spectrum' || Object.values(bulbProfiles).some(p => p.color === settings.color.toLowerCase())
}
