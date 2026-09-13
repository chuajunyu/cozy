import type { Command, VariantSet } from './types'

export default function VariantsPanel({ variants, busy, disabled, selected, thumbnails, warning, send, onSelect }: {
  variants: VariantSet | null; busy: boolean; disabled: boolean; selected: string | null
  thumbnails: Record<string, string>; warning: string; send: (command: Command) => boolean; onSelect: (id: string | null) => void
}) {
  if (!variants && !warning) return null
  return <section className="variants-panel" aria-label="Room ideas">
    <h3>Three room ideas</h3>
    {warning && <p role="status" className="muted">{warning}</p>}
    {variants && <>
      {variants.outdated && <p role="status" className="muted">The room changed. These ideas are outdated; generate a new set to apply one.</p>}
      <div className="detail-actions"><button aria-pressed={!selected} onClick={() => onSelect(null)}>Current room</button>
        {variants.candidates.some(c => ['queued', 'generating'].includes(c.status)) && <button disabled={disabled} onClick={() => send({ type: 'variants.cancel', setId: variants.id })}>Cancel generation</button>}</div>
      <div className="variant-cards">{variants.candidates.map((candidate, index) => <article key={candidate.id} className={selected === candidate.id ? 'variant-card selected' : 'variant-card'}>
        <button className="variant-preview" disabled={!candidate.state || candidate.status !== 'ready'} onClick={() => onSelect(candidate.id)}>
          {thumbnails[candidate.id] ? <img src={thumbnails[candidate.id]} alt={`Preview of ${candidate.direction?.title}`} /> : <div className="variant-placeholder">{candidate.status === 'ready' ? 'Preview ready' : candidate.status}</div>}
          <strong>{candidate.direction?.title ?? `Idea ${index + 1}`}</strong>
        </button>
        <small>{candidate.status}</small><p>{candidate.direction?.rationale}</p>
        <p className="muted">{candidate.direction?.palette.join(' · ')}</p>
        {candidate.state && <p>{new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(candidate.state.total)}</p>}
        {candidate.error && <p role="status">{candidate.error}</p>}
        {candidate.status === 'ready' && <button disabled={disabled || busy || variants.outdated} onClick={() => { if (send({ type: 'variants.adopt', setId: variants.id, candidateId: candidate.id })) onSelect(null) }}>Use this design</button>}
        {['failed', 'cancelled', 'interrupted'].includes(candidate.status) && candidate.direction && <button disabled={disabled || variants.outdated} onClick={() => send({ type: 'variants.retry', setId: variants.id, candidateId: candidate.id })}>Retry this idea</button>}
      </article>)}</div>
      {selected && <p className="muted">Preview only. Use this design before editing it.</p>}
    </>}
  </section>
}
