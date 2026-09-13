import { useCallback, useEffect, useRef, useState } from 'react'
import { acceptSnapshot } from './snapshot'
import { backupKey, makeBackup, migrateLegacy } from './backup'
import type { Backup, RestorePreview } from './types'
import type { ChatMessage, Command, DesignState, Product } from './types'

type Status = 'connecting' | 'connected' | 'disconnected'
const sessionKey = 'cozy.session.v1'

export function useConnection() {
  const socket = useRef<WebSocket | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<Status>('connecting')
  const [state, setState] = useState<DesignState | null>(null)
  const [catalog, setCatalog] = useState<Product[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agentStatus, setAgentStatus] = useState('idle')
  const [activity, setActivity] = useState('Ready when you are')
  const [error, setError] = useState('')
  const [feedbackStage, setFeedbackStage] = useState('')
  const [reviewCount, setReviewCount] = useState(0)
  const [backup, setBackup] = useState<string | null>(null)
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null)
  const [pending, setPending] = useState(false)
  const stateRef = useRef<DesignState | null>(null)
  const catalogRef = useRef<Product[]>([])
  const restoreRequest = useRef<string | null>(null)
  const pendingRequest = useRef<string | null>(null)
  const latestRequest = useRef<string | null>(null)

  useEffect(() => {
    setStatus('connecting')
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const connection = new WebSocket(`${scheme}://${window.location.host}/ws`)
    socket.current = connection
    connection.onopen = () => {
      let sessionId = null
      try { sessionId = sessionStorage.getItem(sessionKey) } catch { /* Memory-only browser mode. */ }
      connection.send(JSON.stringify({ type: 'session.init', sessionId }))
    }
    connection.onclose = () => { setStatus('disconnected'); setPending(false); pendingRequest.current = null }
    connection.onerror = () => setError('Connection interrupted. Your last room remains visible.')
    connection.onmessage = event => {
      try {
        const payload = JSON.parse(event.data)
        switch (payload.type) {
          case 'session.ready':
            setRestorePreview(null)
            try { sessionStorage.setItem(sessionKey, payload.sessionId) } catch { /* Browser storage may be disabled. */ }
            setReviewCount(payload.catalogSummary?.reviewCount ?? 0)
            stateRef.current = payload.state; catalogRef.current = payload.catalog
            setState(payload.state); setCatalog(payload.catalog); setMessages(payload.messages)
            setPending(false); pendingRequest.current = null
            try {
              const stored = localStorage.getItem(backupKey) ?? localStorage.getItem('cozy.studio.v2') ?? localStorage.getItem('cozy-studio-v1')
              setBackup(payload.state.revision === 0 && stored ? stored : null)
            } catch { /* Storage is optional. */ }
            setAgentStatus(payload.status); setActivity(payload.activity); setStatus('connected')
            setError(payload.reset ? 'This session expired or the server restarted. Restore your device backup or start a new room.' : '')
            break
          case 'design.updated':
            stateRef.current = acceptSnapshot(stateRef.current, payload.state)
            setState(stateRef.current)
            break
          case 'catalog.updated': catalogRef.current = payload.catalog; setCatalog(payload.catalog); break
          case 'session.restore.preview':
            setRestorePreview(payload); setPending(false); pendingRequest.current = null
            break
          case 'command.ack':
            if (payload.requestId === pendingRequest.current) { setPending(false); pendingRequest.current = null }
            if (payload.requestId === restoreRequest.current) { setBackup(null); setRestorePreview(null); restoreRequest.current = null }
            setFeedbackStage('applied')
            break
          case 'chat.message':
            setMessages(previous => [...previous.filter(m => m.id !== payload.message.id), payload.message].slice(-50))
            break
          case 'chat.delta':
            setMessages(previous => {
              const existing = previous.find(m => m.id === payload.id)
              return existing ? previous.map(m => m.id === payload.id ? { ...m, text: m.text + payload.text } : m)
                : [...previous, { id: payload.id, role: 'assistant' as const, text: payload.text }].slice(-50)
            })
            break
          case 'agent.status': setAgentStatus(payload.status); setActivity(payload.activity); break
          case 'feedback.ack':
            if (payload.requestId === pendingRequest.current) { setPending(false); pendingRequest.current = null }
            if (payload.requestId === latestRequest.current) setFeedbackStage(payload.stage)
            break
          case 'error': setError(payload.message); setFeedbackStage('failed'); if (!payload.requestId || payload.requestId === pendingRequest.current) { setPending(false); pendingRequest.current = null } break
          case 'connection.resync': setError('Connection fell behind. Reconnect to recover the latest room.'); break
        }
      } catch { setError('A message could not be read. Reconnect to resynchronize.') }
    }
    return () => {
      connection.onopen = null; connection.onclose = null; connection.onerror = null; connection.onmessage = null
      connection.close()
      if (socket.current === connection) socket.current = null
    }
  }, [attempt])

  const send = useCallback((command: Command) => {
    if (pendingRequest.current) { setError('Wait for the current room edit to finish.'); return false }
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Reconnect before sending an update.'); return false }
    try {
      const requestId = crypto.randomUUID()
      latestRequest.current = requestId
      const manual = !['chat.send', 'feedback.send'].includes(command.type)
      if (manual) { pendingRequest.current = requestId; setPending(true) }
      if (command.type === 'session.restore') restoreRequest.current = requestId
      socket.current.send(JSON.stringify({ ...command, baseRevision: command.baseRevision ?? stateRef.current?.revision, requestId }))
      setFeedbackStage('sending'); setError('')
      return true
    } catch { pendingRequest.current = null; setPending(false); setError('That update could not be sent. Please reconnect.'); return false }
  }, [])
  useEffect(() => {
    if (!state || state.revision === 0 || backup) return
    try { localStorage.setItem(backupKey, JSON.stringify(makeBackup(state, catalog))) }
    catch { setError('Device storage is full. The backend still holds your room.') }
  }, [state, catalog, backup])

  function restore() {
    if (!backup) return
    try {
      const raw = JSON.parse(backup)
      const saved: Backup = (raw.version === 2 || raw.version === 3) ? raw : migrateLegacy(backup, catalogRef.current)
      send({ type: 'session.restore.preview', backup: saved })
    } catch (e) { setError(e instanceof Error ? e.message : 'This backup could not be restored. It remains saved.') }
  }
  function applyRestore(allowLocked: string[]) { if (restorePreview) send({ type: 'session.restore', previewId: restorePreview.previewId, allowLocked }) }
  function dismissBackup() {
    // Preserve the previous save separately before allowing a new room to overwrite it.
    try { if (backup) {
      localStorage.setItem('cozy.studio.archived', backup)
      localStorage.removeItem(backupKey)
      localStorage.removeItem('cozy-studio-v1')
      localStorage.removeItem('cozy.studio.v2')
    } }
    catch { setError('Could not archive the saved room. Download it before starting fresh.'); return }
    setBackup(null); setRestorePreview(null)
  }
  return { restorePreview, applyRestore, reviewCount, backup, restore, dismissBackup, pending, status, state, catalog, messages, agentStatus, activity, error, feedbackStage, send, reconnect: () => setAttempt(value => value + 1) }
}
