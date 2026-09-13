import type { ObjectReference } from './types'

export default function ObjectPill({ reference, available, onSelect, onRemove }: {
  reference: ObjectReference; available: boolean; onSelect: () => void; onRemove?: () => void
}) {
  return <span className="object-pill">
    <button type="button" disabled={!available} onClick={onSelect} title={available ? `Select ${reference.name}` : `${reference.name} is no longer in the room`}>
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {reference.category === 'door' ? <><path d="M4 17V3h12v14M7 17V5l7 2v10" /><path d="M11 11h1" /></> : <><path d="m10 2 7 4v8l-7 4-7-4V6Z M3 6l7 4 7-4 M10 10v8" /></>}
      </svg>
      <span>{reference.name}</span>
    </button>
    {onRemove && <button type="button" className="remove-reference" onClick={onRemove} aria-label={`Remove reference to ${reference.name}`}>×</button>}
  </span>
}
