// Retain the upstream corner-coordinate scenarios while exercising the centered implementation.
import * as placement from '../src/placement'
import * as doors from '../src/doors'
import * as catalog from '../src/catalog'
import * as alternatives from '../src/alternatives'
import type { Item, Product, Scene } from '../src/catalog'
const centered = (i: Item, s: Pick<Scene, 'width' | 'depth'>): Item => ({ ...i, x: i.x-s.width/2, z: i.z-s.depth/2 })
const corner = (i: Item, s: Pick<Scene, 'width' | 'depth'>): Item => ({ ...i, x: i.x+s.width/2, z: i.z+s.depth/2 })
const convert = (s: Scene): Scene => ({ ...s, height: s.height ?? 2.7, items: s.items.map(i => centered(i,s)) })
const result = (r: {scene: Scene; error?: string}, previous: Scene) => r.error ? { ...r, scene: previous } : { ...r, scene: { ...r.scene, items: r.scene.items.map(i => corner(i,r.scene)) } }
export const initialCatalog = catalog.initialCatalog.map(p => ({ ...p, id: p.id.replace(/^sample-/, '') }))
export const { filterProducts, parseProduct } = catalog
export const { canSupportItems, isAnchored } = placement
export const { alternativeKind, findAlternatives } = alternatives
export const settleItem = (i: Item, s: Scene, c: Product[]) => { const r = placement.settleItem(centered(i,s), convert(s),c); return r && corner(r,s) }
export const liftToSupport = (i: Item, s: Scene, c: Product[]) => { const input = centered(i,s); const r = placement.liftToSupport(input,convert(s),c); return r === input ? i : corner(r,s) }
export const settleScene = (s: Scene,p: Scene,c: Product[]) => result(placement.settleScene(convert(s),convert(p),c),p)
export const replaceItem = (s: Scene,id: string,p: Product,c: Product[]) => { const input = convert(s); const r = alternatives.replaceItem(input,id,p,c); return r.scene === input ? { ...r, scene:s } : result(r,s) }
export const validItemGeometry = (i: Item,p: Product,s: Scene) => placement.validItemGeometry(centered(i,s),p,convert(s))
export const validPlacement = (i: Item,s: Scene,c: Product[]) => catalog.validPlacement(centered(i,s),convert(s),c)
export const normalizeDoor = (i: Item,p: Product,s: Scene) => corner(doors.normalizeDoor(centered(i,s),p,s),s)
export const validDoorAnchor = (i: Item,p: Product,s: Scene) => doors.validDoorAnchor(centered(i,s),p,s)
export const doorGeometry = doors.doorGeometry
export const doorOpenings = (s: Scene,c: Product[]) => doors.doorOpenings(convert(s),c)
export const validDoors = (s: Scene,c: Product[]) => doors.validDoors(convert(s),c)
export const doorClearance = (i: Item,p: Product,s: Scene) => { const r = doors.doorClearance(centered(i,s),p,s); return { ...r,minX:r.minX+s.width/2,maxX:r.maxX+s.width/2,minZ:r.minZ+s.depth/2,maxZ:r.maxZ+s.depth/2 } }
