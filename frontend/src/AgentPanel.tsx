import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { useConnection } from './useConnection'
import ObjectPill from './ObjectPill'
import VoiceControls from './VoiceControls'
import { displayMessage, objectReference } from './chatReferences'

export default function AgentPanel({ connection, selected, onSelect, disabled, replacementTarget, onReplacementOpened }: {
  connection: ReturnType<typeof useConnection>; selected: string | null
  onSelect: (id: string | null) => void; disabled: boolean
  replacementTarget: string | null; onReplacementOpened: () => void
}) {
  const { state, catalog, messages, status, agentStatus, activity, feedbackStage, send, reconnect } = connection
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return localStorage.getItem('cozy.voice.enabled') === 'true' } catch { return false }
  })
  const [text, setText] = useState('')
  const [scope, setScope] = useState<string[]>([])
  const [replacement, setReplacement] = useState<string[] | null>(null)
  const [reason, setReason] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (replacementTarget) { setReplacement([replacementTarget]); setReason(''); onReplacementOpened() }
  }, [replacementTarget, onReplacementOpened])
  useEffect(() => { if (replacement !== null) dialog.current?.showModal() }, [replacement])
  const blocked = disabled || status !== 'connected'
  const slots = Object.values(state?.slots ?? {})
  const groups = [...new Set(slots.map(s => `${s.zone} / ${s.group}`))]
  const expected = (ids: string[]) => Object.fromEntries(ids.flatMap(id => state?.slots[id]?.catalogId ? [[id, state.slots[id].catalogId!]] : []))
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight })
    return () => cancelAnimationFrame(frame)
  }, [messages, status, voiceEnabled])
  useEffect(() => {
    const element = log.current
    if (!element) return
    const observer = new ResizeObserver(() => { element.scrollTop = element.scrollHeight })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setScope(selected ? [selected] : []) }, [selected])
  return <section className="agent-panel" aria-label="AI designer">
    <div className={`agent-status ${status}`} role="status"><i /> {activity}
      {agentStatus === 'working' && <span aria-label="Working"> ···</span>}
    </div>
    {status !== 'connected' && <button onClick={reconnect}>Reconnect</button>}
    <div className="agent-messages" ref={log} role="log" aria-label="Design conversation" aria-live="polite">
      {!messages.length && <p className="muted">Describe your room. Astra can build a concept around the pieces you add.</p>}
      {messages.map(raw => {
        const m = displayMessage(raw, state, catalog)
        return <article key={m.id} className={`chat-${m.role}`}><small>{m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'ASTRA' : 'STUDIO'}</small>
          {!!m.references?.length && <div className="object-references">{m.references.map(reference => <ObjectPill key={reference.slotId} reference={reference} available={!!state?.slots[reference.slotId]} onSelect={() => onSelect(reference.slotId)} />)}</div>}
          <ReactMarkdown>{m.text}</ReactMarkdown></article>
      })}
    </div>
    <label className="voice-toggle"><input type="checkbox" checked={voiceEnabled} onChange={event => {
      const enabled = event.target.checked
      setVoiceEnabled(enabled)
      try { localStorage.setItem('cozy.voice.enabled', String(enabled)) } catch { /* Keep this choice for the current page. */ }
    }} /> Voice chat</label>
    {voiceEnabled && <VoiceControls sessionId={connection.sessionId} connected={status === 'connected'} />}
    <form onSubmit={e => { e.preventDefault(); if (!text.trim()) return
      if (send(scope.length ? { type: 'feedback.send', action: 'comment', text, slotIds: scope, expectedProducts: expected(scope) } : { type: 'chat.send', text })) setText('')
    }}>
      <label htmlFor="design-message">{scope.length ? `Comment on ${scope.length} selected ${scope.length === 1 ? 'piece' : 'pieces'}` : 'Your brief or feedback'}</label>
      <div className="feedback-scope"><button type="button" aria-pressed={!scope.length} onClick={() => setScope([])}>Whole room</button>{selected && <button type="button" aria-pressed={scope.includes(selected)} onClick={() => setScope([selected])}>Selected piece</button>}</div>
      {!!scope.length && <div className="object-references">{scope.map(id => <ObjectPill key={id} reference={objectReference(id, state, catalog)} available={!!state?.slots[id]} onSelect={() => onSelect(id)} onRemove={() => setScope(ids => ids.filter(value => value !== id))} />)}</div>}
      <textarea id="design-message" value={text} onChange={e => setText(e.target.value)} maxLength={6000} rows={3} placeholder="A calm bedroom with a workspace…" />
      <button className="primary" disabled={blocked || !text.trim() || scope.some(id => !state?.slots[id])}>{agentStatus === 'working' ? 'Send feedback' : 'Send to Astra'}</button>
    </form>
    <p className="feedback-stage" role="status">{feedbackStage && !['applied', 'incorporated'].includes(feedbackStage) ? `Update ${feedbackStage}` : ''}</p>

    <details className="design-concept"><summary>Design concept & pieces</summary>
    {state?.concept.summary && <div className="concept-summary"><h3>{state.concept.title}</h3><p>{state.concept.summary}</p><small>{[...state.concept.palette, ...state.concept.materials].join(' · ')}</small></div>}
    {slots.length > 0 && <button disabled={blocked || !slots.some(s => s.catalogId && !s.locked && !s.door)} onClick={() => { setReplacement([]); setReason('') }}>Find alternatives for unlocked pieces</button>}
    {groups.map(group => <section className="concept-group" key={group}><div className="group-title"><h3>{group}</h3><button disabled={blocked} onClick={() => { setScope(slots.filter(s => `${s.zone} / ${s.group}` === group).map(s => s.id)); document.getElementById('design-message')?.focus() }}>Comment</button></div>
      {slots.filter(s => `${s.zone} / ${s.group}` === group).map(slot => {
        const p = catalog.find(p => p.id === slot.catalogId)
        return <article key={slot.id} className={`concept-item ${selected === slot.id ? 'selected' : ''}`}>
          <button className="concept-select" onClick={() => onSelect(slot.id)}>{p?.thumbnailUrl && <img src={p.thumbnailUrl} alt="" loading="lazy" />}<span><small>{slot.label}{slot.anchor ? ' · ANCHOR' : ''}</small><strong>{p?.name ?? 'Finding a piece…'}</strong></span></button>
          <p>{slot.explanation}</p>{slot.replacing && <small>Finding an alternative; current piece stays visible.</small>}

        </article>
      })}
    </section>)}
    </details>
    {replacement !== null && <dialog ref={dialog} className="replace-dialog" aria-modal="true" onCancel={() => setReplacement(null)} aria-labelledby="replace-title" ><h3 id="replace-title">Find another option</h3><label htmlFor="replacement-reason">What would you change? (optional)</label><textarea autoFocus id="replacement-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder="A warmer color, a smaller footprint…" /><button onClick={() => setReplacement(null)}>Keep for now</button><button className="primary" disabled={blocked || !!replacement?.some(id => !state?.slots[id]?.catalogId || state.slots[id].locked)} onClick={() => { if (send({ type: 'feedback.send', action: replacement.length ? 'reroll' : 'reroll_unlocked', slotIds: replacement, expectedProducts: expected(replacement), text: reason })) setReplacement(null) }}>Find alternatives</button></dialog>}
  </section>
}
