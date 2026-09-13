import { useEffect, useMemo, useState } from 'react'
import Room from './Room'
import {
  filterProducts,
  initialCatalog,
  toStudioProduct,
  parseProduct,
  validPlacement,
  type Item,
  type Product,
  type Scene,
} from './catalog'
import { useConnection } from './useConnection'
import AgentPanel from './AgentPanel'
import { generatedProduct } from './backup'
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
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'room' | 'preview'>('room')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [source, setSource] = useState('IKEA')
  const [color, setColor] = useState('All')
  const [feature, setFeature] = useState('All')
  const [productType, setProductType] = useState('All')
  const [maxPrice, setMaxPrice] = useState('')


  const [top, setTop] = useState(false)
  const [light, setLight] = useState(55)
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<Product>(initialCatalog[0])
  const [bounds, setBounds] = useState(true)
  const connection = useConnection()
  const { state, catalog: wireCatalog, status, send, reconnect, error, pending, backup, restore, dismissBackup } = connection
  const catalog = useMemo(() => wireCatalog.map(toStudioProduct), [wireCatalog])
  useEffect(() => { setNotice('') }, [state?.revision])
  const scene: Scene = useMemo(() => ({
    width: state?.room.width ?? 4, depth: state?.room.depth ?? 3.5, height: state?.room.height ?? 2.6,
    revision: state?.revision, daylight: state?.room.daylight ?? 1, budget: state?.budget ?? 0,
    items: Object.values(state?.slots ?? {}).filter(s => s.catalogId).map(s => ({
      id: s.id, productId: s.catalogId!, x: s.x, z: s.z, rotation: s.rotation, locked: s.locked,
      elevation: s.elevation, light: s.light ?? undefined,
    })),
  }), [state])
  const reviewCount = connection.reviewCount + wireCatalog.filter(p => !p.readyForPreview).length
  function edit(command: Command) {
    if (backup) { setNotice('Restore or archive your saved room first.'); return false }
    return send(command)
  }
  useEffect(() => {
    const updated = catalog.find(p => p.id === preview.id)
    if (updated) setPreview(updated)
  }, [catalog, preview.id])
  const item = scene.items.find((i) => i.id === selected)
  const product = catalog.find((p) => p.id === item?.productId)
  const total = scene.items.reduce(
    (n, i) => n + (catalog.find((p) => p.id === i.productId)?.price ?? 0),
    0,
  )
  function commit(next: Scene) {
    const added = next.items.find(i => !scene.items.some(old => old.id === i.id))
    const removed = scene.items.find(i => !next.items.some(n => n.id === i.id))
    const changed = next.items.find(i => JSON.stringify(i) !== JSON.stringify(scene.items.find(old => old.id === i.id)))
    if (added) {
      edit({ type: 'item.add', slotId: added.id, catalogId: added.productId, x: added.x, z: added.z,
        rotation: added.rotation, elevation: added.elevation, light: added.light })
    } else if (removed) {
      edit({ type: 'item.delete', slotId: removed.id, expectedProduct: removed.productId })
    } else if (changed) {
      const old = scene.items.find(i => i.id === changed.id)!
      if (old.locked !== changed.locked) edit({ type: 'item.lock', slotIds: [old.id], expectedProducts: { [old.id]: old.productId }, locked: changed.locked })
      else if (JSON.stringify(old.light) !== JSON.stringify(changed.light)) edit({ type: 'fixture.update', slotId: old.id, expectedProduct: old.productId, light: changed.light })
      else edit({ type: 'item.update', slotId: old.id, expectedProduct: old.productId, x: changed.x, z: changed.z, rotation: changed.rotation, elevation: changed.elevation })
    } else if (state) edit({ type: 'room.update', room: { ...state.room, width: next.width, depth: next.depth, daylight: next.daylight ?? 1 }, budget: next.budget || null })
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
    if (status !== 'connected' || pending || backup) { setNotice('Connect and finish pending changes before adding furniture.'); return }
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
          'Placing the lamp on the selected surface. Its position stays independently editable.',
        )
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
        if (validPlacement(next, scene, catalog)) {
          commit({ ...scene, items: [...scene.items, next] })
          setSelected(next.id)
          setTab('room')
          setNotice(`Placing ${p.name}...`)
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
      const parsed = parseProduct(JSON.parse(await file.text()))
      if (parsed.modelUrl) throw new Error('Import generated geometry with parts; IKEA assets come from the server catalog.')
      const p = { ...parsed, id: parsed.id.startsWith('custom-') ? parsed.id : `custom-${parsed.id}` }
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
          <i /> {status === 'connected' ? pending ? 'Saving...' : 'Connected studio' : 'Disconnected - room is read-only'}
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
            disabled={!state?.undoCount || pending || status !== 'connected'}
            onClick={() => {
              edit({ type: 'room.undo' })
            }}
          >
            ↶ Undo
          </button>
          <button
            onClick={() => {
              edit({ type: 'room.clear' })
              setSelected(null)
              setNotice('Clear requested. Accepted changes can be undone.')
            }}
          >
            Start fresh ↗
          </button>
        </div>
      </div>
      {backup && <div className="restore-banner" role="status"><strong>A saved room is available.</strong><span>Restore it through the server, or archive it and start fresh.</span><button disabled={pending || status !== 'connected'} onClick={restore}>Restore saved room</button><button onClick={dismissBackup}>Archive and start fresh</button><button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([backup], { type: 'application/json' })); a.download = 'cozy-room-backup.json'; a.click(); URL.revokeObjectURL(a.href) }}>Download backup</button></div>}
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
            onClick={reconnect}
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
              onMove={status === 'connected' && !pending && !backup ? move : () => setNotice('Reconnect and finish pending changes before editing.')}
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
          {(notice || error) && (
            <div className="notice" role="status">
              {error || notice}
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
                      max={Math.max(0, (scene.height ?? 2.6) - product.dimensions[1])}
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
                    edit({ type: 'catalog.import', product: generatedProduct(preview) })
                    setNotice(
                      'Submitting product for validation?',
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
          <AgentPanel connection={connection} selected={selected} onSelect={setSelected} disabled={!!backup} />
          <div className="budget">
            <div>
              <label htmlFor="budget">Room budget</label>
              <span>
                {money(total)} <small>{scene.budget ? `/ ${money(scene.budget)}` : '/ no limit'}</small>
              </span>
            </div>
            {scene.budget > 0 && <progress max={scene.budget} value={total} />}
            <p className={scene.budget > 0 && total > scene.budget ? 'over' : ''}>
              {!scene.budget ? 'No budget set' : total > scene.budget
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
          <p className="private-note">Accepted changes are backed up on this device. Undo pauses the designer.</p>
        </aside>
      </main>
      <footer>
        Make room for good things.<span>COZY / YOUR LITTLE DESIGN STUDIO</span>
      </footer>
    </div>
  )
}
