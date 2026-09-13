import VariantsPanel from './VariantsPanel'
import LightingPresets, { type LightingDraft } from './LightingPresets'
import BudgetControls from './BudgetControls'
import WindowControls from './WindowControls'
import { presetWindow, windowPresets } from './windowPresets'
import RoomCustomization, { WallLightControls } from './RoomCustomization'
import { isWallFixture, normalizeWallFixture } from './wallFixtures'
import { fixtureOutput, validBulbSettings } from './lighting'
import { acceptsSupport, supportPosition, isAnchored, settleItem, settleScene, validItemGeometry } from './placement'

const dimensionCm = (meters: number) => Number((meters * 100).toFixed(1))
const mattressSize = (width: number, depth: number) => `${Math.round(width * 100)} × ${Math.round(depth * 100)} cm`
import SunlightControls from './SunlightControls'
import { worldBackground } from './worldBackground'
import { defaultWindows, validWindows, type Wall, type RoomWindow } from './sunlight'
import { walls } from './sunlight'
import { normalizeDoor, validDoors } from './doors'
import DoorControls from './DoorControls'
import Alternatives from './FurnitureAlternatives'
import { findAlternatives, replaceItem } from './alternatives'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Room from './Room'
import PanelHost from './PanelHost'
import { escapeWorkspace, type Panel } from './workspace'
import {
  filterProducts,
  toStudioProduct,
  validPlacement,
  type Item,
  type Product,
  type Scene,
} from './catalog'
import { useConnection } from './useConnection'
import AgentPanel from './AgentPanel'
import type { Command } from './types'

const money = (n: number) =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 2,
  }).format(n)
const symbols: Record<string, string> = {
  Workspace: '▤',
  Bedroom: '▰',
  Living: '▱',
  Storage: '▥',
  Decor: '▧',
}
function ProductArt({ product }: { product: Product }) {
  if (product.thumbnailUrl)
    return <img src={product.thumbnailUrl} alt={product.name} loading="lazy" />
  const color = product.parts[0]?.color ?? '#aabc9b'
  return (
    <svg viewBox="0 0 160 100" aria-hidden="true">
      <ellipse cx="80" cy="83" rx="49" ry="9" fill="#d8d2c4" opacity=".45" />
      {product.door ? (
        <>
          <path d="M49 88V13h61v75h-7V20H56v68Z" fill="#bca789" />
          <path d="M57 21 98 29v62L57 83Z" fill={color} />
          <path d="M64 31 89 36v23l-25-4Z M64 62l25 4v15l-25-5Z" fill="none" stroke="#b6a68e" strokeWidth="2" />
          <circle cx="91" cy="61" r="2.4" fill="#7a745e" />
        </>
      ) : product.category === 'Bedroom' ? (
        <>
          <path d="M27 39 91 22 135 46 71 65Z" fill="#ede7db" />
          <path d="M27 39v24l44 22V65Z" fill={color} />
          <path d="m71 65 64-19v23L71 85Z" fill="#a38d70" />
          <path d="m51 51 61-18 23 13-64 19Z" fill="#98a185" />
          <path d="m30 39 16-5 16 8-16 5Z" fill="white" />
        </>
      ) : product.category === 'Storage' ? (
        <>
          <path d="m48 21 44-10 23 13v61l-44 11-23-14Z" fill={color} />
          <path d="m55 29 37-9v53l-37 9Z" fill="#776850" />
          {[35, 53, 71].map((y) => (
            <path key={y} d={`m55 ${y} 37-9 11 6-38 10Z`} fill="#d4b58d" />
          ))}
        </>
      ) : product.wire?.category === 'sofa' || product.id === 'sample-sofa' ? (
        <>
          <path d="m25 46 75-18 34 22v28L57 96 25 74Z" fill={color} />
          <path d="m36 49 62-15 25 16-64 16Z" fill="#a8b39a" />
          <path d="m35 60 65-16 22 14-64 17Z" fill="#b1baa6" />
        </>
      ) : product.category === 'Decor' ? (
        <path d="m21 56 77-22 44 29-78 23Z" fill={color} />
      ) : (
        <>
          <path d="m30 44 65-18 38 21-65 20Z" fill={color} />
          <path d="m30 44 38 23 65-20v7L68 73 30 51Z" fill="#9e805f" />
          {[
            [35, 51],
            [67, 70],
            [125, 54],
            [95, 39],
          ].map(([x, y]) => (
            <path key={x} d={`M${x} ${y}v23l5 3V${y + 2}Z`} fill="#a68c6e" />
          ))}
          {(product.wire?.category === 'chair' || product.id === 'sample-chair') && (
            <path d="m33 41 63-18V7L33 24Z" fill="#697360" />
          )}
        </>
      )}
    </svg>
  )
}
export default function App() {
  const [selected, setSelectedId] = useState<string | null>(null)
  const [selectedWindow, setSelectedWindow] = useState<Wall | null>(null)
  const setSelected = (id: string | null) => { setSelectedId(id); setSelectedWindow(null) }
  const [panel, setPanel] = useState<Panel>(null)
  const [expanded, setExpanded] = useState(false)
  const [started, setStarted] = useState(false)
  const [fitRequest, setFitRequest] = useState(0)
  const returnFocus = useRef<HTMLElement | null>(null)
  function openPanel(next: Panel) {
    if (next !== 'astra') setSelectedVariant(null)
    if (!panel) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setLightingPreview(null)
    setSunPreview(null)
    setPanel(next)
    setExpanded(false)
    setStarted(true)
  }
  function closePanel() {
    setSelectedVariant(null)
    setLightingPreview(null)
    setSunPreview(null)
    setPanel(null)
    setExpanded(false)
    returnFocus.current?.focus()
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
      const next = escapeWorkspace(panel, selected)
      if (panel) closePanel()
      else setSelected(next.selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, selected])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [source, setSource] = useState('IKEA')
  const [color, setColor] = useState('All')
  const [feature, setFeature] = useState('All')
  const [productType, setProductType] = useState('All')
  const [maxPrice, setMaxPrice] = useState('')


  const [top, setTop] = useState(false)
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [lightingPreview, setLightingPreview] = useState<LightingDraft | null>(null)
  const [sunPreview, setSunPreview] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const connection = useConnection()
  const { state, catalog: wireCatalog, status, send, reconnect, error, pending, backup, restore, recoveryError, diagnostic, resetRoom } = connection
  const candidates = connection.variants?.candidates ?? []
  const previewCandidate = candidates.find(c => c.id === selectedVariant && c.status === 'ready')
  const capturing = previewCandidate?.state && !(previewCandidate.id in thumbnails) ? previewCandidate : undefined
  const previewState = previewCandidate?.state
  useEffect(() => { setSelectedVariant(null); setThumbnails({}) }, [connection.variants?.id])
  useEffect(() => {
    if (!connection.adoptedIdea) return
    setSelectedVariant(null)
    setSelectedId(null)
    setSelectedWindow(null)
    setLightingPreview(null)
    setSunPreview(null)
  }, [connection.adoptedIdea])
  function adoptIdea(id: string) {
    return send({ type: 'variants.adopt', setId: connection.variants?.id, candidateId: id })
  }
  const catalog = useMemo(() => [...wireCatalog, ...(previewCandidate?.products ?? []).filter(p => !wireCatalog.some(existing => existing.id === p.id))].map(toStudioProduct), [wireCatalog, previewCandidate?.products])
  useEffect(() => { setNotice('') }, [state?.revision])
  const scene: Scene = useMemo(() => ({
    width: state?.room.width ?? 4, depth: state?.room.depth ?? 3.5, height: state?.room.height ?? 2.6,
    wallpapers: state?.room.wallpapers, floorColor: state?.room.floorColor, wallColors: state?.room.wallColors, windows: state?.room.windows, sunHour: state?.room.sunHour, revision: state?.revision, daylight: state?.room.daylight ?? 1, budget: state?.budget ?? 0,
    items: Object.values(state?.slots ?? {}).filter(s => s.catalogId).map(s => ({
      id: s.id, productId: s.catalogId!, x: s.x, z: s.z, rotation: s.rotation, locked: s.locked,
      wallMount: s.wallMount ?? undefined, supportId: s.supportId ?? undefined, door: s.door ?? undefined, elevation: s.elevation, light: s.light ?? undefined,
    })),
  }), [state])
  useEffect(() => {
    if (lightingPreview && lightingPreview.revision !== state?.revision) { setLightingPreview(null); setNotice('Room changed; preview the preset again.') }
  }, [state?.revision, lightingPreview])
  const variantScene: Scene | null = previewState ? { ...previewState.room, revision: previewState.revision, budget: previewState.budget ?? 0,
    items: Object.values(previewState.slots).filter(s => s.catalogId).map(s => ({ id: s.id, productId: s.catalogId!, x: s.x, z: s.z, rotation: s.rotation, locked: true, elevation: s.elevation, light: s.light ?? undefined, supportId: s.supportId ?? undefined, wallMount: s.wallMount ?? undefined, door: s.door ?? undefined })) } : null
  const litScene = lightingPreview ? { ...scene, sunHour: lightingPreview.sunHour, items: scene.items.map(i => ({ ...i, light: lightingPreview.fixtures[i.id] ?? i.light })) } : scene
  const reviewCount = connection.reviewCount + wireCatalog.filter(p => !p.readyForPreview).length
  function edit(command: Command) {
    if (previewState) { setNotice('Use this design before editing it.'); return false }
    if (backup) return false
    return send({ ...command, baseRevision: command.baseRevision ?? state?.revision })
  }
  const item = scene.items.find((i) => i.id === selected)
  const activeWindow = (scene.windows ?? defaultWindows).find(window => window.wall === selectedWindow)
  const product = catalog.find((p) => p.id === item?.productId)
  const mattressSupport = item?.supportId ? catalog.find(p => p.id === scene.items.find(i => i.id === item.supportId)?.productId)?.placement?.support : undefined
  const bedMattresses = product?.placement?.support?.kind === 'mattress' ? catalog.filter(p => p.placement?.surfaceKind === 'mattress' && acceptsSupport(product, p))
    .sort((a, b) => b.dimensions[0] * b.dimensions[2] - a.dimensions[0] * a.dimensions[2] || a.price - b.price) : []
  const attachedMattress = product?.placement?.support?.kind === 'mattress' ? scene.items.find(i => i.supportId === item?.id && catalog.find(p => p.id === i.productId)?.placement?.surfaceKind === 'mattress') : undefined
  const attachedMattressProduct = catalog.find(p => p.id === attachedMattress?.productId)
  const looseMattresses = product?.placement?.support?.kind === 'mattress' ? scene.items.filter(i => !i.supportId && !i.locked && bedMattresses.some(p => p.id === i.productId)) : []
  const alternativeOptions = useMemo(() => item && product ? findAlternatives(product, catalog).map(option => ({
    product: option,
    error: replaceItem(scene, item.id, option, catalog).error,
  })) : [], [item, product, catalog, scene])
  function tryAlternative(replacement: Product) {
    if (!item || !product) return
    const result = replaceItem(scene, item.id, replacement, catalog)
    if (result.error) { setNotice(result.error); return }
    if (result.scene === scene) return
    edit({ type: 'item.replace', slotId: item.id, expectedProduct: item.productId, catalogId: replacement.id })
    setNotice(`${replacement.name} is now in your room. Undo restores ${product.name}.`)
  }
  const alternativesPanel = item && product && !product.door ? (
    <Alternatives key={item.id} item={item} product={product} options={alternativeOptions} onReplace={tryAlternative} renderArt={p => <ProductArt product={p} />} formatPrice={money} />
  ) : null
  const total = scene.items.reduce(
    (n, i) => n + (catalog.find((p) => p.id === i.productId)?.price ?? 0),
    0,
  )
  function commit(next: Scene): boolean {
    // UI gestures express one direct edit. The server computes every dependent move.
    const added = next.items.filter(i => !scene.items.some(old => old.id === i.id))
    const removed = scene.items.filter(i => !next.items.some(n => n.id === i.id))
    const changed = next.items.filter(i => scene.items.some(old => old.id === i.id && JSON.stringify(i) !== JSON.stringify(old)))
    if (added.length + removed.length + changed.length > 1) { setNotice('Choose one direct edit; attached objects move together automatically.'); return false }
    if (added.length) {
      const i = added[0]
      return edit({ type: 'item.add', slotId: i.id, catalogId: i.productId, x: i.x, z: i.z, rotation: i.rotation, elevation: i.elevation, light: i.light, supportId: i.supportId ?? null, door: i.door, wallMount: i.wallMount })
    }
    if (removed.length) return edit({ type: 'item.delete', slotId: removed[0].id, expectedProduct: removed[0].productId })
    if (changed.length) {
      const i = changed[0], old = scene.items.find(o => o.id === i.id)!
      if (old.locked !== i.locked) return edit({ type: 'item.lock', slotIds: [i.id], expectedProducts: { [i.id]: old.productId }, locked: i.locked })
      if (JSON.stringify(old.light) !== JSON.stringify(i.light)) return edit({ type: 'fixture.update', slotId: i.id, expectedProduct: old.productId, light: i.light })
      if (i.wallMount) return edit({ type: 'item.update', slotId: i.id, expectedProduct: old.productId, wallMount: i.wallMount })
      if (i.door) return edit({ type: 'item.update', slotId: i.id, expectedProduct: old.productId, door: i.door, wallMount: i.wallMount })
      return edit({ type: 'item.update', slotId: i.id, expectedProduct: old.productId, x: i.x, z: i.z, rotation: i.rotation, elevation: i.elevation, supportId: i.supportId ?? null })
    }
    return !!state && edit({ type: 'room.update', room: { ...state.room, wallpapers: next.wallpapers, floorColor: next.floorColor, wallColors: next.wallColors, width: next.width, depth: next.depth, height: next.height ?? state.room.height, windows: next.windows ?? defaultWindows, sunHour: next.sunHour ?? 9 }, budget: next.budget || null })
  }
  function move(next: Item) {
    const attempted = { ...scene, items: scene.items.map(i => i.id === next.id ? next : i) }
    const preview = settleScene(attempted, scene, catalog)
    if (preview.error) {
      const moving = catalog.find(p => p.id === next.productId)
      setNotice(moving && isWallFixture(moving)
        ? 'Keep the wall object inside the wall, clear of windows, doors and other furniture.'
        : moving?.placement?.surfaceKind === 'mattress'
        ? `This mattress is ${mattressSize(moving.dimensions[0], moving.dimensions[2])}. Drop it over an empty bed with a deck at least this size, or choose a bed under Mattress placement. It keeps its actual size and cannot overhang the frame.`
        : moving && !validItemGeometry(next, moving, scene, catalog)
        ? `${moving.name} does not fit fully inside the room at this angle.`
        : moving && !validDoors(attempted, catalog)
        ? `Keep ${moving.name} clear of the area needed for the door to swing open.`
        : preview.error)
      return
    }
    const landed = preview.scene.items.find(i => i.id === next.id)!
    if (commit({ ...scene, items: scene.items.map(i => i.id === next.id ? landed : i) })) {
      setNotice((next.elevation ?? 0) > (landed.elevation ?? 0) ? 'Settled onto ' + (landed.supportId ? 'the supporting surface.' : 'the floor.') : '')
    }
  }
  function changeWindow(wall: Wall, next: RoomWindow) {
    const updated = { ...scene, windows: (scene.windows ?? defaultWindows).map(window => window.wall === wall ? next : window) }
    if (!validWindows(updated.windows, updated) || settleScene(updated, scene, catalog).error) {
      setNotice('Keep the window within the wall and clear of doors and wall objects. Choose a wall without another window.')
      return
    }
    if (commit(updated)) setSelectedWindow(next.wall)
  }
  function addWindow(id: string) {
    if (status !== 'connected' || pending || backup) return
    const windows = scene.windows ?? defaultWindows
    for (const wall of ['north', 'west', 'east', 'south'] as Wall[]) {
      if (windows.some(window => window.wall === wall)) continue
      for (const offset of [.5, .25, .75, 0, 1]) {
        const window = presetWindow(id, scene, wall, offset)
        const updated = { ...scene, windows: [...windows, window] }
        if (validWindows(updated.windows, updated) && !settleScene(updated, scene, catalog).error && commit(updated)) {
          setSelectedId(null); setSelectedWindow(wall); if (panel !== 'catalog') closePanel(); return
        }
      }
    }
    setNotice('No clear wall fits this window. Select an existing window to change its style, or make room along another wall.')
  }
  function add(p: Product) {
    if (status !== 'connected' || pending || backup) return
    if (isWallFixture(p)) {
      if (p.lighting && scene.items.filter(i => catalog.find(q => q.id === i.productId)?.lighting).length >= 8) { setNotice('A room supports eight light fixtures.'); return }
      const id = crypto.randomUUID()
      for (const wall of walls) for (const height of [1.7, 2.35, 1.2]) for (const offset of [.5, .25, .75, .1, .9, 0, 1]) {
        const lamp = normalizeWallFixture({ id, productId: p.id, x: 0, z: 0, rotation: 0, locked: false, wallMount: { wall, offset, height }, ...(p.lighting ? { light: { on: true, brightness: 1, color: '#ffd3a0' } } : {}) }, p, scene)
        const next = { ...scene, items: [...scene.items, lamp] }
        if (!settleScene(next, scene, catalog).error && commit(next)) { setSelected(id); if (panel !== 'catalog') openPanel('details'); return }
      }
      setNotice('No clear wall position fits this piece. Move furniture or adjust the openings first.')
      return
    }
    if (p.door) {
      const id = crypto.randomUUID()
      const offsets = [.5, .25, .75, 0, 1, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20)]
      for (const wall of walls) for (const offset of offsets) {
        const door = normalizeDoor({ id, productId: p.id, x: 0, z: 0, rotation: 0, locked: false, door: { wall, offset, open: false } }, p, scene)
        const next = { ...scene, items: [...scene.items, door] }
        if (validDoors(next, catalog) && !settleScene(next, scene, catalog).error && commit(next)) {
          setSelected(id)
          if (panel !== 'catalog') closePanel()
          setNotice('Door added. Drag it along the wall to position it.')
          return
        }
      }
      setNotice('No clear doorway fits. Leave space along a wall for the door and its inward swing, away from windows and furniture.')
      return
    }
    if (p.placement?.surfaceKind === 'mattress' && item && product && /\b(bed|bedframe|daybed)\b/i.test(`${product.productType ?? ''} ${product.name}`) && !acceptsSupport(product, p)) {
      const deck = product.placement?.support
      setNotice(deck
        ? `This mattress is ${mattressSize(p.dimensions[0], p.dimensions[2])}; ${product.name} has a ${mattressSize(deck.width, deck.depth)} deck. Choose a smaller mattress or a larger frame. Mattresses keep their actual dimensions.`
        : `${product.name} has no empty mattress deck available. Choose a bed frame with a mattress deck; the sample Sunday bed already includes its mattress.`)
      return
    }
    if (
      p.lighting &&
      scene.items.filter(
        (i) => catalog.find((q) => q.id === i.productId)?.lighting,
      ).length >= 8
    ) {
      setNotice('This preview supports up to eight light fixtures per room.')
      return
    }
    if (
      (p.lighting?.mount === 'surface' || p.placement?.mode === 'surface') &&
      item &&
      product &&
      acceptsSupport(product, p)
    ) {
      const lamp: Item = {
        id: crypto.randomUUID(),
        productId: p.id,
        ...supportPosition(item, product),
        locked: false,
        ...(p.lighting ? { light: { on: true, brightness: 0.7, color: '#ffd3a0' } } : {}),
      }
      const supported = settleItem(lamp, scene, catalog)
      if (supported && commit({ ...scene, items: [...scene.items, supported] })) {
        setSelected(p.placement?.surfaceKind === 'mattress' ? item.id : lamp.id)
        if (panel !== 'catalog') closePanel()
        setNotice(
          p.placement?.surfaceKind === 'mattress' ? 'Attaching the mattress to the selected bed.' : `Placing ${p.name} on the selected surface.`,
        )
        return
      }
      if (p.placement?.surfaceKind === 'bouquet') {
        setNotice('This vase is occupied or the arrangement overlaps something nearby. Remove its flowers or clear space first.')
        return
      }
      if (p.placement?.surfaceKind === 'mattress') {
        setNotice('The bed deck is occupied or blocked. Move its existing mattress or nearby obstruction before placing another mattress.')
        return
      }
    }

    if (scene.items.length >= 100) {
      setNotice('This room has reached its 100-item limit.')
      return
    }
    for (let z = -scene.depth / 2 + 0.2; z < scene.depth / 2; z += 0.2)
      for (let x = -scene.width / 2 + 0.2; x < scene.width / 2; x += 0.2) {
        const next: Item = {
          id: crypto.randomUUID(),
          productId: p.id,
          x,
          z,
          rotation: 0,
          locked: false,
          elevation:
            p.lighting?.mount === 'ceiling'
              ? Math.max(0, (scene.height ?? 2.6) - p.dimensions[1])
              : 0,
          ...(p.lighting
            ? { light: { on: true, brightness: 0.7, color: '#ffd3a0' } }
            : {}),
        }
        if (validPlacement(next, scene, catalog) && commit({ ...scene, items: [...scene.items, next] })) {
          setSelected(next.id)
          if (panel !== 'catalog') closePanel()
          setNotice(`Placing ${p.name}...`)
          return
        }
      }
    setNotice(
      'No clear space for this product. Move an item or enlarge your room.',
    )
  }
  function resize(key: 'width' | 'depth' | 'height', value: number) {
    commit({ ...scene, [key]: value })
  }
  const completeIkea = catalog.filter(
    (p) => p.id.startsWith('ikea-') && p.readyForPreview === true,
  )
  const sourceProducts =
    source === 'IKEA'
      ? completeIkea
      : catalog.filter((p) => source === 'Room elements' ? !!p.door : source === 'Brand references' ? p.id.startsWith('reference-') : !p.id.startsWith('ikea-') && !p.id.startsWith('reference-') && !p.door)
  const visible = filterProducts(catalog, {
    source,
    query: search,
    category,
    color,
    feature,
    maxPrice,
    productType,
  })
  function clearFilters() {
    setSearch('')
    setCategory('All')
    setColor('All')
    setFeature('All')
    setProductType('All')
    setMaxPrice('')
  }
  const visibleWindows = source === 'Room elements' && (category === 'All' || category === 'Windows') ? windowPresets.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase())) : []
  const blocked = !!previewState || status !== 'connected' || pending || !!backup
  const atmosphere = worldBackground(variantScene?.sunHour ?? sunPreview ?? litScene.sunHour ?? 9)
  const expected = item ? { [item.id]: item.productId } : {}
  function askReplacement() {
    if (!item || item.locked) return
    openPanel('astra')
    setReplacementTarget(item.id)
  }
  const [replacementTarget, setReplacementTarget] = useState<string | null>(null)
  return (
    <div className={`app immersive${panel ? ' has-panel' : ''}${expanded ? ' sheet-expanded' : ''}`}>
      <header className="header">
        <a className="brand" href="/" aria-label="Cozy home">cozy<span>.</span></a>
        <span className="room-title">My room</span>
        <div className="header-actions">
          <button disabled={!state?.undoCount || blocked} onClick={() => edit({ type: 'room.undo' })}>↶ <span>Undo</span></button>
          <button className={scene.budget > 0 && total > scene.budget ? 'over' : ''} onClick={() => openPanel(panel === 'budget' ? null : 'budget')} aria-expanded={panel === 'budget'}>{money(total)}{scene.budget > 0 && <span className="budget-limit"> / {money(scene.budget)}</span>}</button>
          <button aria-label="Studio menu" aria-expanded={panel === 'menu'} onClick={() => openPanel(panel === 'menu' ? null : 'menu')}>•••</button>
        </div>
      </header>
      <div className="status-stack">
        {recoveryError && <div className="notice" role="status"><span>{recoveryError}</span><button onClick={() => openPanel('menu')}>Recovery options</button></div>}
        {(notice || error) && <div className="notice" role="status"><span>{error || notice}</span><button onClick={() => { setNotice(''); connection.dismissError() }} aria-label="Dismiss notification">×</button></div>}

        {state?.validationIssues.map(issue => <p role="alert" className="validation-banner" key={issue}>{issue}</p>)}
      </div>
      <main className="workspace">
        <section className="studio" aria-label="Room canvas" style={{ '--world-glow': atmosphere.glow, '--world-sky': atmosphere.sky, '--world-text': atmosphere.text } as CSSProperties}>
          <div className="viewport">
            <Room thumbnailId={capturing?.id} onThumbnail={(id, image) => setThumbnails(old => ({ ...old, [id]: image }))} scene={variantScene ?? (sunPreview === null ? litScene : { ...litScene, sunHour: sunPreview })} lightingPreview={sunPreview !== null || !!lightingPreview} catalog={catalog} selected={previewState ? null : selected} onSelect={previewState ? () => {} : setSelected}
              selectedWindow={selectedWindow} onSelectWindow={wall => { setSelectedId(null); setSelectedWindow(wall) }} onWindowMove={changeWindow} disabled={blocked}
              onMove={!blocked ? move : () => setNotice('Reconnect and finish pending changes before editing.')}
              top={top} fitRequest={fitRequest} showCompass={panel === 'setup'} />
          </div>
          <div className="canvas-topline">
            <div className="room-caption"><span>YOUR SPACE</span><p>{`${scene.width.toFixed(1)} × ${scene.depth.toFixed(1)} m · ${scene.items.length} ${scene.items.length === 1 ? 'piece' : 'pieces'}`}</p></div>
            <div className="view-switch" aria-label="Camera controls">
              <button aria-pressed={!top} className={!top ? 'active' : ''} onClick={() => setTop(false)}>3D</button>
              <button aria-pressed={top} className={top ? 'active' : ''} onClick={() => setTop(true)}>Top</button>
              <button onClick={() => setFitRequest(n => n + 1)}>Fit room</button>
            </div>
          </div>
          {previewState && <div className="room-preview-badge" role="status">
            <div className="room-preview-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg><span>Preview · read only</span></div>
            <strong>{previewCandidate?.direction?.title ?? 'Room idea'}</strong>
            <small>Use this design to move pieces and make changes.</small>
            <button className="primary" disabled={status !== 'connected' || pending || !!backup || connection.agentStatus === 'working'} onClick={() => adoptIdea(previewCandidate!.id)}>{pending ? 'Applying…' : 'Use this design to edit'}</button>
            <button disabled={pending} onClick={() => setSelectedVariant(null)}>Back to current room</button>
          </div>}
          <nav className="tool-dock" aria-label="Studio tools">
            <button aria-expanded={panel === 'catalog'} onClick={() => panel === 'catalog' ? closePanel() : openPanel('catalog')}><span aria-hidden="true">＋</span>Add furniture</button>
            <button aria-expanded={panel === 'astra'} onClick={() => panel === 'astra' ? closePanel() : openPanel('astra')}><span aria-hidden="true">✳</span>Ask Astra</button>
            <button aria-expanded={panel === 'setup'} onClick={() => panel === 'setup' ? closePanel() : openPanel('setup')}><span aria-hidden="true">⌑</span>Room setup</button>
            <button aria-expanded={panel === 'lighting'} onClick={() => panel === 'lighting' ? closePanel() : openPanel('lighting')}><span aria-hidden="true">☼</span>Lighting</button>
          </nav>
          {!started && !scene.items.length && !backup && <div className="empty-prompt"><p>A space to make your own.</p><div><button onClick={() => openPanel('astra')}>Describe your room</button><button onClick={() => openPanel('catalog')}>Add furniture</button></div></div>}
          {item && product && <div className="selection-toolbar" aria-label="Selected piece">
            <div className="selected-name"><strong>{product.name}</strong><small>{item.locked ? 'Locked' : product.door ? 'Door' : money(product.price)}</small></div>
            <div className="quick-actions">
              {!product.door && !isWallFixture(product) && <button disabled={blocked || item.locked} onClick={() => move({ ...item, rotation: (item.rotation + 90) % 360 })}>Rotate</button>}
              {!product.door && !isWallFixture(product) && <button disabled={blocked || item.locked} onClick={() => openPanel('replace')}>Replace</button>}
              {item.door && <button disabled={blocked || item.locked} onClick={() => commit({ ...scene, items: scene.items.map(i => i.id === item.id ? { ...i, door: { ...item.door!, open: !item.door!.open } } : i) })}>{item.door.open ? 'Close door' : 'Open door'}</button>}
              {product.lighting && <button disabled={blocked} onClick={() => commit({ ...scene, items: scene.items.map(i => i.id === item.id ? { ...i, light: { ...i.light, on: i.light?.on === false, brightness: i.light?.brightness ?? .7, color: i.light?.color ?? '#ffd3a0' } } : i) })}>{item.light?.on === false ? 'Light on' : 'Light off'}</button>}
              <button disabled={blocked} onClick={() => edit({ type: 'item.lock', slotIds: [item.id], expectedProducts: expected, locked: !item.locked })}>{item.locked ? 'Unlock' : 'Lock'}</button>
              <button onClick={() => openPanel('details')}>More</button>
              <button aria-label="Deselect piece" onClick={() => setSelected(null)}>×</button>
            </div>
          </div>}
          {activeWindow && <div className="selection-toolbar" role="group" aria-label="Selected window"><div className="selected-name"><strong>{activeWindow.wall[0].toUpperCase() + activeWindow.wall.slice(1)} window</strong><small>Drag to move</small></div><div className="quick-actions"><button onClick={() => openPanel('window')}>Style & size</button><button aria-label="Deselect window" onClick={() => setSelectedWindow(null)}>×</button></div></div>}
          <div className="canvas-bottomline"><span className="canvas-instructions">Drag furniture, windows or fittings to move · Drag space to orbit · Scroll to zoom</span><span role="status">{status !== 'connected' ? 'Reconnecting…' : backup && !recoveryError ? 'Opening your room…' : connection.agentStatus === 'working' ? connection.activity : pending ? 'Saving…' : ''}</span></div>
        </section>
        <PanelHost panel={panel} expanded={expanded} onExpand={() => setExpanded(v => !v)} onResizeExpanded={setExpanded} onClose={closePanel}>
          <div hidden={panel !== 'catalog'}>        <div className="catalog">
          <div className="panel-heading">
            <h2>The collection</h2>
            <span>{visible.length + visibleWindows.length} {visible.length + visibleWindows.length === 1 ? 'piece' : 'pieces'}</span>
          </div>
          <div className="collection-source">
            <button
              className={source === 'IKEA' ? 'active' : ''}
              onClick={() => {
                setSource('IKEA')
                clearFilters()
              }}
            >
              IKEA collection
            </button>
            <button
              className={source === 'Unbranded' ? 'active' : ''}
              onClick={() => {
                setSource('Unbranded')
                clearFilters()
              }}
            >
              Unbranded
            </button>
            <button className={source === 'Brand references' ? 'active' : ''} onClick={() => { setSource('Brand references'); clearFilters() }}>Brand references</button>
            <button
              className={source === 'Room elements' ? 'active' : ''}
              onClick={() => { setSource('Room elements'); clearFilters() }}
            >
              Room elements
            </button>
          </div>
          {source === 'Unbranded' && <p className="catalog-source-note">Everyday objects, creative accents and the original samples. Approximate dimensions and illustrative prices; no brand affiliation.</p>}
          {source === 'Brand references' && <p className="catalog-source-note">Omnidesk footprints from published specifications, with simplified geometry and fixed seated/standing heights. Prices are planning allowances.</p>}
          <div className="search">
            <span>⌕</span>
            <input
              aria-label="Search furniture"
              placeholder="Find a little something…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="categories">
            {(source === 'Room elements' ? ['All', 'Windows', 'Doors'] : ['All', ...new Set(sourceProducts.map((p) => p.category))]).map(
              (c) => (
                <button
                  key={c}
                  className={category === c ? 'active' : ''}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ),
            )}
          </div>
          <details className="catalog-filters" hidden={source === 'Room elements'}>
            <summary>Refine your collection</summary>
            <label>
              Furniture type
              <select
                aria-label="Furniture type"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
              >
                <option value="All">All types</option>
                {[
                  ...new Set(
                    sourceProducts.map((p) => p.productType).filter(Boolean),
                  ),
                ]
                  .sort()
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </label>
            <label>
              Color
              <select
                aria-label="Furniture color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              >
                <option value="All">All colors</option>
                {[
                  ...new Set(
                    sourceProducts.flatMap((p) => p.colorFamilies ?? []),
                  ),
                ]
                  .sort()
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </label>
            <label>
              Feature
              <select
                aria-label="Furniture feature"
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
              >
                <option value="All">Any feature</option>
                {[...new Set(sourceProducts.flatMap((p) => p.features ?? []))]
                  .sort()
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </label>
            <label>
              Maximum price (S$)
              <input
                aria-label="Maximum furniture price"
                type="number"
                min="0"
                placeholder="Any price"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
            </label>
            <button onClick={clearFilters}>Clear filters</button>
          </details>
          <div className="products">
            {visibleWindows.map(p => <article className="product-card" key={p.id}>
              <div className={`window-preset-art window-preset-${p.id}`} aria-hidden="true"><span /></div>
              <div className="product-info"><h3>{p.name}</h3><p>{p.description}</p><div><small>Room element</small><button disabled={blocked} aria-label={`Add ${p.name}`} onClick={() => addWindow(p.id)}>+</button></div></div>
            </article>)}
            {visible.map((p) => (
              <article className="product-card" key={p.id}>
                <div className="product-image">
                  <ProductArt product={p} />
                  <span className="product-category">
                    {symbols[p.category] ?? '▢'}
                  </span>
                </div>
                <div className="product-info">
                  <h3>{p.name}</h3>
                  <p>
                    {dimensionCm(p.dimensions[0])} ×{' '}
                    {dimensionCm(p.dimensions[1])} × {dimensionCm(p.dimensions[2])} cm · W × H × D
                  </p>
                  {!p.id.startsWith('ikea-') && !p.id.startsWith('reference-') && !p.door && <small className="dimension-note">Approximate size · Unbranded</small>}
                  {p.id.startsWith('reference-') && <small className="dimension-note" title={p.dimensionNote}>Published footprint · Simplified model</small>}
                  {p.placement?.mode === 'surface' && <small className="dimension-note">{p.placement.surfaceKind === 'bouquet' ? 'Select a vase or planter to insert stems' : p.placement.surfaceKind === 'mattress' ? 'Select a bed with a fitting mattress deck' : 'Select a desk or table to place on top'}</small>}
                  {isWallFixture(p) && <small className="dimension-note">Wall mounted · Drag to position</small>}
                  <div>
                    <strong>
                      {p.door ? 'Unpriced' : money(p.price)}
                      {p.priceNote && !p.door ? '*' : ''}
                    </strong>
                    <button onClick={() => add(p)} aria-label={`Add ${p.name}`}>
                      +
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {!visible.length && !visibleWindows.length && (
              <p className="muted">No pieces found. Try another search.</p>
            )}
          </div>
          <div className="catalog-note">
            Make room for a little personality.
            <br />
            Unbranded prices are illustrative · IKEA prices are dated SGD snapshots
          </div>
        </div>
</div>
          <div hidden={panel !== 'astra'}><AgentPanel active={panel === 'astra' && !previewState} connection={connection} selected={selected} onSelect={setSelected} disabled={!!backup || !!previewState} replacementTarget={replacementTarget} onReplacementOpened={() => setReplacementTarget(null)}
            ideas={<VariantsPanel variants={connection.variants} busy={connection.agentStatus === 'working'} disabled={status !== 'connected' || pending || !!backup} selected={selectedVariant} thumbnails={thumbnails} warning={connection.variantSaveWarning} send={send} onSelect={id => { setLightingPreview(null); setSunPreview(null); setSelectedVariant(id); if (id) setExpanded(false) }} />} /></div>
          <div hidden={panel !== 'setup'}><fieldset disabled={blocked}>              <div className="door-entry">
                <div><strong>Doors</strong><span>Add an opening to the outdoors.</span></div>
                <button onClick={() => { const door = catalog.find(p => p.id === 'sample-room-door'); if (door) add(door) }}>+ Add door</button>
              </div>
<div className="door-entry"><div><strong>Windows</strong><span>Choose a style, then drag it into place.</span></div><button onClick={() => { setSource('Room elements'); clearFilters(); openPanel('catalog') }}>+ Add window</button></div>
<RoomCustomization scene={scene} onChange={commit} />
<SunlightControls scene={scene} catalog={catalog} onChange={commit} mode="windows" />
              <div className="room-settings">
                <div><label htmlFor="height">Room height</label><select id="height" value={scene.height} onChange={e => resize('height', Number(e.target.value))}>{Array.from({length:31},(_,i) => Number((2+i*.1).toFixed(1))).map(n => <option key={n} value={n}>{n.toFixed(1)} m</option>)}</select></div>
                <div>
                  <label htmlFor="width">Room width</label>
                  <select
                    id="width"
                    value={scene.width}
                    onChange={(e) => resize('width', Number(e.target.value))}
                  >
                    {Array.from({ length: 11 }, (_, i) => 3 + i * 0.5).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n.toFixed(1)} m
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div>
                  <label htmlFor="depth">Room depth</label>
                  <select
                    id="depth"
                    value={scene.depth}
                    onChange={(e) => resize('depth', Number(e.target.value))}
                  >
                    {Array.from({ length: 11 }, (_, i) => 3 + i * 0.5).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n.toFixed(1)} m
                        </option>
                      ),
                    )}
                  </select>
                </div>

              </div>
</fieldset></div>
          <div hidden={panel !== 'window'}>{activeWindow ? <WindowControls window={activeWindow} scene={scene} disabled={blocked} onChange={next => changeWindow(activeWindow.wall, next)} onRemove={() => { if (commit({ ...scene, windows: (scene.windows ?? defaultWindows).filter(w => w.wall !== activeWindow.wall) })) { setSelectedWindow(null); closePanel() } }} /> : <p className="panel-empty">Select a window in the room to change its style and size.</p>}</div>
          <div hidden={panel !== 'lighting'}><fieldset disabled={blocked}><LightingPresets scene={scene} catalog={catalog} draft={lightingPreview} onPreview={draft => { setSunPreview(null); setLightingPreview(draft) }} onApply={() => {
              if (lightingPreview && Object.entries(lightingPreview.fixtures).some(([id, settings]) => { const item = scene.items.find(i => i.id === id); const product = catalog.find(p => p.id === item?.productId); return !product || !validBulbSettings(product, settings) })) { setNotice('Check the selected bulb settings.'); return }
              if (lightingPreview && edit({ type: 'lighting.apply', baseRevision: lightingPreview.revision, sunHour: lightingPreview.sunHour, fixtures: lightingPreview.fixtures })) setLightingPreview(null)
            }} />{!lightingPreview && <SunlightControls scene={scene} catalog={catalog} onChange={commit} onSunPreview={setSunPreview} mode="lighting" />}</fieldset></div>
          <div hidden={panel !== 'budget'}><BudgetControls budget={scene.budget} total={total} disabled={blocked} onSave={budget => edit({ type: 'room.update', budget })} />
          <div className="room-list">
            <p className="eyebrow">
              IN YOUR ROOM <span>{scene.items.length}</span>
            </p>
            {scene.items.length === 0 ? (
              <p className="muted">A blank canvas. Add your first piece.</p>
            ) : (
              scene.items.map((i) => (
                <button
                  key={i.id}
                  className={selected === i.id ? 'selected' : ''}
                  onClick={() => {
                    setSelected(i.id)
                                  }}
                >
                  <span>
                    {i.locked ? '▣' : '▫'}{' '}
                    {catalog.find((p) => p.id === i.productId)?.name}
                  </span>
                  <span>
                    {i.door ? `${i.door.wall} · ${i.door.open ? 'open' : 'closed'}` : money(catalog.find((p) => p.id === i.productId)?.price ?? 0)}
                  </span>
                </button>
              ))
            )}
          </div>
</div>
          <div hidden={panel !== 'details'}>
            {item && product ? <><div className="detail-summary"><ProductArt product={product} /><h3>{product.name}</h3><p>{product.dimensions.map(n => `${dimensionCm(n)} cm`).join(' × ')}</p><p className="muted">{product.dimensionNote ?? (!product.id.startsWith('ikea-') && !product.door ? 'Unbranded geometry with approximate dimensions.' : '')}</p>{product.priceNote && <p className="muted">{product.priceNote}</p>}{product.productUrl && <a href={product.productUrl} target="_blank" rel="noreferrer">View product source ↗</a>}{product.reflection && <p className="muted">Live room reflection. All wall mirrors reflect together; resolution adjusts when many are present.</p>}<p>{item.x.toFixed(2)}, {item.z.toFixed(2)} m · {item.rotation}°</p><div className="detail-actions"><button aria-pressed={!!state?.slots[item.id]?.liked} disabled={blocked} onClick={() => edit({ type: 'feedback.send', action: state?.slots[item.id]?.liked ? 'unlike' : 'like', slotIds: [item.id], expectedProducts: expected })}>{state?.slots[item.id]?.liked ? 'Unlike' : 'Like'}</button><button className="danger" disabled={blocked || item.locked} onClick={() => { if (edit({ type: 'item.delete', slotId: item.id, expectedProduct: item.productId })) { setSelected(null); closePanel() } }}>Delete piece</button></div></div><fieldset disabled={blocked}>              {item && product?.door && <DoorControls item={item} product={product} scene={scene} onChange={next => commit({ ...scene, items: scene.items.map(i => i.id === next.id ? next : i) })} />}
              {item && product && isWallFixture(product) && <WallLightControls item={item} product={product} scene={scene} onChange={move} />}
{item && product && !product.door && !isWallFixture(product) && <div className="placement-controls">
                <strong>{product.placement?.surfaceKind === 'mattress' ? 'Mattress placement' : isAnchored(product) ? 'Ceiling mounted' : item.supportId ? 'Resting on a surface' : 'On the floor'}</strong>
                {(product.placement?.mode === 'surface' || product.lighting?.mount === 'surface') && <label>{product.placement?.surfaceKind === 'mattress' ? 'Place on bed' : 'Resting on'}
                  <select aria-label="Supporting surface" disabled={item.locked} value={item.supportId ?? 'floor'} onChange={e => {
                    const support = scene.items.find(i => i.id === e.target.value)
                    const p = catalog.find(p => p.id === support?.productId)
                    move({ ...item, supportId: undefined, ...(support && p ? supportPosition(support, p) : { elevation: 0 }) })
                  }}>
                    <option value="floor">Floor</option>
                    {scene.items.flatMap(support => {
                      const p = catalog.find(p => p.id === support.productId)
                      if (!p || support.id === item.id) return []
                      if (product.placement?.surfaceKind === 'mattress' && p.placement?.support) {
                        const deck = p.placement.support
                        return <option key={support.id} value={support.id} disabled={!acceptsSupport(p, product)}>{p.name} · {mattressSize(deck.width, deck.depth)}{acceptsSupport(p, product) ? '' : ' · too small'}</option>
                      }
                      return acceptsSupport(p, product) ? <option key={support.id} value={support.id}>{p.name}</option> : []
                    })}
                  </select>
                </label>}
                {product.placement?.support?.kind === 'mattress' && <small>Mattress deck · {Math.round(product.placement.support.width * 100)} × {Math.round(product.placement.support.depth * 100)} cm · {Math.round(product.placement.support.height * 100)} cm high. {product.placement.support.evidence.startsWith('Assumed') ? 'Assumed slatted base; check the base and assembly setting at IKEA.' : 'Estimated from the bed model.'}</small>}
                {product.placement?.support?.kind === 'mattress' && !attachedMattress && <label>Attach mattress
                  <select aria-label="Mattress for selected bed" value="" onChange={e => {
                    const [kind, id] = e.target.value.split(':')
                    if (kind === 'room') {
                      const mattress = scene.items.find(i => i.id === id)
                      if (mattress) {
                        const placed = settleItem({ ...mattress, supportId: undefined, ...supportPosition(item, product) }, scene, catalog)
                        if (placed && commit({ ...scene, items: scene.items.map(i => i.id === placed.id ? placed : i) })) setNotice('Mattress attached. Move or rotate the bed frame to carry both pieces together.')
                        else setNotice('The mattress cannot attach here. Clear the bed deck and nearby obstructions first.')
                      }
                    } else {
                      const mattress = catalog.find(p => p.id === id)
                      if (mattress) add(mattress)
                    }
                  }}>
                    <option value="" disabled>{bedMattresses.length ? 'Choose a mattress to attach…' : 'No fitting mattresses in the collection'}</option>
                    {!!looseMattresses.length && <optgroup label="Already in your room">{looseMattresses.map(i => <option key={i.id} value={`room:${i.id}`}>{catalog.find(p => p.id === i.productId)!.name}</option>)}</optgroup>}
                    <optgroup label="Add from collection">{bedMattresses.map(p => <option key={p.id} value={`catalog:${p.id}`}>{p.name} · {Math.abs(product.placement!.support!.width - p.dimensions[0]) <= .02 && Math.abs(product.placement!.support!.depth - p.dimensions[2]) <= .02 ? 'Exact fit' : 'Smaller than frame'}</option>)}</optgroup>
                  </select>
                </label>}
                {product.placement?.support?.kind === 'bouquet' && <label>Flowers / greenery
                  <select aria-label="Bouquet for selected vase" value="" disabled={item.locked} onChange={e => { const bouquet = catalog.find(p => p.id === e.target.value); if (bouquet) add(bouquet) }}>
                    <option value="" disabled>Choose an arrangement…</option>
                    {catalog.filter(p => p.placement?.surfaceKind === 'bouquet' && acceptsSupport(product, p)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select><small>Decorative insertion anchor, approximately sized. Move the vase to carry its flowers. Select flowers in the room to remove or replace them.</small>
                </label>}
                {attachedMattress && attachedMattressProduct && <div className="bed-pair"><strong>Attached mattress</strong><span>{attachedMattressProduct.name}</span><button onClick={() => setSelected(attachedMattress.id)}>Select mattress</button><small>Move or rotate the bed frame to carry both pieces together.</small>
                  {product.placement?.support && (product.placement.support.width - attachedMattressProduct.dimensions[0] > .02 || product.placement.support.depth - attachedMattressProduct.dimensions[2] > .02) && <small className="mattress-size-warning">Size mismatch · {mattressSize(attachedMattressProduct.dimensions[0], attachedMattressProduct.dimensions[2])} mattress centred on a {mattressSize(product.placement.support.width, product.placement.support.depth)} deck. Gaps remain; the mattress keeps its actual size.</small>}
                </div>}
                {product.placement?.surfaceKind === 'mattress' && <small>Drag over a bed frame to align and settle, or choose a bed above. Smaller mattresses sit centred; larger ones need a larger frame. No stretching.</small>}
                {product.placement?.surfaceKind === 'mattress' && mattressSupport && (mattressSupport.width - product.dimensions[0] > .02 || mattressSupport.depth - product.dimensions[2] > .02) && <small className="mattress-size-warning">Size mismatch · {mattressSize(product.dimensions[0], product.dimensions[2])} mattress on a {mattressSize(mattressSupport.width, mattressSupport.depth)} deck. Centred with {Math.max(0, Math.round((mattressSupport.width - product.dimensions[0]) * 50))} cm at each side and {Math.max(0, Math.round((mattressSupport.depth - product.dimensions[2]) * 50))} cm at each end. Choose an exact fit for the bed.</small>}
                <small>{isAnchored(product) ? 'Attached overhead. Gravity does not detach a mounted fixture.' : 'Gravity on · release to settle. Green preview marks the landing. Move a support to carry its objects; drag an object away to detach.'}</small>
              </div>}
              {item && product?.lighting && (
                <div className="fixture-controls">
                  <div>
                    <strong>☼ Fixture light</strong>
                    <button
                      onClick={() =>
                        commit({
                          ...scene,
                          items: scene.items.map((i) =>
                            i.id === item.id
                              ? {
                                  ...i,
                                  light: {
                                    ...i.light,
                                    on: !(i.light?.on ?? true),
                                    brightness: i.light?.brightness ?? 0.7,
                                    color: i.light?.color ?? '#ffd3a0',
                                  },
                                }
                              : i,
                          ),
                        })
                      }
                    >
                      {item.light?.on === false ? 'Turn on' : 'Turn off'}
                    </button>
                  </div>
                  <p className="muted">Fixed output · {fixtureOutput(product, item.light).lumens} lm<br />{fixtureOutput(product, item.light).evidence}</p>
                  {product.lighting.colorMode !== 'fixed' && (
                    <label>
                      {product.lighting.colorMode === 'bulb-dependent'
                        ? 'Preview bulb color'
                        : 'Light color'}
                      <select
                        aria-label="Fixture light color"
                        value={item.light?.color ?? '#ffd3a0'}
                        onChange={(e) =>
                          commit({
                            ...scene,
                            items: scene.items.map((i) =>
                              i.id === item.id
                                ? {
                                    ...i,
                                    light: {
                                      on: i.light?.on ?? true,
                                      brightness: i.light?.brightness ?? 0.7,
                                      color: e.target.value,
                                    },
                                  }
                                : i,
                            ),
                          })
                        }
                      >
                        <option value="#ffd3a0">Warm white</option>
                        <option value="#fff4dd">Neutral white</option>
                        <option value="#dceaff">Cool white</option>
                        {['rgb', 'bulb-dependent'].includes(
                          product.lighting.colorMode,
                        ) && (
                          <>
                            <option value="#8fb4ff">Blue</option>
                            <option value="#ff92cd">Pink</option>
                            <option value="#a6ffc0">Green</option>
                          </>
                        )}
                      </select>
                    </label>
                  )}
                  {isAnchored(product) && !isWallFixture(product) && <label>
                    Mounted base height · {(item.elevation ?? 0).toFixed(2)} m
                    <input
                      aria-label="Fixture mounting height"
                      disabled={item.locked}
                      type="range"
                      min="0"
                      max={Math.max(0, (scene.height ?? 2.6) - product.dimensions[1])}
                      step="0.05"
                      value={item.elevation ?? 0}
                      onChange={(e) =>
                        move({ ...item, elevation: Number(e.target.value) })
                      }
                    />
                  </label>}
                  <small>
                    {product.lighting.colorMode === 'bulb-dependent'
                      ? 'Color depends on your chosen bulb; these are preview settings. '
                      : ''}
                    Illustrative illumination using fixed fixture output. Select a
                    desk or bedside table before adding a table lamp to place it
                    on top.
                  </small>
                </div>
              )}
</fieldset></> : <p className="panel-empty">Select a piece in the room to see its details.</p>}
          </div>
          <div hidden={panel !== 'replace'}><fieldset disabled={blocked}>{alternativesPanel || <p className="panel-empty">Select a piece to find alternatives.</p>}{item && !product?.door && <button className="primary wide" disabled={blocked || item.locked} onClick={askReplacement}>Ask Astra for another option</button>}</fieldset></div>
          <div hidden={panel !== 'menu'} className="studio-menu">
            <button className="danger" disabled={status !== 'connected' || pending || (!scene.items.length && !backup)} onClick={() => { if (resetRoom()) { setSelected(null); closePanel(); setNotice('Room reset. Undo brings your pieces back.') } }}>Reset room</button>
            <p className="muted">Remove all pieces, including locked ones. Room dimensions and budget stay the same. Undo restores the previous arrangement.</p>
            {recoveryError && backup && <section className="recovery-options"><h3>Saved room</h3><p className="muted">Your original save is still on this device.</p><button disabled={pending || status !== 'connected'} onClick={restore}>Try opening again</button><button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([backup], { type: 'application/json' })); a.download = 'cozy-room-backup.json'; a.click(); URL.revokeObjectURL(a.href) }}>Download saved room</button></section>}

            <details><summary>Connection & collection</summary>{diagnostic && <p>{diagnostic}</p>}<p>{status} · {completeIkea.length} IKEA pieces ready · {reviewCount} awaiting review</p><button onClick={reconnect}>Refresh connection and collection</button></details>
            <p className="muted">Accepted changes are backed up on this device. Undo pauses the designer.</p>
          </div>
        </PanelHost>
      </main>
    </div>
  )
}
