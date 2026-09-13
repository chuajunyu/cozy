import { useEffect, useState } from 'react'
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
          (i.light !== undefined && (typeof i.light.on !== 'boolean' || !Number.isFinite(i.light.brightness) || i.light.brightness < 0 || i.light.brightness > 1 || !/^#[0-9a-f]{6}$/i.test(i.light.color))) ||
          !validPlacement(i, s, catalog)
        )
          throw Error()
        ids.add(i.id)
      }
      return {
        scene: s,
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
      {product.category === 'Bedroom' ? (
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
  const [light, setLight] = useState(55)
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
  const total = scene.items.reduce(
    (n, i) => n + (catalog.find((p) => p.id === i.productId)?.price ?? 0),
    0,
  )
  function commit(next: Scene) {
    setHistory((h) => [...h.slice(-29), scene])
    setScene(next)
  }
  function move(next: Item) {
    if (!validPlacement(next, scene, catalog)) {
      setNotice(
        'That position overlaps furniture or falls outside the room. Try another spot.',
      )
      return
    }
    commit({
      ...scene,
      items: scene.items.map((i) => (i.id === next.id ? next : i)),
    })
    setNotice('')
  }
  function add(p: Product) {
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
      p.lighting?.mount === 'surface' &&
      item &&
      product &&
      !product.lighting
    ) {
      const lamp: Item = {
        id: crypto.randomUUID(),
        productId: p.id,
        x: item.x,
        z: item.z,
        rotation: 0,
        locked: false,
        elevation: (item.elevation ?? 0) + product.dimensions[1],
        light: { on: true, brightness: 0.7, color: '#ffd3a0' },
      }
      if (validPlacement(lamp, scene, catalog)) {
        commit({ ...scene, items: [...scene.items, lamp] })
        setSelected(lamp.id)
        setTab('room')
        setNotice(
          'Lamp placed on the selected furniture. Light position is independently editable.',
        )
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
            p.lighting?.mount === 'ceiling'
              ? Math.max(0, 2.5 - p.dimensions[1])
              : 0,
          ...(p.lighting
            ? { light: { on: true, brightness: 0.7, color: '#ffd3a0' } }
            : {}),
        }
        if (validPlacement(next, scene, catalog)) {
          commit({ ...scene, items: [...scene.items, next] })
          setSelected(next.id)
          setTab('room')
          setNotice(`${p.name} added. Drag it into place.`)
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
    const next = { ...scene, [key]: value }
    if (next.items.some((i) => !validPlacement(i, next, catalog))) {
      setNotice('Move furniture away from the edge before shrinking this room.')
      return
    }
    commit(next)
    setNotice('')
  }
  const completeIkea = catalog.filter(
    (p) => p.id.startsWith('ikea-') && p.readyForPreview === true,
  )
  const sourceProducts =
    source === 'IKEA'
      ? completeIkea
      : catalog.filter((p) => !p.id.startsWith('ikea-'))
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
              setScene(history[history.length - 1])
              setHistory((h) => h.slice(0, -1))
              setSelected(null)
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
                    {Math.round(p.dimensions[2] * 100)} cm
                  </p>
                  <div>
                    <strong>
                      {money(p.price)}
                      {p.priceNote ? '*' : ''}
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
              lightAngle={light}
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
                          {item.x.toFixed(2)}, {item.z.toFixed(2)} m ·{' '}
                          {item.rotation}°
                        </small>
                      </div>
                    </div>
                    <div className="selection-actions">
                      <button
                        disabled={item.locked}
                        onClick={() =>
                          move({
                            ...item,
                            rotation: (item.rotation + 90) % 360,
                          })
                        }
                      >
                        ↻ Rotate
                      </button>
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
                          commit({
                            ...scene,
                            items: scene.items.filter((i) => i.id !== item.id),
                          })
                          setSelected(null)
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
                  <label>
                    {product.lighting.dimmable
                      ? 'Brightness'
                      : 'Preview brightness'}
                    <input
                      aria-label="Fixture brightness"
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={item.light?.brightness ?? 0.7}
                      onChange={(e) =>
                        commit({
                          ...scene,
                          items: scene.items.map((i) =>
                            i.id === item.id
                              ? {
                                  ...i,
                                  light: {
                                    on: i.light?.on ?? true,
                                    brightness: Number(e.target.value),
                                    color: i.light?.color ?? '#ffd3a0',
                                  },
                                }
                              : i,
                          ),
                        })
                      }
                    />
                  </label>
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
                  <label>
                    Base height · {(item.elevation ?? 0).toFixed(2)} m
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
                  </label>
                  <small>
                    {product.lighting.colorMode === 'bulb-dependent'
                      ? 'Color depends on your chosen bulb; these are preview settings. '
                      : ''}
                    Approximate light output, not measured brightness. Select a
                    desk or bedside table before adding a table lamp to place it
                    on top.
                  </small>
                </div>
              )}
              <div className="daylight-controls">
                <label htmlFor="daylight">
                  Daylight{' '}
                  <span>{Math.round((scene.daylight ?? 1) * 100)}%</span>
                </label>
                <input
                  id="daylight"
                  aria-label="Daylight strength"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={scene.daylight ?? 1}
                  onChange={(e) =>
                    commit({ ...scene, daylight: Number(e.target.value) })
                  }
                />
                <div>
                  <button onClick={() => commit({ ...scene, daylight: 1 })}>
                    Day
                  </button>
                  <button onClick={() => commit({ ...scene, daylight: 0.2 })}>
                    Evening
                  </button>
                  <button onClick={() => commit({ ...scene, daylight: 0 })}>
                    Night
                  </button>
                </div>
                <small>
                  Compare daylight and fixture lighting · Visual preview
                </small>
              </div>
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
                <div className="light-setting">
                  <label htmlFor="light">
                    ☼ Find your light <small>Visual preview</small>
                  </label>
                  <input
                    id="light"
                    type="range"
                    min="0"
                    max="180"
                    value={light}
                    onChange={(e) => setLight(Number(e.target.value))}
                  />
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
        <aside className="designer">
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
                    {money(
                      catalog.find((p) => p.id === i.productId)?.price ?? 0,
                    )}
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
