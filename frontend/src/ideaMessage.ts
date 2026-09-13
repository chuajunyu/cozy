import type { ChatMessage, VariantSet } from './types'

export function ideaMessageId(variants: VariantSet | null, messages: ChatMessage[]): string | null {
  if (!variants) return null
  if (variants.requestMessageId) return messages.some(m => m.role === 'user' && m.id === variants.requestMessageId) ? variants.requestMessageId : null
  // Compatibility for idea sets saved before request-message linkage existed.
  return [...messages].reverse().find(m => m.role === 'user' && m.text === `/ideas ${variants.request}`)?.id ?? null
}
