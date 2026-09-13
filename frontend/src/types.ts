export type Product = {
  id: string; name: string; category: string; modelId: string
  width: number; depth: number; height: number; price: number; currency: string
  color: string; material: string; style: string; illustrative: boolean; floorLayer: boolean
}
export type Slot = {
  id: string; label: string; category: string; zone: string; group: string; anchor: boolean
  catalogId: string | null; x: number; z: number; rotation: number
  locked: boolean; liked: boolean; replacing: boolean; explanation: string
}
export type DesignState = {
  revision: number; room: { width: number; depth: number; height: number }
  brief: string; budget: number | null
  concept: { title: string; summary: string; palette: string[]; materials: string[] }
  slots: Record<string, Slot>; total: number; complete: boolean
  validationIssues: string[]
  rejected: Record<string, { catalogId: string; reason: string }[]>
  feedback: { text: string; slotIds: string[] }[]
}
export type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string }
export type Command = {
  type: 'chat.send' | 'feedback.send' | 'item.lock'
  text?: string; action?: 'comment' | 'like' | 'reroll' | 'reroll_unlocked'
  slotIds?: string[]; expectedProducts?: Record<string, string>; locked?: boolean; budget?: number
}
