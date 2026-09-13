import { useCallback, useEffect, useRef, useState } from 'react'

type Status = 'connecting' | 'connected' | 'disconnected'
type Message = { id: number; direction: 'sent' | 'received' | 'error'; text: string }

export function useConnection() {
  const socket = useRef<WebSocket | null>(null)
  const nextId = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<Status>('connecting')
  const [messages, setMessages] = useState<Message[]>([])

  const append = useCallback((direction: Message['direction'], text: string) => {
    const message = { id: nextId.current++, direction, text }
    setMessages(previous => [...previous.slice(-49), message])
  }, [])

  useEffect(() => {
    setStatus('connecting')
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const connection = new WebSocket(`${scheme}://${window.location.host}/ws`)
    socket.current = connection
    connection.onopen = () => setStatus('connected')
    connection.onclose = () => setStatus('disconnected')
    connection.onerror = () => append('error', 'Connection failed. Check that the backend is running.')
    connection.onmessage = event => {
      try {
        const payload: unknown = JSON.parse(event.data)
        if (!payload || typeof payload !== 'object') throw new Error('Invalid event')
        if ('type' in payload && payload.type === 'echo' && 'text' in payload && typeof payload.text === 'string') {
          append('received', payload.text)
        } else if ('type' in payload && payload.type === 'error' && 'message' in payload && typeof payload.message === 'string') {
          append('error', payload.message)
        } else {
          append('error', 'Received an unsupported event from the backend.')
        }
      } catch {
        append('error', 'Received an invalid message from the backend.')
      }
    }
    return () => {
      connection.onopen = null
      connection.onclose = null
      connection.onerror = null
      connection.onmessage = null
      connection.close()
      if (socket.current === connection) socket.current = null
    }
  }, [attempt, append])

  function send(text: string) {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      append('error', 'Connect to the backend before sending a message.')
      return false
    }
    try {
      socket.current.send(JSON.stringify({ type: 'echo', text }))
      append('sent', text)
      return true
    } catch {
      append('error', 'Message could not be sent. Please reconnect.')
      return false
    }
  }

  return { status, messages, send, reconnect: () => setAttempt(value => value + 1) }
}
