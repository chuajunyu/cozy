import { useState } from 'react'
import Room from './Room'
import { useConnection } from './useConnection'

export default function App() {
  const [lightAngle, setLightAngle] = useState(45)
  const [text, setText] = useState('Hello, cozy')
  const { status, messages, send, reconnect } = useConnection()

  return (
    <div className="app">
      <header className="header">
        <a className="brand" href="/" aria-label="Cozy home"><span className="brand-icon">⌂</span> cozy<span className="brand-dot">.</span></a>
        <span className="header-label">A LITTLE SPACE TO CREATE</span>
        <span className="version">STUDIO / 001</span>
      </header>
      <main>
        <section className="studio" aria-labelledby="room-title">
          <div className="studio-heading"><div><p className="eyebrow">YOUR CANVAS</p><h1 id="room-title">Room to imagine.</h1><p className="subtitle">Every good space starts with a little possibility.</p></div><span className="room-tag">01 / SAMPLE ROOM</span></div>
          <div className="viewport">
            <div className="viewport-label"><span className="small-dot" /> LIVE 3D VIEW</div>
            <Room lightAngle={lightAngle} />
            <div className="viewport-footer"><span>4.0 × 3.5 m</span><span>Drag to orbit <i>·</i> Scroll to zoom</span></div>
          </div>
          <div className="light-control">
            <div className="light-heading"><span className="sun-icon" aria-hidden="true">☼</span><div><label htmlFor="light-angle">Find your light</label><p>Explore how light falls across the room.</p></div></div>
            <div className="slider-group"><input id="light-angle" type="range" min="0" max="180" value={lightAngle} onChange={event => setLightAngle(Number(event.target.value))} /><output htmlFor="light-angle">{lightAngle}°</output></div>
          </div>
          <p className="lighting-note">Lighting preview only · Not a geographic sunlight simulation</p>
        </section>
        <aside className="connection-panel" aria-labelledby="connection-title">
          <p className="eyebrow">THE FOUNDATION</p>
          <h2 id="connection-title">Make a connection.</h2>
          <p className="panel-description">Your room is ready. Send a message to check the connection behind it.</p>
          <div className={`connection-status ${status}`} role="status"><span className="small-dot" /><span>{status === 'connected' ? 'Backend connected' : status === 'connecting' ? 'Connecting to backend…' : 'Backend disconnected'}</span></div>
          {status === 'disconnected' && <button className="reconnect" onClick={reconnect}>Reconnect</button>}
          <div className="conversation-header"><span>CONNECTION CHECK</span><span>WEBSOCKET</span></div>
          <div className="messages" role="log" aria-label="Connection messages" aria-live="polite">
            {messages.length === 0 ? <div className="empty-messages"><span aria-hidden="true">↔</span><p>A small hello goes a long way.</p><small>Send a message. The backend will echo it back.</small></div> : messages.map(message => <div key={message.id} className={`message ${message.direction}`}><span>{message.direction === 'sent' ? 'YOU' : message.direction === 'received' ? 'BACKEND' : 'CONNECTION'}</span><p>{message.text}</p></div>)}
          </div>
          <form onSubmit={event => { event.preventDefault(); if (text.trim() && send(text)) setText('') }}>
            <label className="input-label" htmlFor="message">Your message</label>
            <div className="message-input"><input id="message" value={text} onChange={event => setText(event.target.value)} placeholder="Say hello…" autoComplete="off" /><button type="submit" disabled={status !== 'connected' || !text.trim()} aria-label="Send message">↑</button></div>
          </form>
          <p className="panel-note">An echo test for now. A starting point for what comes next.</p>
        </aside>
      </main>
      <footer className="footer"><span>Made for spaces with potential.</span><span>COZY / ROOM STUDIO</span></footer>
    </div>
  )
}
