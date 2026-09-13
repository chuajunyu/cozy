import type { Item, Product, Scene } from './catalog'
import { bulbProfiles, lightingPresets, type BulbProfile, type LightingPreset } from './lighting'

export type LightingDraft = { revision: number; name: string; sunHour: number; fixtures: Record<string, NonNullable<Item['light']>> }
export function lightingDraft(scene: Scene, catalog: Product[], preset: LightingPreset): LightingDraft {
  const definition = lightingPresets[preset]
  const profile = definition.profile as BulbProfile | null
  return { revision: scene.revision ?? 0, name: definition.label, sunHour: definition.sunHour,
    fixtures: Object.fromEntries(scene.items.flatMap(item => {
      const product = catalog.find(p => p.id === item.productId)
      if (!product?.lighting) return []
      const settings = { brightness: .7, color: '#ffd3a0', ...item.light, on: definition.on }
      if (profile && product.lighting.colorMode !== 'fixed') {
        settings.color = bulbProfiles[profile].color
        settings.bulbProfile = product.lighting.colorMode === 'bulb-dependent' ? profile : null
      }
      return [[item.id, settings]]
    })) }
}

export default function LightingPresets({ scene, catalog, draft, onPreview, onApply }: {
  scene: Scene; catalog: Product[]; draft: LightingDraft | null
  onPreview: (draft: LightingDraft | null) => void; onApply: () => void
}) {
  return <section className="lighting-presets" aria-label="Lighting presets">
    <h3>Set the mood</h3>
    <div className="preset-cards">{(Object.keys(lightingPresets) as LightingPreset[]).map(key =>
      <button key={key} aria-pressed={draft?.name === lightingPresets[key].label} onClick={() => onPreview(lightingDraft(scene, catalog, key))}>{lightingPresets[key].label}</button>)}</div>
    <p className="muted">Preview with existing lights. Bulb choices and output are illustrative, not purchasable products.</p>
    {draft && <div className="lighting-preview">
      <strong>{draft.name}</strong><p className="muted">Sunlight at {draft.sunHour > 12 ? draft.sunHour - 12 : draft.sunHour}{draft.sunHour >= 12 ? ' pm' : ' am'}</p>
      {!Object.keys(draft.fixtures).length && <p className="muted">No lamps in this room. Evening lighting needs an existing lamp.</p>}
      {Object.entries(draft.fixtures).map(([id, settings]) => {
        const item = scene.items.find(i => i.id === id)!
        const product = catalog.find(p => p.id === item.productId)!
        const mode = product.lighting!.colorMode
        const update = (light: NonNullable<Item['light']>) => onPreview({ ...draft, name: 'Custom', fixtures: { ...draft.fixtures, [id]: light } })
        return <div className="preset-fixture" key={id}>
          <label><input type="checkbox" checked={settings.on} onChange={e => update({ ...settings, on: e.target.checked })} /> {product.name}</label>
          {mode === 'bulb-dependent' ? <label>Simulated bulb<select value={settings.bulbProfile ?? ''} onChange={e => {
            const profile = e.target.value as BulbProfile
            update({ ...settings, bulbProfile: profile, color: bulbProfiles[profile].color })
          }}><option value="" disabled>Existing bulb</option>{Object.entries(bulbProfiles).map(([key, profile]) => <option key={key} value={key}>{profile.label} · {profile.kelvin}K</option>)}</select></label> :
            <small>{mode === 'fixed' ? 'Fixed color and output retained.' : 'Supported white-light setting; fixture output retained.'}</small>}
        </div>
      })}
      <div className="detail-actions"><button className="primary" onClick={onApply}>Apply lighting</button><button onClick={() => onPreview(null)}>Cancel preview</button></div>
    </div>}
  </section>
}
