import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { useConnection } from './useConnection'

export default function AgentPanel({ connection, selected, onSelect, disabled }: {
  connection: ReturnType<typeof useConnection>; selected: string | null
  onSelect: (id: string | null) => void; disabled: boolean
}) {
  const { state, catalog, messages, status, agentStatus, activity, feedbackStage, send, reconnect, pending } = connection
  const [text, setText] = useState('')
  const [scope, setScope] = useState<string[]>([])
  const [replacement, setReplacement] = useState<string[] | null>(null)
  const [reason, setReason] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const blocked = disabled || pending || status !== 'connected'
  const slots = Object.values(state?.slots ?? {})
  const groups = [...new Set(slots.map(s => `${s.zone} / ${s.group}`))]
  const expected = (ids: string[]) => Object.fromEntries(ids.flatMap(id => state?.slots[id]?.catalogId ? [[id, state.slots[id].catalogId!]] : []))
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [messages])
  useEffect(() => { setScope(selected ? [selected] : []) }, [selected])
  return <section className="agent-panel" aria-label="AI designer">
    <div className={`agent-status ${status}`} role="status"><i /> {activity}
      {agentStatus === 'working' && <span aria-label="Working"> ···</span>}
    </div>
    {status !== 'connected' && <button onClick={reconnect}>Reconnect</button>}
    <div className="agent-messages" ref={log} role="log" aria-label="Design conversation" aria-live="polite">
      {!messages.length && <p className="muted">Describe your room. Astra can build a concept around the pieces you add.</p>}
      {messages.map(m => <article key={m.id} className={`chat-${m.role}`}><small>{m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'ASTRA' : 'STUDIO'}</small><ReactMarkdown>{m.text}</ReactMarkdown></article>)}
    </div>
    <form onSubmit={e => { e.preventDefault(); if (!text.trim()) return
      if (send(scope.length ? { type: 'feedback.send', action: 'comment', text, slotIds: scope, expectedProducts: expected(scope) } : { type: 'chat.send', text })) setText('')
    }}>
      <label htmlFor="design-message">{scope.length ? `Comment on ${scope.length} selected pieces` : 'Your brief or feedback'}</label>
      {scope.length > 0 && <button type="button" onClick={() => setScope([])}>Whole room</button>}
      <textarea id="design-message" value={text} onChange={e => setText(e.target.value)} maxLength={6000} rows={3} placeholder="A calm bedroom with a workspace…" />
      <button className="primary" disabled={blocked || !text.trim()}>{agentStatus === 'working' ? 'Send feedback' : 'Send to Astra'}</button>
    </form>
    <p className="feedback-stage" role="status">{feedbackStage && `Update ${feedbackStage}`}</p>
    {state?.validationIssues.map(issue => <p role="alert" className="over" key={issue}>{issue}</p>)}
    {state?.concept.summary && <div className="concept-summary"><h3>{state.concept.title}</h3><p>{state.concept.summary}</p><small>{[...state.concept.palette, ...state.concept.materials].join(' · ')}</small></div>}
    {slots.length > 0 && <button disabled={blocked || !slots.some(s => s.catalogId && !s.locked && !s.door)} onClick={() => { setReplacement([]); setReason('') }}>Reroll unlocked</button>}
    {groups.map(group => <section className="concept-group" key={group}><div className="group-title"><h3>{group}</h3><button disabled={blocked} onClick={() => { setScope(slots.filter(s => `${s.zone} / ${s.group}` === group).map(s => s.id)); document.getElementById('design-message')?.focus() }}>Comment</button></div>
      {slots.filter(s => `${s.zone} / ${s.group}` === group).map(slot => {
        const p = catalog.find(p => p.id === slot.catalogId)
        return <article key={slot.id} className={`concept-item ${selected === slot.id ? 'selected' : ''}`}>
          <button className="concept-select" onClick={() => onSelect(slot.id)}>{p?.thumbnailUrl && <img src={p.thumbnailUrl} alt="" loading="lazy" />}<span><small>{slot.label}{slot.anchor ? ' · ANCHOR' : ''}</small><strong>{p?.name ?? 'Finding a piece…'}</strong></span></button>
          <p>{slot.explanation}</p>{slot.replacing && <small>Finding an alternative; current piece stays visible.</small>}
          {p && <div className="concept-actions"><button disabled={blocked || slot.liked} onClick={() => send({ type: 'feedback.send', action: 'like', slotIds: [slot.id], expectedProducts: expected([slot.id]) })}>{slot.liked ? 'Liked' : 'Like'}</button><button disabled={blocked} onClick={() => send({ type: 'item.lock', slotIds: [slot.id], expectedProducts: expected([slot.id]), locked: !slot.locked })}>{slot.locked ? 'Unlock' : 'Lock'}</button><button disabled={blocked || slot.locked || slot.replacing || !!slot.door} onClick={() => { setReplacement([slot.id]); setReason('') }}>Replace</button></div>}
        </article>
      })}
    </section>)}
    {replacement !== null && <div className="replace-overlay"><section role="dialog" aria-modal="true" aria-labelledby="replace-title" onKeyDown={e => { if (e.key === 'Escape') setReplacement(null) }}><h3 id="replace-title">Find another option</h3><label htmlFor="replacement-reason">What would you change? (optional)</label><textarea autoFocus id="replacement-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder="A warmer color, a smaller footprint…" /><button onClick={() => setReplacement(null)}>Keep for now</button><button className="primary" disabled={blocked} onClick={() => { if (send({ type: 'feedback.send', action: replacement.length ? 'reroll' : 'reroll_unlocked', slotIds: replacement, expectedProducts: expected(replacement), text: reason })) setReplacement(null) }}>Find alternatives</button></section></div>}
  </section>
}
