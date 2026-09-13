import { useCallback, useEffect, useRef, useState } from 'react'

type VoiceResources = { peer: RTCPeerConnection; stream?: MediaStream; socket?: WebSocket; timer?: ReturnType<typeof setTimeout>; disconnectTimer?: ReturnType<typeof setTimeout> }

export default function VoiceControls({ sessionId, connected }: { sessionId: string | null; connected: boolean }) {
  const [status, setStatus] = useState<'off' | 'connecting' | 'live'>('off')
  const [muted, setMuted] = useState(false)
  const [notice, setNotice] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const resources = useRef<VoiceResources | null>(null)
  const stop = useCallback(() => {
    const current = resources.current
    resources.current = null
    if (current) {
      clearTimeout(current.timer)
      clearTimeout(current.disconnectTimer)
      current.stream?.getTracks().forEach(track => track.stop())
      current.peer.close()
      if (current.socket?.readyState === WebSocket.OPEN) current.socket.send('stop')
      current.socket?.close()
    }
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null }
    setStatus('off'); setMuted(false)
  }, [])
  useEffect(() => stop, [stop])
  useEffect(() => stop, [sessionId, stop])

  async function start() {
    if (!sessionId || resources.current) return
    setNotice(''); setStatus('connecting')
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setNotice('Voice needs microphone support and HTTPS or localhost.'); setStatus('off'); return
    }
    const current: VoiceResources = { peer: new RTCPeerConnection() }
    resources.current = current
    const fail = (message: string) => {
      if (resources.current !== current) return
      stop(); setNotice(message)
    }
    current.timer = setTimeout(() => fail('Voice connection timed out. Try again.'), 45000)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (resources.current !== current) { stream.getTracks().forEach(track => track.stop()); return }
      current.stream = stream
      stream.getAudioTracks().forEach(track => current.peer.addTrack(track, stream))
      current.peer.ontrack = event => {
        if (!audio.current || resources.current !== current) return
        audio.current.srcObject = new MediaStream([event.track])
        void audio.current.play().catch(() => setNotice('Press play below to hear Astra.'))
      }
      current.peer.onconnectionstatechange = () => {
        if (resources.current !== current) return
        clearTimeout(current.disconnectTimer)
        if (current.socket?.readyState === WebSocket.OPEN) current.socket.send(JSON.stringify({ type: 'voice.client_state', state: current.peer.connectionState }))
        if (current.peer.connectionState === 'failed') fail('Voice disconnected. You can start again.')
        else if (current.peer.connectionState === 'disconnected') {
          setNotice('Audio connection interrupted; trying to recover…')
          current.disconnectTimer = setTimeout(() => fail('Audio could not recover. Start voice again.'), 15000)
        } else if (current.peer.connectionState === 'connected') setNotice('')
      }
      const channel = current.peer.createDataChannel('oai-events')
      channel.onmessage = event => {
        if (resources.current !== current) return
        const payload = JSON.parse(event.data)
        if (payload.type === 'session.started') {
          clearTimeout(current.timer); setStatus('live')
          if (current.socket?.readyState === WebSocket.OPEN) current.socket.send(JSON.stringify({ type: 'voice.client_state', state: 'started' }))
        } else if (payload.type === 'session.closed') {
          const reasons: Record<string, string> = {
            expired: 'The voice provider ended this session at its time limit. Start voice again.',
            connection_lost: 'The voice audio connection was lost. Start voice again.',
            remote_hangup: 'The remote voice connection closed. Start voice again.',
            content: 'The voice provider ended this session after a content safety check.',
            close_requested: 'The voice session was closed. Start voice again to continue.',
          }
          fail(reasons[payload.reason] ?? 'The voice session ended. Start voice again.')
        }
        else if (payload.type === 'error') setNotice('A voice update was rejected; the call remains connected. Please repeat the last request.')
      }
      channel.onclose = () => fail('The voice data connection closed. Start voice again.')
      await current.peer.setLocalDescription(await current.peer.createOffer())
      if (current.peer.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { current.peer.removeEventListener('icegatheringstatechange', ready); reject(new Error('Audio network setup timed out.')) }, 10000)
          function ready() {
            if (current.peer.iceGatheringState === 'complete') {
              clearTimeout(timer); current.peer.removeEventListener('icegatheringstatechange', ready); resolve()
            }
          }
          current.peer.addEventListener('icegatheringstatechange', ready)
        })
      }
      if (resources.current !== current) return
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      const socket = new WebSocket(`${scheme}://${location.host}/ws/voice`)
      current.socket = socket
      socket.onopen = () => socket.send(JSON.stringify({ sessionId, sdp: current.peer.localDescription?.sdp }))
      socket.onmessage = event => {
        if (resources.current !== current) return
        const payload = JSON.parse(event.data)
        if (payload.type === 'voice.error' || payload.type === 'voice.ended') fail(payload.message)
        else if (payload.type === 'voice.answer') void current.peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp }).catch(() => fail('Could not establish audio. Try again.'))
      }
      socket.onerror = () => fail('Could not reach the voice backend.')
      socket.onclose = () => fail('The connection to the voice backend closed. Start voice again.')
    } catch (error) {
      fail(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in your browser to use voice.'
        : 'Could not start audio. Check your microphone and try again.')
    }
  }

  return <div className="voice-controls">
    <div className="voice-actions">
      {status === 'off' ? <button type="button" disabled={!connected || !sessionId} onClick={() => void start()}>Start voice</button>
        : <><button type="button" onClick={stop}>{status === 'connecting' ? 'Cancel voice' : 'End voice'}</button>
          {status === 'live' && <button type="button" aria-pressed={muted} onClick={() => {
            resources.current?.stream?.getAudioTracks().forEach(track => { track.enabled = muted })
            setMuted(value => !value)
          }}>{muted ? 'Unmute microphone' : 'Mute microphone'}</button>}</>}
    </div>
    <small role="status">{notice || (status === 'connecting' ? 'Connecting voice…' : status === 'live' ? muted ? 'Microphone muted' : 'Listening · You can speak naturally' : 'Talk with Astra · AI-generated voice')}</small>
    <audio ref={audio} autoPlay controls hidden={status === 'off'} aria-label="Astra voice playback" />
  </div>
}
