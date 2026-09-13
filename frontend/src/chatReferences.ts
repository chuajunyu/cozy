import type { ChatMessage, DesignState, ObjectReference, Product } from './types'

export function objectReference(id: string, state: DesignState | null, catalog: Product[]): ObjectReference {
  const slot = state?.slots[id]
  const product = catalog.find(p => p.id === slot?.catalogId)
  return { slotId: id, name: product?.name ?? slot?.label ?? 'Removed piece', category: slot?.door ? 'door' : slot?.category ?? 'object' }
}

export function displayMessage(message: ChatMessage, state: DesignState | null, catalog: Product[]) {
  if (message.references?.length) return message
  // Older sessions stored the internal targeting prefix in the visible text.
  const match = message.role === 'user' ? /^Regarding ([^:]+):\s*([\s\S]*)$/.exec(message.text) : null
  if (!match) return message
  const ids = match[1].split(',').map(id => id.trim())
  if (!ids.every(id => !!state?.slots[id] || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) return message
  return { ...message, text: match[2], references: ids.map(id => objectReference(id, state, catalog)) }
}
