import ObjectPill from './ObjectPill'
import { deliveryLabel, type Deliveries } from './delivery'
import type { ChatMessage, DesignState, ObjectReference } from './types'

export default function ChatActivity({ message, state, deliveries, onSelect, working }: {
  message: ChatMessage; state: DesignState | null; deliveries: Deliveries; onSelect: (id: string) => void; working: boolean
}) {
  const activity = message.activity
  const pill = (reference: ObjectReference) => <ObjectPill key={reference.slotId} reference={reference} available={!!state?.slots[reference.slotId]} onSelect={() => onSelect(reference.slotId)} />
  if (!activity) return <div className="chat-activity"><span aria-hidden="true">↳</span><span>{message.text}</span>{message.references?.map(pill)}</div>
  const delivery = deliveries[activity.latestRequestId]
  const receipt = !delivery || (!working && delivery.stage === 'received') ? 'Saved to room' : deliveryLabel(delivery)
  const changes = activity.changes
  const expanded = changes.length > 1 || changes.some(change => !change.reference && change.actions.length > 1)
  const rows = changes.flatMap(change => !change.reference && expanded
    ? change.actions.map(action => <div className="activity-change" key={`${change.key}:${action}`}>Updated {action}</div>)
    : [<div className="activity-change" key={change.key}><span>{change.label}</span>{change.reference && pill(change.reference)}</div>])
  return <div className="chat-activity activity-burst">
    <span aria-hidden="true">↳</span>
    <div className="activity-content">
      {expanded ? <details><summary>{message.text}{' '}<span className="activity-count">{activity.editCount} edits</span></summary><div className="activity-details">{rows}</div></details> : rows}
      <span className="delivery-status">{receipt}</span>
    </div>
  </div>
}
