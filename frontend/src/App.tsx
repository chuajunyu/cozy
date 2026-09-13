import { useCallback, useEffect, useRef, useState } from 'react'
import Room from './Room'
import { useConnection } from './useConnection'
import type { Slot } from './types'
import Markdown from 'react-markdown'

const money = (value: number) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(value)
const reasons = ['Too expensive', 'Wrong color', 'Wrong material', 'Too modern', 'Wrong size', 'Comfort preference']
const groupLabel = (value: string) => value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function App() {
  const [lightAngle, setLightAngle] = useState(65)
  const [text, setText] = useState('Design a cosy bedroom with a workspace, warm wood, and calming colors.')
  const [budget, setBudget] = useState('1500')
  const [selected, setSelected] = useState<string[]>([])
  const [scope, setScope] = useState('room')
  const [replacement, setReplacement] = useState<string[] | null>(null)
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const { status, state, catalog, messages, agentStatus, activity, error, feedbackStage, send, reconnect } = useConnection()
  const log = useRef<HTMLDivElement>(null)
  const connected = status === 'connected'
  const slots = Object.values(state?.slots ?? {})
  const groups = [...new Set(slots.map(s => `${s.zone} / ${s.group}`))]
  const selectedSlots = slots.filter(s => selected.includes(s.id))
  const unlockedSelection = selectedSlots.filter(s => s.catalogId && !s.locked)
  const onSelect = useCallback((id: string) => setSelected(previous => previous.includes(id) ? previous.filter(s => s !== id) : [...previous, id]), [])
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [messages])
  useEffect(() => { if (state?.budget != null) setBudget(String(state.budget)) }, [state?.budget])

  function expected(ids: string[]) {
    return Object.fromEntries(ids.flatMap(id => state?.slots[id]?.catalogId ? [[id, state.slots[id].catalogId!]] : []))
  }
  function openReplacement(ids: string[]) { setReplacement(ids); setReason(''); setDetail('') }
  function lock(slot: Slot) { send({ type: 'item.lock', slotIds: [slot.id], expectedProducts: expected([slot.id]), locked: !slot.locked }) }

  return <div className="app">
    <header className="header"><a className="brand" href="/" aria-label="Cozy home"><span className="brand-icon">⌂</span> cozy<span className="brand-dot">.</span></a><span className="header-label">A LITTLE SPACE TO CREATE</span><span className="version">YOUR DESIGN STUDIO</span></header>
    <main>
      <section className="studio" aria-labelledby="room-title">
        <div className="studio-heading"><div><p className="eyebrow">{state?.concept.summary ? 'YOUR CONCEPT' : 'YOUR CANVAS'}</p><h1 id="room-title">{state?.concept.summary ? state.concept.title : 'Room to imagine.'}</h1><p className="subtitle">{state?.concept.summary || 'Start with a feeling. Shape a room together.'}</p></div></div>
        {state?.concept.palette.length ? <div className="concept-tags">{[...state.concept.palette, ...state.concept.materials].map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div> : null}
        <div className="viewport"><div className="viewport-label"><span className="small-dot" /> {slots.some(s => s.catalogId) ? 'YOUR EVOLVING ROOM' : 'AN EMPTY CANVAS'}</div><Room lightAngle={lightAngle} state={state} catalog={catalog} selected={selected} onSelect={onSelect} /><div className="viewport-footer"><span>4.0 × 3.5 m</span><span>Drag to orbit <i>·</i> Click a piece to select</span></div></div>
        <div className="light-control"><div className="light-heading"><span className="sun-icon" aria-hidden="true">☼</span><div><label htmlFor="light-angle">Find your light</label><p>A lighting preview, just for exploring.</p></div></div><div className="slider-group"><input id="light-angle" type="range" min="0" max="180" value={lightAngle} onChange={event => setLightAngle(Number(event.target.value))} /><output htmlFor="light-angle">{lightAngle}°</output></div></div>
        <section className="concept-board" aria-labelledby="board-title">
          <div className="board-heading"><div><p className="eyebrow">CURATED TO WORK TOGETHER</p><h2 id="board-title">Your concept board</h2></div><div className="budget-total"><strong>{money(state?.total ?? 0)}</strong><span>{state?.budget ? `of ${money(state.budget)}` : 'No budget set'}</span></div></div>
          {state?.validationIssues?.map(issue => <p key={issue} className="error-notice" role="status">{issue} Your existing arrangement stays visible while Astra revises it.</p>)}
          <div className="board-actions"><span>{selectedSlots.length ? `${selectedSlots.length} selected` : 'Keep what you love. Refine the rest.'}</span><button disabled={!connected || !unlockedSelection.length} onClick={() => openReplacement(unlockedSelection.map(s => s.id))}>Reroll selected</button><button disabled={!connected || !slots.some(s => s.catalogId && !s.locked)} onClick={() => openReplacement([])}>Reroll unlocked</button>{selected.length > 0 && <button onClick={() => setSelected([])}>Clear selection</button>}</div>
          {!groups.length && <div className="board-empty"><span>01 — A direction</span><span>02 — Anchor pieces</span><span>03 — Supporting details</span><p>Your designer will build a cohesive room in coordinated groups. You can jump in at any point.</p></div>}
          {groups.map(group => <section className="design-group" key={group} aria-label={group}><div className="group-heading"><h3>{groupLabel(group)}</h3><button disabled={!connected} onClick={() => { setSelected(slots.filter(s => `${s.zone} / ${s.group}` === group).map(s => s.id)); setScope('selection'); document.getElementById('message')?.focus() }}>Comment on group</button></div><div className="item-grid">{slots.filter(s => `${s.zone} / ${s.group}` === group).map(slot => {
            const p = catalog.find(p => p.id === slot.catalogId)
            return <article className={`item-card ${selected.includes(slot.id) ? 'selected' : ''} ${slot.locked ? 'locked' : ''}`} key={slot.id}>
              <button className="item-select" aria-pressed={selected.includes(slot.id)} aria-label={`Select ${slot.label}`} onClick={() => onSelect(slot.id)}><span className="item-swatch" style={{ background: p?.color ?? '#e6e6da' }}>{slot.anchor ? '✦' : '◇'}</span><span><small>{slot.label}{slot.anchor ? ' · ANCHOR' : ''}</small><strong>{p?.name ?? 'Finding the right piece…'}</strong></span><span className="selection-indicator">{selected.includes(slot.id) ? '✓' : '+'}</span></button>
              {p && <><div className="item-details"><span>{p.material} · {p.style}</span><strong>{money(p.price)}</strong></div><p className="item-explanation">{slot.explanation}</p><div className="item-status">{slot.locked ? '● Product & placement locked' : slot.replacing ? '↻ Finding an alternative; current piece stays for now' : `${p.width} × ${p.depth} m footprint`}</div><div className="item-actions"><button disabled={!connected || slot.liked} aria-pressed={slot.liked} onClick={() => send({ type: 'feedback.send', action: 'like', slotIds: [slot.id], expectedProducts: expected([slot.id]) })}>{slot.liked ? '♥ Liked' : '♡ Like'}</button><button disabled={!connected} aria-pressed={slot.locked} onClick={() => lock(slot)}>{slot.locked ? 'Unlock' : 'Lock'}</button><button disabled={!connected || slot.locked || slot.replacing} onClick={() => openReplacement([slot.id])}>Replace</button></div></>}
            </article>
          })}</div></section>)}
          <p className="lighting-note">Curated demo furniture · Illustrative SGD prices and simplified models · Lighting is not a geographic sunlight simulation</p>
        </section>
      </section>
      <aside className="connection-panel" aria-labelledby="designer-title">
        <p className="eyebrow">YOUR INTERIOR DESIGNER</p><h2 id="designer-title">A conversation, by design.</h2><p className="panel-description">A cohesive vision, shaped around you. Share a thought while Astra works, or let the room come together.</p>
        <div className={`connection-status ${status}`} role="status"><span className="small-dot" /><span>{!connected ? status === 'connecting' ? 'Connecting to your studio…' : 'Studio disconnected' : activity}</span>{connected && agentStatus === 'working' && <span className="working-indicator">···</span>}</div>
        {status === 'disconnected' && <button className="reconnect" onClick={reconnect}>Reconnect</button>}
        {error && <div className="error-notice" role="alert">{error}</div>}
        <div className="conversation-header"><span>THE DESIGN CONVERSATION</span><span>{agentStatus === 'working' ? 'IN PROGRESS' : 'OPEN'}</span></div>
        <div ref={log} className="messages" role="log" aria-label="Design conversation" aria-live="polite">{!messages.length && <div className="empty-messages"><span aria-hidden="true">✦</span><p>What would feel like home?</p><small>Tell Astra how you want to use this room.</small></div>}{messages.map(message => <div key={message.id} className={`message ${message.role === 'user' ? 'sent' : 'received'}`}><span>{message.role === 'user' ? 'YOU' : 'ASTRA'}</span>{message.role === 'assistant' ? <div className="markdown-message"><Markdown skipHtml components={{ img: () => null }}>{message.text}</Markdown></div> : <p>{message.text}</p>}</div>)}</div>
        <form onSubmit={event => {
          event.preventDefault()
          const targeted = scope === 'selection' && selectedSlots.length > 0
          const command = targeted ? { type: 'feedback.send' as const, action: 'comment' as const, text, slotIds: selectedSlots.map(s => s.id), expectedProducts: expected(selectedSlots.map(s => s.id)) } : { type: 'chat.send' as const, text, ...(!state?.brief && budget ? { budget: Number(budget) } : {}) }
          if (text.trim() && send(command)) setText('')
        }}>
          {!state?.brief && <label className="budget-input">Room budget (SGD, optional)<input type="number" min="1" max="1000000" value={budget} onChange={e => setBudget(e.target.value)} placeholder="No budget" /></label>}
          <div className="composer-heading"><label className="input-label" htmlFor="message">{agentStatus === 'working' ? 'Add a thought while Astra works' : 'Your brief or feedback'}</label><select aria-label="Comment scope" value={scope} onChange={e => setScope(e.target.value)}><option value="room">Whole room</option><option value="selection" disabled={!selectedSlots.length}>Selected pieces</option></select></div>
          <textarea id="message" value={text} onChange={e => setText(e.target.value)} placeholder="Warmer colors? A place to read? Tell me…" rows={4} maxLength={6000} />
          <button className="send-design" type="submit" disabled={!connected || !text.trim()}>{state?.brief ? 'Send to Astra' : 'Design my room'} <span>↗</span></button>
        </form>
        <p className="feedback-status" role="status">{feedbackStage === 'queued' || feedbackStage === 'sent' ? 'Your feedback is queued for Astra.' : feedbackStage === 'received' ? 'Update received. Your choices are saved.' : feedbackStage === 'applied' ? 'Your update is included.' : feedbackStage === 'sending' ? 'Sending your update…' : ''}</p>
        <p className="panel-note">Lock anchors to preserve both the piece and its placement. Likes help shape the direction.</p>
      </aside>
    </main>
    <footer className="footer"><span>Made for spaces with potential.</span><span>COZY / ROOM STUDIO</span></footer>
    {replacement !== null && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setReplacement(null) }}><section className="replace-dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title" onKeyDown={event => { if (event.key === 'Escape') setReplacement(null) }}><p className="eyebrow">A LITTLE REFINEMENT</p><h2 id="replace-title">What would you change?</h2><p>{replacement.length ? 'Replace these pieces while preserving the rest of your concept.' : 'Reconsider all unlocked pieces around the anchors you love.'} A reason is optional.</p><div className="reason-options">{reasons.map(option => <button key={option} aria-pressed={reason === option} onClick={() => setReason(reason === option ? '' : option)}>{option}</button>)}</div><label htmlFor="replace-detail">Anything else?</label><textarea autoFocus id="replace-detail" value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="I’d prefer warm wood over glass…" maxLength={2000} /><div className="dialog-actions"><button onClick={() => setReplacement(null)}>Keep for now</button><button className="primary" disabled={!connected} onClick={() => { if (send({ type: 'feedback.send', action: replacement.length ? 'reroll' : 'reroll_unlocked', slotIds: replacement, expectedProducts: expected(replacement), text: [reason, detail].filter(Boolean).join('. ') })) setReplacement(null) }}>Find alternatives ↗</button></div></section></div>}
  </div>
}
