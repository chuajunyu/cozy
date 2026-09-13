import { useEffect, useState } from 'react'
import type { Command, VariantCandidate, VariantSet } from './types'

const PROGRESS_COPY = {
  queued: ['Reading your room', 'Sketching a direction', 'Preparing the concept'],
  generating: ['Shaping the layout', 'Comparing furniture', 'Balancing color and materials', 'Checking the room flow'],
} as const

function IdeaProgress({ status, offset }: { status: VariantCandidate['status']; offset: number }) {
  const phrases = status === 'queued' || status === 'generating' ? PROGRESS_COPY[status] : null
  const [step, setStep] = useState(offset)

  useEffect(() => {
    setStep(offset)
    if (!phrases || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setStep(value => value + 1), 1800)
    return () => window.clearInterval(timer)
  }, [offset, phrases])

  if (!phrases) return null
  return <div className="variant-progress" role="status" aria-label={status === 'queued' ? 'Idea queued' : 'Generating idea'}>
    <span className="variant-orbit" aria-hidden="true"><i /><i /><i /></span>
    <span aria-hidden="true" key={`${status}-${step}`}>{phrases[step % phrases.length]}</span>
  </div>
}

export default function VariantsPanel({ variants, busy, disabled, selected, thumbnails, warning, send, onSelect }: {
  variants: VariantSet | null; busy: boolean; disabled: boolean; selected: string | null
  thumbnails: Record<string, string>; warning: string; send: (command: Command) => boolean; onSelect: (id: string | null) => void
}) {
  if (!variants && !warning) return null
  return <section className="variants-panel" aria-label="Room ideas">
    <h3>Three room ideas</h3>
    {warning && <p role="status" className="muted">{warning}</p>}
    {variants && <>
      {variants.outdated && <p role="status" className="muted">The room has changed since these ideas were made. You can still preview or use any completed design; using one replaces the current layout and can be undone.</p>}
      <div className="detail-actions"><button aria-pressed={!selected} onClick={() => onSelect(null)}>Current room</button>
        {variants.candidates.some(c => ['queued', 'generating'].includes(c.status)) && <button disabled={disabled} onClick={() => send({ type: 'variants.cancel', setId: variants.id })}>Cancel generation</button>}</div>
      <div className="variant-cards">{variants.candidates.map((candidate, index) => {
        const active = candidate.status === 'queued' || candidate.status === 'generating'
        return <article key={candidate.id} className={`${selected === candidate.id ? 'variant-card selected' : 'variant-card'}${active ? ' is-working' : ''}`}>
        <button className="variant-preview" disabled={!candidate.state || candidate.status !== 'ready'} onClick={() => onSelect(candidate.id)}>
          {thumbnails[candidate.id] ? <img src={thumbnails[candidate.id]} alt={`Preview of ${candidate.direction?.title}`} /> : <div className={`variant-placeholder${active ? ' variant-loading' : ''}`}>{active ? <IdeaProgress status={candidate.status} offset={index} /> : candidate.status === 'ready' ? 'Preview ready' : candidate.status}</div>}
          <strong>{candidate.direction?.title ?? `Idea ${index + 1}`}</strong>
        </button>
        {!active && <small>{candidate.status}</small>}<p>{candidate.direction?.rationale}</p>
        <p className="muted">{candidate.direction?.palette.join(' · ')}</p>
        {candidate.state && <p>{new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(candidate.state.total)}</p>}
        {candidate.error && <p role="status">{candidate.error}</p>}
        {candidate.status === 'ready' && <button disabled={disabled || busy} onClick={() => send({ type: 'variants.adopt', setId: variants.id, candidateId: candidate.id })}>Use this design</button>}
        {['failed', 'cancelled', 'interrupted'].includes(candidate.status) && candidate.direction && <button disabled={disabled || variants.outdated} onClick={() => send({ type: 'variants.retry', setId: variants.id, candidateId: candidate.id })}>Retry this idea</button>}
      </article>})}</div>
      {selected && <p className="muted">Preview only. Use this design before editing it.</p>}
    </>}
  </section>
}
