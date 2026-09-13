import type { Part, Product as StudioProduct } from './catalog'

export type Product = {
  id: string; name: string; category: string; modelId: string
  width: number; depth: number; height: number; price: number; currency: string
  color: string; material: string; style: string; illustrative: boolean; floorLayer: boolean
  collection?: string; parts?: Part[]; modelUrl?: string; thumbnailUrl?: string
  productUrl?: string; brand?: string; fetchedAt?: string; productType?: string
  features?: string[]; colorFamilies?: string[]; priceBand?: string; priceNote?: string
  dimensionsMeasuredFromModel?: boolean; lighting?: StudioProduct['lighting']
  placement?: StudioProduct['placement']; door?: StudioProduct['door']
  readyForPreview: boolean; canRecommend: boolean; assetIssue?: string
}
export type Slot = {
  id: string; label: string; category: string; zone: string; group: string; anchor: boolean
  catalogId: string | null; x: number; z: number; rotation: number
  locked: boolean; liked: boolean; replacing: boolean; explanation: string
  elevation: number; light: { on: boolean; brightness: number; color: string } | null
  supportId: string | null; door: { wall: 'north' | 'east' | 'south' | 'west'; offset: number; open: boolean } | null
}
export type DesignState = {
  revision: number; room: { width: number; depth: number; height: number; daylight: number; wallColors?: import('./catalog').Scene['wallColors']; windows: import('./sunlight').RoomWindow[]; sunHour: number }
  brief: string; budget: number | null
  concept: { title: string; summary: string; palette: string[]; materials: string[] }
  slots: Record<string, Slot>; total: number; complete: boolean
  validationIssues: string[]
  rejected: Record<string, { catalogId: string; reason: string }[]>
  feedback: { text: string; slotIds: string[] }[]
  rerollTargets: string[] | null; undoCount: number
}
export type ObjectReference = { slotId: string; name: string; category: string }
export type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string; references?: ObjectReference[] }
export type Command = {
  type: 'chat.send' | 'feedback.send' | 'item.lock' | 'item.add' | 'item.update' | 'item.delete'
    | 'room.update' | 'fixture.update' | 'room.clear' | 'room.undo' | 'catalog.import' | 'session.restore' | 'session.restore.preview' | 'item.replace'
  text?: string; action?: 'comment' | 'like' | 'reroll' | 'reroll_unlocked'
  slotIds?: string[]; expectedProducts?: Record<string, string>; locked?: boolean; budget?: number | null
  baseRevision?: number; slotId?: string; catalogId?: string; expectedProduct?: string
  x?: number; z?: number; rotation?: number; elevation?: number
  light?: { on: boolean; brightness: number; color: string }
  supportId?: string | null; door?: NonNullable<Slot['door']>
  previewId?: string; allowLocked?: string[]
  room?: DesignState['room']; product?: GeneratedProduct; backup?: Backup
}
export type GeneratedProduct = Pick<StudioProduct, 'id' | 'name' | 'category' | 'price' | 'dimensions' | 'parts' | 'lighting' | 'placement' | 'door' | 'productType' | 'priceNote'>
export type Backup = { version: 2 | 3; state: Omit<DesignState, 'total' | 'complete' | 'validationIssues' | 'undoCount'>; products: GeneratedProduct[] }
export type RestorePreview = { previewId: string; state: Backup['state'] | null; adjustments: { text: string; slotId?: string; locked?: boolean }[]; blockers: string[] }
