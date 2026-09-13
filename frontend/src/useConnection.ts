import { useCallback, useEffect, useRef, useState } from 'react'
import { acceptSnapshot } from './snapshot'
import { backupKey, makeBackup } from './backup'
import { automaticRestore, readSavedRoom } from './recovery'
import type { ChatMessage, Command, DesignState, Product } from './types'

type Status = 'connecting' | 'connected' | 'disconnected'
const sessionKey = 'cozy.session.v1'
const conversationKey = 'cozy.conversation.v1'

function savedConversation(): { sessionId: string | null; messages: ChatMessage[] } {
  try {
    const sessionId = sessionStorage.getItem(sessionKey)
    const saved = JSON.parse(sessionStorage.getItem(conversationKey) ?? 'null')
    return { sessionId, messages: saved?.sessionId === sessionId && Array.isArray(saved.messages) ? saved.messages : [] }
  } catch { return { sessionId: null, messages: [] } }
}

export function useConnection() {
  const saved = useRef(savedConversation())
  const socket = useRef<WebSocket | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [state, setState] = useState<DesignState | null>(null)
  const [catalog, setCatalog] = useState<Product[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>(saved.current.messages)
  const [agentStatus, setAgentStatus] = useState('idle')
  const [activity, setActivity] = useState('Ready when you are')
  const [error, setError] = useState('')
  const [feedbackStage, setFeedbackStage] = useState('')
  const [reviewCount, setReviewCount] = useState(0)
  const [backup, setBackup] = useState<string | null>(null)
  const [recoveryError, setRecoveryError] = useState('')
  const [diagnostic, setDiagnostic] = useState('')
  const [pending, setPending] = useState(false)
  const stateRef = useRef<DesignState | null>(null)
  const catalogRef = useRef<Product[]>([])
  const restoreRequest = useRef<string | null>(null)
  const previewRequest = useRef<string | null>(null)
  const recoveryAttempt = useRef<string | null>(null)
  const retryCount = useRef(0)
  const pendingRequest = useRef<string | null>(null)
  const latestRequest = useRef<string | null>(null)

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setStatus('connecting')
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const connection = new WebSocket(`${scheme}://${window.location.host}/ws`)
    socket.current = connection
    connection.onopen = () => {
      connection.send(JSON.stringify({ type: 'session.init', ...saved.current }))
    }
    connection.onclose = () => {
      setStatus('disconnected'); setPending(false); pendingRequest.current = null
      previewRequest.current = null; restoreRequest.current = null; recoveryAttempt.current = null
      retryTimer = setTimeout(() => setAttempt(value => value + 1), Math.min(1000 * 2 ** retryCount.current++, 10000))
    }
    connection.onerror = () => setDiagnostic('Connection interrupted; automatic reconnect is active.')
    connection.onmessage = event => {
      try {
        const payload = JSON.parse(event.data)
        switch (payload.type) {
          case 'session.ready':
            saved.current = { sessionId: payload.sessionId, messages: payload.messages }
            setSessionId(payload.sessionId)
            retryCount.current = 0
            previewRequest.current = null; restoreRequest.current = null; recoveryAttempt.current = null
            setRecoveryError('')
            try { sessionStorage.setItem(sessionKey, payload.sessionId) } catch { /* Browser storage may be disabled. */ }
            setReviewCount(payload.catalogSummary?.reviewCount ?? 0)
            stateRef.current = payload.state; catalogRef.current = payload.catalog
            setCatalog(payload.catalog); setMessages(payload.messages)
            setPending(false); pendingRequest.current = null
            try {
              const stored = localStorage.getItem(backupKey) ?? localStorage.getItem('cozy.studio.v2') ?? localStorage.getItem('cozy-studio-v1')
              const saved = payload.state.revision === 0 && !Object.keys(payload.state.slots).length ? stored : null
              setBackup(saved)
              // Keep the last rendered room during recovery after a backend restart.
              if (!saved) setState(payload.state)
            } catch { setBackup(null); setState(payload.state) }
            setAgentStatus(payload.status); setActivity(payload.activity); setStatus('connected')
            setError('')
            break
          case 'design.updated':
            stateRef.current = acceptSnapshot(stateRef.current, payload.state)
            setState(stateRef.current)
            break
          case 'catalog.updated': catalogRef.current = payload.catalog; setCatalog(payload.catalog); break
          case 'session.restore.preview':
            if (payload.requestId !== previewRequest.current) break
            previewRequest.current = null; setPending(false); pendingRequest.current = null
            {
              const command = automaticRestore(payload)
              if (command) send(command)
              else { setRecoveryError('Your saved room couldn’t be opened.'); setDiagnostic(payload.blockers.join(' ')) }
            }
            break
          case 'command.ack':
            if (payload.requestId === pendingRequest.current) { setPending(false); pendingRequest.current = null }
            if (payload.requestId === restoreRequest.current) { setBackup(null); setRecoveryError(''); restoreRequest.current = null }
            setFeedbackStage('applied')
            break
          case 'voice.warning':
            setError(payload.message)
            break
          case 'chat.message':
            setMessages(previous => previous.some(m => m.id === payload.message.id)
              ? previous.map(m => m.id === payload.message.id ? payload.message : m)
              : [...previous, payload.message].slice(-50))
            break
          case 'chat.delta':
            if (payload.internal) break
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
          case 'error':
            setDiagnostic(payload.message)
            if (payload.requestId && [previewRequest.current, restoreRequest.current].includes(payload.requestId)) {
              setRecoveryError('Your saved room couldn’t be opened.')
              previewRequest.current = null; restoreRequest.current = null
            } else setError(payload.message)
            setFeedbackStage('failed')
            if (!payload.requestId || payload.requestId === pendingRequest.current) { setPending(false); pendingRequest.current = null }
            break
          case 'connection.resync': setAttempt(value => value + 1); break
        }
      } catch { setDiagnostic('Unreadable server message; reconnecting.'); setAttempt(value => value + 1) }
    }
    return () => {
      clearTimeout(retryTimer)
      connection.onopen = null; connection.onclose = null; connection.onerror = null; connection.onmessage = null
      connection.close()
      if (socket.current === connection) socket.current = null
      pendingRequest.current = null; previewRequest.current = null; restoreRequest.current = null
    }
  }, [attempt])

  useEffect(() => {
    const history = messages.filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-50).map(m => ({ ...m, text: m.text.slice(-6000) }))
    saved.current = { sessionId: saved.current.sessionId, messages: history }
    try { sessionStorage.setItem(conversationKey, JSON.stringify(saved.current)) }
    catch { setDiagnostic('Chat recovery is available in memory only; browser storage is unavailable.') }
  }, [messages, sessionId])

  const send = useCallback((command: Command) => {
    const manual = !['chat.send', 'feedback.send'].includes(command.type)
    if (manual && pendingRequest.current) { setError('Wait for the current room edit to finish.'); return false }
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Reconnect before sending an update.'); return false }
    try {
      const requestId = crypto.randomUUID()
      latestRequest.current = requestId
      if (manual) { pendingRequest.current = requestId; setPending(true) }
      if (command.type === 'session.restore') restoreRequest.current = requestId
      if (command.type === 'session.restore.preview') previewRequest.current = requestId
      socket.current.send(JSON.stringify({ ...command, baseRevision: command.baseRevision ?? stateRef.current?.revision, requestId }))
      setFeedbackStage('sending'); setError('')
      return true
    } catch { pendingRequest.current = null; setPending(false); setError('That update could not be sent. Please reconnect.'); return false }
  }, [])
  useEffect(() => {
    if (!state || state !== stateRef.current || state.revision === 0 || backup) return
    try { localStorage.setItem(backupKey, JSON.stringify(makeBackup(state, catalog))) }
    catch { setError('Changes couldn’t be saved on this device.'); setDiagnostic('Device storage is unavailable or full; the backend still holds the room.') }
  }, [state, catalog, backup])

  function restore() {
    if (!backup) return
    try {
      setRecoveryError('')
      const saved = readSavedRoom(backup, catalogRef.current)
      if (!send({ type: 'session.restore.preview', backup: saved })) setRecoveryError('Your saved room couldn’t be opened.')
    } catch (e) { setRecoveryError('Your saved room couldn’t be opened.'); setDiagnostic(e instanceof Error ? e.message : 'Unreadable backup.') }
  }
  useEffect(() => {
    if (status !== 'connected' || !backup || recoveryAttempt.current === backup) return
    recoveryAttempt.current = backup
    restore()
  }, [status, backup, attempt])

  function resetRoom() {
    if (status !== 'connected' || pendingRequest.current) return false
    // Preserve the previous save separately before allowing a new room to overwrite it.
    try { if (backup) {
      localStorage.setItem('cozy.studio.archived', backup)
      // Keep the active save until the server accepts the reset and its empty
      // snapshot replaces it. A failed send must not erase the startup backup.
    } }
    catch { setRecoveryError('Your saved room couldn’t be archived.'); return false }
    if (!send({ type: 'room.clear', allowLocked: Object.values(stateRef.current?.slots ?? {}).filter(slot => slot.locked).map(slot => slot.id) })) return false
    setBackup(null); setRecoveryError(''); setError('')
    return true
  }
  return { sessionId, recoveryError, diagnostic, resetRoom, reviewCount, backup, restore, pending, status, state, catalog, messages, agentStatus, activity, error, feedbackStage, send, dismissError: () => setError(''), reconnect: () => setAttempt(value => value + 1) }
}
