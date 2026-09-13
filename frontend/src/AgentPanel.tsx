import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ideaMessageId } from './ideaMessage'
import ReactMarkdown from 'react-markdown'
import type { useConnection } from './useConnection'
import ObjectPill from './ObjectPill'
import VoiceControls from './VoiceControls'
import ChatActivity from './ChatActivity'
import { deliveryLabel } from './delivery'
import { displayMessage, objectReference } from './chatReferences'
export default function AgentPanel({ connection, selected, onSelect, disabled, active, replacementTarget, onReplacementOpened, ideas }: {
  ideas?: ReactNode
  connection: ReturnType<typeof useConnection>; selected: string | null
  onSelect: (id: string | null) => void; disabled: boolean; active: boolean
  replacementTarget: string | null; onReplacementOpened: () => void
}) {
  const { state, catalog, messages, status, agentStatus, activity, deliveries, send, reconnect } = connection
  const ideasAnchor = ideaMessageId(connection.variants, messages)
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return localStorage.getItem('cozy.voice.enabled') === 'true' } catch { return false }
  })
  const [text, setText] = useState('')
  const ideasMode = /^\/ideas(?:\s|$)/i.test(text.trimStart())
  const ideasPrompt = ideasMode ? text.trimStart().replace(/^\/ideas\s*/i, '').trim() || state?.brief || connection.variants?.request || '' : ''
  const [scope, setScope] = useState<string[]>([])
  const [replacement, setReplacement] = useState<string[] | null>(null)
  const [reason, setReason] = useState('')
  const composer = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (replacementTarget) { setReplacement([replacementTarget]); setReason(''); onReplacementOpened() }
  }, [replacementTarget, onReplacementOpened])
  useEffect(() => { if (replacement !== null) dialog.current?.showModal() }, [replacement])
  const blocked = disabled || status !== 'connected'
  const slots = Object.values(state?.slots ?? {})
  const groups = [...new Set(slots.map(s => `${s.zone} / ${s.group}`))]
  const expected = (ids: string[]) => Object.fromEntries(ids.flatMap(id => state?.slots[id]?.catalogId ? [[id, state.slots[id].catalogId!]] : []))
  const scrollToComposer = () => {
    const form = composer.current, body = form?.closest('.panel-body')
    if (form && body) body.scrollTop += form.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom + 12
  }
  useEffect(() => {
    if (!active) return
    const form = composer.current, body = form?.closest('.panel-body')
    if (!form || !body) return
    following.current = true
    const frame = requestAnimationFrame(scrollToComposer)
    const onScroll = () => { following.current = Math.abs(form.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom) < 80 }
    body.addEventListener('scroll', onScroll, { passive: true })
    return () => { cancelAnimationFrame(frame); body.removeEventListener('scroll', onScroll) }
  }, [active, voiceEnabled])
  useEffect(() => {
    if (!active || !following.current) return
    const frame = requestAnimationFrame(scrollToComposer)
    return () => cancelAnimationFrame(frame)
  }, [messages, active, status, voiceEnabled])
  useEffect(() => { setScope(selected ? [selected] : []) }, [selected])
  return <section className="agent-panel" aria-label="AI designer">
    <div className={`agent-status ${status}`} role="status"><i /> {activity}
      {agentStatus === 'working' && <span aria-label="Working"> ···</span>}
    </div>
    {status !== 'connected' && <button onClick={reconnect}>Reconnect</button>}
    <div className="agent-messages" role="log" aria-label="Design conversation" aria-live="polite">
      {!messages.length && !connection.variants && <p className="muted">Describe your room. Astra can build a concept around the pieces you add.</p>}
      {connection.variants && !ideasAnchor && <div className="idea-exchange">
        <article className="chat-user"><small>YOU</small><ReactMarkdown>{`/ideas ${connection.variants.request}`}</ReactMarkdown></article>
        {ideas}
      </div>}
      {messages.map(raw => {
        const m = displayMessage(raw, state, catalog)
        if (m.kind === 'activity') return <ChatActivity key={m.id} message={m} state={state} deliveries={deliveries} onSelect={onSelect} working={agentStatus === 'working'} />
        return <Fragment key={m.id}><article className={`chat-${m.role}`}><small>{m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'ASTRA' : 'STUDIO'}</small>
          {!!m.references?.length && <div className="object-references">{m.references.map(reference => <ObjectPill key={reference.slotId} reference={reference} available={!!state?.slots[reference.slotId]} onSelect={() => onSelect(reference.slotId)} />)}</div>}
          <ReactMarkdown>{m.text}</ReactMarkdown>{m.role === 'user' && deliveries[m.id] && <span className="delivery-status">{deliveryLabel(deliveries[m.id])}</span>}</article>
          {m.id === ideasAnchor && ideas}</Fragment>
      })}
    </div>
    <div ref={composer} className="chat-input-area">
      <div className="chat-input-mode">
        <button type="button" role="switch" aria-checked={voiceEnabled} className="voice-mode-switch" onClick={() => {
            const enabled = !voiceEnabled
            setVoiceEnabled(enabled)
            try { localStorage.setItem('cozy.voice.enabled', String(enabled)) } catch { /* Keep the choice for this page. */ }
          }}><span className="voice-switch-track" aria-hidden="true"><span /></span>Voice chat</button>
      </div>
      {voiceEnabled ? <VoiceControls sessionId={connection.sessionId} connected={!blocked} /> :
    <form onSubmit={e => { e.preventDefault(); if (blocked || !text.trim()) return
      if (ideasMode) {
        if (agentStatus !== 'working' && ideasPrompt && send({ type: 'variants.generate', text: ideasPrompt })) setText('')
        return
      }
      if (send(scope.length ? { type: 'feedback.send', action: 'comment', text, slotIds: scope, expectedProducts: expected(scope) } : { type: 'chat.send', text })) setText('')
    }}>
      <label htmlFor="design-message">{ideasMode ? 'Brief for three ideas' : scope.length ? `Comment on ${scope.length} selected ${scope.length === 1 ? 'piece' : 'pieces'}` : 'Your brief or feedback'}</label>
      <div className="feedback-scope"><button type="button" aria-pressed={ideasMode} disabled={blocked} onClick={() => { setText(ideasMode ? text.trimStart().replace(/^\/ideas\s*/i, '') : '/ideas ' + text); setScope([]); document.getElementById('design-message')?.focus() }}>Three ideas</button><button type="button" aria-pressed={!scope.length} onClick={() => { setScope([]); if (ideasMode) setText(text.trimStart().replace(/^\/ideas\s*/i, '')) }}>Whole room</button>{selected && !ideasMode && <button type="button" aria-pressed={scope.includes(selected)} onClick={() => setScope([selected])}>Selected piece</button>}</div>
      {!ideasMode && !!scope.length && <div className="object-references">{scope.map(id => <ObjectPill key={id} reference={objectReference(id, state, catalog)} available={!!state?.slots[id]} onSelect={() => onSelect(id)} onRemove={() => setScope(ids => ids.filter(value => value !== id))} />)}</div>}
      <textarea id="design-message" value={text} onChange={e => setText(e.target.value)} maxLength={6000} rows={3} placeholder="A calm bedroom with a workspace…" />
      {ideasMode && <p className="muted">Three whole-room alternatives · additional Astra usage.{connection.variants ? ' Replaces the current idea set.' : ''}{agentStatus === 'working' ? ' Finish the current response first.' : ''}</p>}
      <button className="primary" disabled={blocked || !text.trim() || (ideasMode ? !ideasPrompt || agentStatus === 'working' : scope.some(id => !state?.slots[id]))}>{ideasMode ? 'Generate three ideas' : agentStatus === 'working' ? 'Send feedback' : 'Send to Astra'}</button>
    </form>}
    </div>
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
