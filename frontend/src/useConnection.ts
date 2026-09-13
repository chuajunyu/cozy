import { useCallback, useEffect, useRef, useState } from 'react'
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
    connection.onclose = () => setStatus('disconnected')
    connection.onerror = () => setError('Connection interrupted. Your last room remains visible.')
    connection.onmessage = event => {
      try {
        const payload = JSON.parse(event.data)
        switch (payload.type) {
          case 'session.ready':
            try { sessionStorage.setItem(sessionKey, payload.sessionId) } catch { /* Browser storage may be disabled. */ }
            setState(payload.state); setCatalog(payload.catalog); setMessages(payload.messages)
            setAgentStatus(payload.status); setActivity(payload.activity); setStatus('connected')
            setError(payload.reset ? 'This session expired or the server restarted. Start a new design below.' : '')
            break
          case 'design.updated':
            setState(current => !current || payload.state.revision >= current.revision ? payload.state : current)
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
          case 'feedback.ack': if (payload.requestId === latestRequest.current) setFeedbackStage(payload.stage); break
          case 'error': setError(payload.message); setFeedbackStage('failed'); break
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
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Reconnect before sending an update.'); return false }
    try {
      const requestId = crypto.randomUUID()
      latestRequest.current = requestId
      socket.current.send(JSON.stringify({ ...command, requestId }))
      setFeedbackStage('sending'); setError('')
      return true
    } catch { setError('That update could not be sent. Please reconnect.'); return false }
  }, [])
  return { status, state, catalog, messages, agentStatus, activity, error, feedbackStage, send, reconnect: () => setAttempt(value => value + 1) }
}
