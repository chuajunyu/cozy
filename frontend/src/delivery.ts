export type DeliveryStage = 'sending' | 'received' | 'sent' | 'queued' | 'applied' | 'failed' | 'uncertain' | 'saved'
export type Delivery = { stage: DeliveryStage; owner: string; kind: 'chat' | 'activity' }
export type Deliveries = Record<string, Delivery>
export type DeliveryEvent =
  | { type: 'track'; requestId: string; owner: string; kind: Delivery['kind']; stage: DeliveryStage }
  | { type: 'ack'; requestId: string; stage: string }
  | { type: 'error'; requestId?: string }
  | { type: 'disconnect' }
  | { type: 'reset' }

const stages: DeliveryStage[] = ['sending', 'received', 'sent', 'queued', 'applied', 'failed', 'uncertain', 'saved']
const finished = (stage: DeliveryStage) => ['applied', 'failed', 'saved'].includes(stage)

export function deliveryReducer(state: Deliveries, event: DeliveryEvent): Deliveries {
  if (event.type === 'reset') return {}
  if (event.type === 'disconnect') return Object.fromEntries(Object.entries(state).map(([id, value]) => [id, finished(value.stage) ? value : { ...value, stage: 'uncertain' }]))
  if (event.type === 'track') {
    if (state[event.requestId]) return state
    const entries = Object.entries(state).filter(([, value]) => value.owner !== event.owner).slice(-49)
    return { ...Object.fromEntries(entries), [event.requestId]: { owner: event.owner, kind: event.kind, stage: event.stage } }
  }
  if (!event.requestId || !state[event.requestId]) return state
  const current = state[event.requestId]
  const stage = event.type === 'error' ? 'failed' : event.stage as DeliveryStage
  if (!stages.includes(stage)) return state
  // Duplicate/out-of-order receipt events must not regress a known delivery.
  if (event.type === 'ack' && stage !== 'failed' &&
      (current.stage === 'failed' || (current.stage !== 'uncertain' && stages.indexOf(stage) < stages.indexOf(current.stage)))) return state
  return { ...state, [event.requestId]: { ...current, stage } }
}

export function deliveryLabel(delivery: Delivery | undefined): string {
  if (!delivery) return ''
  const labels: Record<DeliveryStage, string> = {
    sending: 'Sending', received: 'Received by Cozy', sent: 'Sent to Astra', queued: 'Queued for Astra',
    applied: 'Received by Astra', failed: 'Delivery failed · send a follow-up to retry',
    uncertain: 'Delivery uncertain · reconnecting', saved: 'Saved to room',
  }
  return labels[delivery.stage]
}
