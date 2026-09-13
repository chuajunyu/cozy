import { fixtureOutput } from './lighting'
import { acceptsSupport, supportPosition, validItemGeometry, isAnchored, settleItem, settleScene } from './placement'
import SunlightControls from './SunlightControls'
import { validWindows } from './sunlight'
import { walls } from './sunlight'
import { normalizeDoor, validDoors } from './doors'
import DoorControls from './DoorControls'
import { useEffect, useMemo, useRef, useState } from 'react'
import Alternatives from './FurnitureAlternatives'
import { findAlternatives, replaceItem } from './alternatives'
import Room from './Room'
import {
  filterProducts,
  initialCatalog,
  initialScene,
  parseProduct,
  validPlacement,
  type Item,
  type Product,
  type Scene,
} from './catalog'
import { useConnection } from './useConnection'

const money = (n: number) =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 2,
  }).format(n)
const mattressSize = (width: number, depth: number) => `${Math.round(width * 100)} × ${Math.round(depth * 100)} cm`
function load(): { scene: Scene; catalog: Product[] } {
  try {
    const saved = JSON.parse(localStorage.getItem('cozy-studio-v1') ?? 'null')
    if (saved) {
      const catalog: Product[] = saved.catalog.map(parseProduct)
      const s = saved.scene
      if (
        ![s.width, s.depth, s.budget].every(Number.isFinite) ||
        s.width < 3 ||
        s.width > 8 ||
        s.depth < 3 ||
        s.depth > 8 ||
        s.budget < 0 ||
        (s.windows !== undefined && !validWindows(s.windows)) ||
        (s.sunHour !== undefined && (!Number.isFinite(s.sunHour) || s.sunHour < 6 || s.sunHour > 20)) ||
        (s.daylight !== undefined && (!Number.isFinite(s.daylight) || s.daylight < 0 || s.daylight > 1)) ||
        !Array.isArray(s.items) ||
        s.items.length > 100
      )
        throw Error()
      const ids = new Set()
      for (const i of s.items) {
        if (
          typeof i.id !== 'string' ||
          ids.has(i.id) ||
          !catalog.some((p) => p.id === i.productId) ||
          ![i.x, i.z].every(Number.isFinite) ||
          ![0, 90, 180, 270].includes(i.rotation) ||
          typeof i.locked !== 'boolean' ||
          (i.supportId !== undefined && typeof i.supportId !== 'string') ||
          (i.light !== undefined && (typeof i.light.on !== 'boolean' || !Number.isFinite(i.light.brightness) || i.light.brightness < 0 || i.light.brightness > 1 || !/^#[0-9a-f]{6}$/i.test(i.light.color))) ||
          !validItemGeometry(i, catalog.find(p => p.id === i.productId)!, s)
        )
          throw Error()
        ids.add(i.id)
      }
      if (!validDoors(s, catalog)) throw Error()
      const restored = settleScene(s, s, catalog)
      if (restored.error) throw Error()
      return {
        scene: restored.scene,
        catalog: [
          ...initialCatalog.filter((p) => !catalog.some((q) => q.id === p.id)),
          ...catalog,
        ],
      }
    }
  } catch {
    /* A corrupt or older save falls back to the sample room. */
  }
  return { scene: initialScene, catalog: initialCatalog }
}
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
      ) : product.id === 'sofa' ? (
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
          {product.id === 'chair' && (
            <path d="m33 41 63-18V7L33 24Z" fill="#697360" />
          )}
        </>
      )}
    </svg>
  )
}
export default function App() {
  const [loaded] = useState(load)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1150px)').matches)
  const designerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1150px)')
    const update = () => setCompact(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [scene, setScene] = useState(loaded.scene)
  const [catalog, setCatalog] = useState(loaded.catalog)
  const [history, setHistory] = useState<Scene[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'room' | 'preview'>('room')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [source, setSource] = useState('IKEA')
  const [color, setColor] = useState('All')
  const [feature, setFeature] = useState('All')
  const [productType, setProductType] = useState('All')
  const [maxPrice, setMaxPrice] = useState('')
  const [reviewCount, setReviewCount] = useState(0)
  const [catalogRevision, setCatalogRevision] = useState(0)

  const [top, setTop] = useState(false)
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<Product>(catalog[0])
  const [bounds, setBounds] = useState(true)
  const [text, setText] = useState('')
  const { status, messages, send, reconnect } = useConnection()
  useEffect(() => {
    let cancelled = false
    fetch('/ikea-catalog.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw Error()
        return r.json()
      })
      .then((data) => {
        const products: Product[] = data.products
          .filter((p: { readyForPreview: boolean }) => p.readyForPreview)
          .map(
            (p: {
              id: string
              name: string
              category: string
              price: number
              dimensionsMeters: { width: number; height: number; depth: number }
              modelUrl: string
              thumbnailUrl: string
              productUrl: string
              brand: string
              color: string
              fetchedAt: string
              currency: string
            }) =>
              parseProduct({
                ...p,
                dimensions: [
                  p.dimensionsMeters.width,
                  p.dimensionsMeters.height,
                  p.dimensionsMeters.depth,
                ],
                parts: [],
              }),
          )
        if (!cancelled) {
          setReviewCount(data.reviewCount ?? 0)
          setCatalog((current) => [
            ...current.filter((p) => !p.id.startsWith('ikea-')),
            ...products,
          ])
        }
      })
      .catch(() => {
        if (!cancelled)
          setNotice(
            'The IKEA catalog could not be refreshed. Your saved room is still available.',
          )
      })
    return () => {
      cancelled = true
    }
  }, [catalogRevision])

  useEffect(() => {
    try {
      localStorage.setItem('cozy-studio-v1', JSON.stringify({ scene, catalog }))
    } catch {
      setNotice('Browser storage is full. This session cannot be saved.')
    }
  }, [scene, catalog])
  const item = scene.items.find((i) => i.id === selected)
  const product = catalog.find((p) => p.id === item?.productId)
  const mattressSupport = item?.supportId ? catalog.find(p => p.id === scene.items.find(i => i.id === item.supportId)?.productId)?.placement?.support : undefined
  const bedMattresses = product?.placement?.support ? catalog.filter(p => p.placement?.surfaceKind === 'mattress' && acceptsSupport(product, p))
    .sort((a, b) => b.dimensions[0] * b.dimensions[2] - a.dimensions[0] * a.dimensions[2] || a.price - b.price) : []
  const attachedMattress = product?.placement?.support ? scene.items.find(i => i.supportId === item?.id && catalog.find(p => p.id === i.productId)?.placement?.surfaceKind === 'mattress') : undefined
  const attachedMattressProduct = catalog.find(p => p.id === attachedMattress?.productId)
  const looseMattresses = product?.placement?.support ? scene.items.filter(i => !i.supportId && !i.locked && bedMattresses.some(p => p.id === i.productId)) : []
  const alternativeOptions = useMemo(() => item && product ? findAlternatives(product, catalog).map(option => ({
    product: option,
    error: replaceItem(scene, item.id, option, catalog).error,
  })) : [], [item, product, catalog, scene])
  useEffect(() => {
    if (!compact) designerRef.current?.scrollTo({ top: 0 })
  }, [selected, compact])
  function tryAlternative(replacement: Product) {
    if (!item || !product) return
    const result = replaceItem(scene, item.id, replacement, catalog)
    if (result.error) { setNotice(result.error); return }
    if (result.scene === scene) return
    setHistory(h => [...h.slice(-29), scene])
    setScene(result.scene)
    setNotice(`${replacement.name} is now in your room. Undo restores ${product.name}.`)
  }
  const alternativesPanel = item && product && !product.door && tab === 'room' ? (
    <Alternatives key={item.id} item={item} product={product} options={alternativeOptions} onReplace={tryAlternative} renderArt={p => <ProductArt product={p} />} formatPrice={money} />
  ) : null
  const total = scene.items.reduce(
    (n, i) => n + (catalog.find((p) => p.id === i.productId)?.price ?? 0),
    0,
  )
  function commit(next: Scene) {
    const settled = settleScene(next, scene, catalog)
    if (settled.error) { setNotice(settled.error); return false }
    setHistory((h) => [...h.slice(-29), scene])
    setScene(settled.scene)
    setNotice('')
    return true
  }
  function move(next: Item) {
    const landed = settleItem(next, scene, catalog)
    if (!landed) {
      const moving = catalog.find(p => p.id === next.productId)
      setNotice(moving?.placement?.surfaceKind === 'mattress'
        ? `This mattress is ${mattressSize(moving.dimensions[0], moving.dimensions[2])}. Drop it over an empty bed with a deck at least this size, or choose a bed under Mattress placement. It keeps its actual size and cannot overhang the frame.`
        : 'No stable landing here. Keep the whole base on a surface, clear of other furniture and room edges.')
      return
    }
    if (commit({ ...scene, items: scene.items.map(i => i.id === next.id ? landed : i) })) {
      setNotice((next.elevation ?? 0) > (landed.elevation ?? 0) ? 'Settled onto ' + (landed.supportId ? 'the supporting surface.' : 'the floor.') : '')
    }
  }
  function add(p: Product) {
    if (scene.items.length >= 100) {
      setNotice('This room has reached its 100-item limit.')
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
          setTab('room')
          setNotice('Door added. Choose its wall and position below, then open it to let daylight in.')
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
        setTab('room')
        setNotice(
          p.placement?.surfaceKind === 'mattress'
            ? 'Mattress placed on the bed. It will move with the frame; drag it away to detach.'
            : 'Placed on the selected surface. It will move with its support; drag it away to detach.',
        )
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
    for (let z = 0.2; z < scene.depth; z += 0.2)
      for (let x = 0.2; x < scene.width; x += 0.2) {
        const next: Item = {
          id: crypto.randomUUID(),
          productId: p.id,
          x,
          z,
          rotation: 0,
          locked: false,
          elevation:
            isAnchored(p)
              ? Math.max(0, 2.5 - p.dimensions[1])
              : 0,
          ...(p.lighting
            ? { light: { on: true, brightness: 0.7, color: '#ffd3a0' } }
            : {}),
        }
        if (validPlacement(next, scene, catalog) && commit({ ...scene, items: [...scene.items, next] })) {
          setSelected(next.id)
          setTab('room')
          setNotice(p.placement?.surfaceKind === 'mattress' ? 'Mattress added. Drag it over a bed frame to snap onto the deck, or choose a bed under Mattress placement.' : `${p.name} added. Drag it into place.`)
          return
        }
      }
    setNotice(
      'No clear space for this product. Move an item or enlarge your room.',
    )
  }
  async function importFile(file?: File) {
    if (!file) return
    try {
      if (file.size > 500000)
        throw Error('Please use a JSON file smaller than 500 KB.')
      const p = parseProduct(JSON.parse(await file.text()))
      setPreview(p)
      setTab('preview')
      setNotice(
        'Product loaded for review. Inspect it before adding it to your catalog.',
      )
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Unable to load this file.')
    }
  }
  function download() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(initialCatalog[0], null, 2)], {
        type: 'application/json',
      }),
    )
    a.download = 'cozy-desk-example.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  function resize(key: 'width' | 'depth', value: number) {
    commit({ ...scene, [key]: value })
  }
  const completeIkea = catalog.filter(
    (p) => p.id.startsWith('ikea-') && p.readyForPreview === true,
  )
  const sourceProducts =
    source === 'IKEA'
      ? completeIkea
      : catalog.filter((p) => source === 'Room elements' ? !!p.door : !p.id.startsWith('ikea-') && !p.door)
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
  return (
    <div className="app">
      <header className="header">
        <a className="brand" href="/">
          ⌂ cozy<span>.</span>
        </a>
        <nav aria-label="Workspace">
          <button
            className={tab === 'room' ? 'active' : ''}
            onClick={() => setTab('room')}
          >
            Room designer
          </button>
          <button
            className={tab === 'preview' ? 'active' : ''}
            onClick={() => setTab('preview')}
          >
            Furniture lab <span className="beta">NEW</span>
          </button>
        </nav>
        <span className="saved">
          <i /> Saved on this device
        </span>
      </header>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SPACE, YOUR WAY</p>
          <h1>
            {tab === 'room'
              ? 'A little room. A lot of possibility.'
              : 'From a product to a possibility.'}
          </h1>
          <p>
            {tab === 'room'
              ? 'Bring your ideas home. Pick a piece, find its place, make it yours.'
              : 'Preview your generated furniture before it finds a home.'}
          </p>
        </div>
        <div className="heading-actions">
          <button
            disabled={!history.length}
            onClick={() => {
              const previous = history[history.length - 1]
              setScene(previous)
              setHistory((h) => h.slice(0, -1))
              setSelected(current => previous.items.some(i => i.id === current) ? current : null)
              setNotice('')
            }}
          >
            ↶ Undo
          </button>
          <button
            onClick={() => {
              commit({ ...scene, items: [] })
              setSelected(null)
              setNotice('Room cleared. Use Undo to restore it.')
            }}
          >
            Start fresh ↗
          </button>
        </div>
      </div>
      <main className="workspace">
        <aside className="catalog">
          <div className="panel-heading">
            <h2>The collection</h2>
            <span>{visible.length} pieces</span>
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
              className={source === 'Samples' ? 'active' : ''}
              onClick={() => {
                setSource('Samples')
                clearFilters()
              }}
            >
              Samples
            </button>
            <button
              className={source === 'Room elements' ? 'active' : ''}
              onClick={() => { setSource('Room elements'); clearFilters() }}
            >
              Room elements
            </button>
          </div>
          <p className="muted">
            {completeIkea.length} ready · {reviewCount} awaiting review
          </p>
          <button
            className="refresh-catalog"
            onClick={() => setCatalogRevision((r) => r + 1)}
          >
            ↻ Refresh collection
          </button>
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
            {['All', ...new Set(sourceProducts.map((p) => p.category))].map(
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
          <details className="catalog-filters">
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
            {visible.map((p) => (
              <article className="product-card" key={p.id}>
                <button
                  className="product-image"
                  aria-label={`Preview ${p.name}`}
                  onClick={() => {
                    setPreview(p)
                    setTab('preview')
                  }}
                >
                  <ProductArt product={p} />
                  <span className="product-category">
                    {symbols[p.category] ?? '▢'}
                  </span>
                </button>
                <div className="product-info">
                  <h3>{p.name}</h3>
                  <p>
                    {Math.round(p.dimensions[0] * 100)} ×{' '}
                    {Math.round(p.dimensions[p.door ? 1 : 2] * 100)} cm{p.door ? ' · W × H' : ''}
                  </p>
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
            {!visible.length && (
              <p className="muted">No pieces found. Try another search.</p>
            )}
          </div>
          <div className="catalog-note">
            A starting collection, made for exploring.
            <br />
            Sample prices · IKEA prices in SGD
          </div>
        </aside>
        <section className="studio">
          <div className="studio-toolbar">
            <div>
              <span className="small-dot" />{' '}
              {tab === 'room' ? 'MY FIRST ROOM' : 'FURNITURE PREVIEW'}
            </div>
            <div className="view-switch">
              <button
                className={!top ? 'active' : ''}
                onClick={() => setTop(false)}
              >
                ◇ 3D view
              </button>
              <button
                className={top ? 'active' : ''}
                onClick={() => setTop(true)}
              >
                ▦ Top view
              </button>
            </div>
          </div>
          <div className="viewport">
            <div className="canvas-caption">
              {tab === 'room' ? (
                <>
                  <span>THE EVERYDAY RETREAT</span>
                  <p>
                    {scene.width.toFixed(1)} × {scene.depth.toFixed(1)} m{' '}
                    <b>·</b> {scene.items.length} pieces
                  </p>
                </>
              ) : (
                <>
                  <span>
                    {preview.modelUrl
                      ? 'IKEA PRODUCT MODEL'
                      : 'APPROXIMATE REPRESENTATION'}
                  </span>
                  <p>{preview.name}</p>
                </>
              )}
            </div>
            <Room
              scene={scene}
              catalog={catalog}
              selected={selected}
              onSelect={setSelected}
              onMove={move}
              top={top}
              preview={tab === 'preview' ? preview : undefined}
              bounds={bounds}
            />
            <div className="canvas-help">
              Drag furniture to move <span>·</span> Drag empty space to orbit{' '}
              <span>·</span> Scroll to zoom
            </div>
          </div>
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button
                onClick={() => setNotice('')}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          {tab === 'room' ? (
            <>
              <div className="selection-bar">
                {item && product ? (
                  <>
                    <div>
                      <span className="selection-icon">
                        {item.locked ? '▣' : '▢'}
                      </span>
                      <div>
                        <strong>{product.name}</strong>
                        <small>
                          {item.door ? `${item.door.wall} wall · ${item.door.open ? 'Open' : 'Closed'}` : `${item.x.toFixed(2)}, ${item.z.toFixed(2)} m · ${item.rotation}°`}
                        </small>
                      </div>
                    </div>
                    <div className="selection-actions">
                      {!product.door && <button
                        disabled={item.locked}
                        onClick={() =>
                          move({
                            ...item,
                            rotation: (item.rotation + 90) % 360,
                          })
                        }
                      >
                        ↻ Rotate
                      </button>}
                      <button
                        onClick={() =>
                          commit({
                            ...scene,
                            items: scene.items.map((i) =>
                              i.id === item.id
                                ? { ...i, locked: !i.locked }
                                : i,
                            ),
                          })
                        }
                      >
                        {item.locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button
                        disabled={item.locked}
                        onClick={() => {
                          if (commit({
                            ...scene,
                            items: scene.items.filter((i) => i.id !== item.id),
                          })) setSelected(null)
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                ) : (
                  <p>Select a piece to make it feel at home.</p>
                )}
              </div>
              {item && product?.door && <DoorControls item={item} product={product} scene={scene} onChange={next => commit({ ...scene, items: scene.items.map(i => i.id === next.id ? next : i) })} />}
              {item && product && !product.door && <div className="placement-controls">
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
                {product.placement?.support && <small>Mattress deck · {Math.round(product.placement.support.width * 100)} × {Math.round(product.placement.support.depth * 100)} cm · {Math.round(product.placement.support.height * 100)} cm high. {product.placement.support.evidence.startsWith('Assumed') ? 'Assumed slatted base; check the base and assembly setting at IKEA.' : 'Estimated from the bed model.'}</small>}
                {product.placement?.support && !attachedMattress && <label>Attach mattress
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
                  <p className="muted">Fixed output · {fixtureOutput(product).lumens} lm<br />{fixtureOutput(product).evidence}</p>
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
                  {isAnchored(product) && <label>
                    Mounted base height · {(item.elevation ?? 0).toFixed(2)} m
                    <input
                      aria-label="Fixture mounting height"
                      disabled={item.locked}
                      type="range"
                      min="0"
                      max={Math.max(0, 2.5 - product.dimensions[1])}
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
              {compact && alternativesPanel}
              <div className="door-entry">
                <div><strong>Doors</strong><span>Add an opening to the outdoors.</span></div>
                <button onClick={() => { const door = catalog.find(p => p.id === 'room-door'); if (door) add(door) }}>+ Add door</button>
              </div>
              <SunlightControls scene={scene} catalog={catalog} onChange={commit} />
              <div className="room-settings">
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
            </>
          ) : (
            <div className="lab-controls">
              <div>
                <strong>{preview.name}</strong>
                <p>
                  {preview.dimensions
                    .map((n) => `${Math.round(n * 100)} cm`)
                    .join(' × ')}{' '}
                  · width / height / depth
                </p>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={bounds}
                  onChange={(e) => setBounds(e.target.checked)}
                />{' '}
                Show dimensions box
              </label>
              <div>
                <label className="button import-button">
                  ↑ Import JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      void importFile(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                <button onClick={download}>Example JSON ↓</button>
                <button
                  className="primary"
                  onClick={() => {
                    if (catalog.some((p) => p.id === preview.id)) {
                      add(preview)
                      return
                    }
                    setCatalog((c) => [...c, preview])
                    setNotice(
                      `${preview.name} approved and added to the collection.`,
                    )
                  }}
                >
                  {catalog.some((p) => p.id === preview.id)
                    ? 'Add to room +'
                    : 'Approve for catalog +'}
                </button>
              </div>
              {preview.productUrl && (
                <div className="source-details">
                  <span>
                    {preview.brand} · {preview.color} · {money(preview.price)}
                  </span>
                  {preview.features && (
                    <div className="feature-tags">
                      {preview.features.map((f) => (
                        <span key={f}>{f}</span>
                      ))}
                    </div>
                  )}
                  {preview.priceBand && (
                    <small>
                      {preview.priceBand} within{' '}
                      {preview.productType?.toLowerCase()} in this collection.
                    </small>
                  )}
                  {preview.priceNote && <small>{preview.priceNote}</small>}
                  {preview.dimensionsMeasuredFromModel && <small>Some dimensions are measured from the 3D model, checked against published measurements. Approximate footprint may include cables.</small>}
                  <a href={preview.productUrl} target="_blank" rel="noreferrer">
                    View product at IKEA ↗
                  </a>
                  <small>
                    Price checked {preview.fetchedAt?.slice(0, 10)} · Verify
                    current price and availability at IKEA.
                  </small>
                </div>
              )}
              <small>
                Import geometry generated from product photos. Inspect the shape
                and scale before approving.
              </small>
            </div>
          )}
        </section>
        <aside ref={designerRef} className={`designer${alternativesPanel && !compact ? ' has-alternatives' : ''}`}>
          {!compact && alternativesPanel}
          {!alternativesPanel && <>
          <div className="panel-heading">
            <h2>Your design companion</h2>
            <span className="spark">✳</span>
          </div>
          <div className="assistant-intro">
            <div className="assistant-avatar">✳</div>
            <h3>A space that feels like you.</h3>
            <p>
              Arrange your favourite pieces now. Your AI designer will soon help
              with the rest.
            </p>
          </div>
          <div className="feature-note">
            <span className="small-dot" /> Manual studio ready{' '}
            <span className="coming">AI coming next</span>
          </div>
          </>}
          <div className="budget">
            <div>
              <label htmlFor="budget">Room budget</label>
              <span>
                {money(total)} <small>/ {money(scene.budget)}</small>
              </span>
            </div>
            <progress max={Math.max(scene.budget, 1)} value={total} />
            <p className={total > scene.budget ? 'over' : ''}>
              {total > scene.budget
                ? `${money(total - scene.budget)} over budget`
                : `${money(scene.budget - total)} left for the finishing touches`}
            </p>
            <div className="budget-input">
              <span>Set budget · S$</span>
              <input
                id="budget"
                aria-label="Room budget in SGD"
                type="number"
                min="0"
                max="100000"
                value={scene.budget}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v) && v >= 0 && v <= 100000)
                    commit({ ...scene, budget: v })
                }}
              />
            </div>
          </div>
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
                    setTab('room')
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
          <details className="connection">
            <summary>
              <i className={status} /> Backend connection check
            </summary>
            <p>
              {status === 'connected'
                ? 'Connected. Messages below are echoed, not AI responses.'
                : 'Backend unavailable. Room editing still works.'}
            </p>
            {status === 'disconnected' && (
              <button onClick={reconnect}>Reconnect</button>
            )}
            <div className="messages" role="log">
              {messages.map((m) => (
                <p key={m.id}>
                  {m.direction}: {m.text}
                </p>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (text.trim() && send(text)) setText('')
              }}
            >
              <input
                aria-label="Connection test message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Test a message…"
              />
              <button disabled={status !== 'connected' || !text.trim()}>
                ↑
              </button>
            </form>
          </details>
          <div className="chat-placeholder">
            <span>Describe your dream room…</span>
            <button disabled aria-label="AI designer not connected">
              ↑
            </button>
          </div>
          <p className="private-note">Your room stays in this browser.</p>
        </aside>
      </main>
      <footer>
        Make room for good things.<span>COZY / YOUR LITTLE DESIGN STUDIO</span>
      </footer>
    </div>
  )
}
