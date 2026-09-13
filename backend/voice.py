"""GPT-Live media stays in WebRTC; trusted delegation reuses Astra's command path."""

import asyncio
import json
import logging
import os
import secrets
import time
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from openai import AsyncOpenAI, APIStatusError
from websockets.exceptions import ConnectionClosedError

from backend.astra import astra_tls_context
from backend.design import DesignError
from backend.protocol import Command, handle_command
from backend.sessions import Session
from backend.capabilities import CAPABILITY_GUIDANCE

logger = logging.getLogger("uvicorn.error")

VOICE_INSTRUCTIONS = """You are Astra, Cozy's friendly interior design voice assistant.
Speak briefly and naturally. Introduce yourself once as an AI voice assistant.
Do not repeat the introduction.
Backchannel policy: Use minimal backchannels. Let the user finish their request;
brief acknowledgments must not replace the actual answer.
Interruption policy: Yield to a clear user interruption or correction. Do not treat
background noise or a brief "mm-hm" as a new request. After listening, finish the
unanswered point unless the user cancels it or changes the request.
When a backend result arrives, explain it in one or two complete sentences.
Do not start another task unless the user requests it.
Delegate all room changes, catalog searches, prices, and questions about the actual room
 to the backend. It has the authoritative room, real IKEA products, budget and locks.
Never claim a change succeeded before the backend confirms it. Clarify ambiguous requests.
When the user corrects a request, delegate the correction too. You can keep conversing
while work runs. Speech interruption or ending voice does not cancel room work.
""" + CAPABILITY_GUIDANCE


class VoiceServiceError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__('Live returned an error')


def voice_error_message(exc: Exception, started: bool) -> str:
    code = getattr(exc, 'code', None)
    if code == 'insufficient_quota':
        return 'Voice stopped because the OpenAI project has exhausted its API quota or credits.'
    if code == 'rate_limit_exceeded' or isinstance(exc, APIStatusError) and exc.status_code == 429:
        return 'Voice reached an OpenAI rate limit. Wait briefly and start again.'
    if isinstance(exc, APIStatusError) and exc.status_code in {401, 403}:
        return 'OpenAI rejected voice access. Check the backend API key and project permissions.'
    if isinstance(exc, ConnectionClosedError):
        return 'The voice connection dropped. Your room is saved. Start voice again and repeat any request Astra did not acknowledge.'
    if isinstance(exc, ValueError):
        return str(exc)
    return ('Voice was interrupted. Your room is saved. Start voice again.' if started
            else 'Voice could not start. Check the backend connection and try again.')


def voice_close_message(reason: str) -> str:
    return {
        'expired': 'The voice provider ended this session at its time limit. Start voice again.',
        'connection_lost': 'The voice audio connection was lost. Start voice again.',
        'remote_hangup': 'The remote voice connection closed. Start voice again.',
        'content': 'The voice provider ended this session after a content safety check.',
        'close_requested': 'The voice session was closed. Start voice again to continue.',
    }.get(reason, 'The voice session ended. Start voice again.')


class VoiceBridge:
    def __init__(self, room: Session, connection: Any, designer_factory: Any) -> None:
        self.room = room
        self.connection = connection
        self.designer_factory = designer_factory
        self.pending: list[str] = []
        self.unsubmitted = ""
        self.input_id: str | None = None
        self.spoken_id: str | None = None
        self.answer = ""
        self.answer_id: str | None = None
        self.queue = asyncio.Queue(maxsize=1024)
        self.generation = room.generation
        self.seen: set[str] = set()
        self.awaiting: list[str] = []
        self.close_reason: str | None = None
        self.submit_task: asyncio.Task | None = None

    async def live_events(self) -> None:
        async for event in self.connection:
            payload = event.model_dump()
            event_id = payload.get('event_id')
            if event_id and event_id in self.seen:
                continue
            if event_id:
                self.seen.add(event_id)
            kind = payload['type']
            if kind == 'session.input_transcript.delta':
                self.unsubmitted = (self.unsubmitted + payload['delta'])[-6000:]
                if self.input_id is None:
                    self.input_id = 'voice-' + secrets.token_hex(12)
                self.room.message('user', self.unsubmitted, self.input_id)
                self.spoken_id = None
                self.schedule_submit()
            elif kind == 'session.output_transcript.delta':
                if self.spoken_id is None:
                    self.spoken_id = 'voice-' + secrets.token_hex(8)
                self.room.delta(self.spoken_id, payload['delta'])
            elif kind == 'session.delegation.created':
                self.awaiting.append(payload['delegation']['id'])
                self.schedule_submit()
            elif kind == 'session.closed':
                self.close_reason = payload.get('reason', 'unknown')
                logger.info('Live session finalized (reason=%s)', self.close_reason)
                return
            elif kind == 'error':
                code = payload.get('error', {}).get('code', 'unknown')
                logger.warning('Live event rejected (code=%s)', code)
                if code in {'insufficient_quota', 'invalid_api_key', 'model_not_found'}:
                    raise VoiceServiceError(code)
                # Invalid context appends are recoverable on the same Live session.
                # Do not hang up a speaking user because one command was rejected.
                self.room.publish({'type': 'voice.warning', 'message':
                    'A voice update could not be delivered. The call is still connected; please repeat the last request.'})

    def schedule_submit(self) -> None:
        if not self.awaiting:
            return
        if self.submit_task:
            self.submit_task.cancel()
        self.submit_task = asyncio.create_task(self.submit_pending())

    async def submit_pending(self) -> None:
        # Live transcripts have no turn-done event; briefly coalesce trailing deltas.
        await asyncio.sleep(0.7)
        # Delegation metadata contains no task text. Input deltas can arrive later.
        if self.room.generation != self.generation or not self.awaiting or not self.unsubmitted.strip():
            return
        self.pending.extend(self.awaiting)
        self.awaiting = []
        logger.info('Voice request delegated (pending=%s)', len(self.pending))
        text, self.unsubmitted = self.unsubmitted.strip(), ''
        request_id, self.input_id = self.input_id or 'voice-' + secrets.token_hex(12), None
        self.answer = ''
        self.answer_id = None
        try:
            await handle_command(self.room, Command(type='chat.send',
                requestId=request_id, text=text), self.designer_factory)
        except DesignError as exc:
            await self.report(str(exc))

    async def report(self, text: str) -> None:
        pending, self.pending = self.pending, []
        # Corrections can produce several delegations for the same running task.
        # Deliver one spoken result for the latest request, not repeated competing speech.
        if pending:
            logger.info('Voice result delivered (coalesced delegations=%s)', len(pending))
            await self.connection.session.commentary.append(
                delegation_id=pending[-1], content=text[:1400])

    async def room_events(self) -> None:
        while True:
            event = await self.queue.get()
            if self.room.generation != self.generation:
                return  # Restore/reset ends this voice context.
            if not self.pending:
                continue
            if event['type'] == 'chat.delta' and not event['id'].startswith('voice-'):
                if self.answer_id != event['id']:
                    self.answer_id = event['id']
                    self.answer = ''
                self.answer = (self.answer + event['text'])[-6000:]
            elif event['type'] == 'design.completed':
                await self.report(self.answer or 'Room processing finished. Ask the user to review the room.')
            elif event['type'] == 'error':
                await self.report('The request could not finish: ' + event['message'])


async def voice_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    room = None
    client = None
    live_id = None
    bridge = None
    tasks = []
    owns_voice = False
    started_at = time.monotonic()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), 20)
        if len(raw) > 100_000:
            raise ValueError('Voice connection request is too large.')
        payload = json.loads(raw)
        if not isinstance(payload, dict) or not isinstance(payload.get('sessionId'), str):
            raise ValueError('Reconnect to your room before starting voice.')
        room = websocket.app.state.sessions.sessions.get(payload['sessionId'])
        if room is None:
            raise ValueError('Reconnect to your room before starting voice.')
        if getattr(room, 'voice_active', False):
            raise ValueError('A voice conversation is already active for this room.')
        if not os.getenv('OPENAI_API_KEY'):
            raise ValueError('Configure OPENAI_API_KEY on the backend to use voice.')
        sdp = payload.get('sdp')
        if not isinstance(sdp, str) or not sdp.startswith('v=0'):
            raise ValueError('The browser could not prepare its audio connection.')
        room.voice_active = True
        owns_voice = True
        client = AsyncOpenAI(timeout=30, max_retries=0)
        created = await client.live.create(
            session={'model': 'gpt-live-1', 'instructions': VOICE_INSTRUCTIONS,
                     'delegation': {'type': 'client'}, 'store': False,
                     'client': {'data_channel': {'allowed_client_events': ['session.close'],
                        'allowed_server_events': [{'type': kind} for kind in
                            ['session.started', 'session.closed', 'session.input_transcript.delta',
                             'session.output_transcript.delta', 'error']]}},
                     'input': [{'role': m['role'], 'content': [{'type': 'input_text' if m['role'] == 'user' else 'output_text', 'text': m['text'][:1000]}]}
                               for m in room.messages[-8:] if m['role'] in {'user', 'assistant'} and m['text']]},
            transport={'type': 'webrtc', 'sdp': sdp})
        live_id = created.session.id
        def reconnecting(event: Any) -> None:
            # A callback is required to enable the SDK's reconnect behavior.
            logger.warning('Voice control reconnect %s/%s (close code %s)',
                event.attempt, event.max_attempts, event.close_code)

        async with client.live.sideband.connect(session_id=live_id, max_retries=3,
                on_reconnecting=reconnecting,
                websocket_connection_options={'ssl': astra_tls_context()}) as connection:
            bridge = VoiceBridge(room, connection, websocket.app.state.designer_factory)
            room.subscribers.add(bridge.queue)
            await websocket.send_json({'type': 'voice.answer', 'sdp': created.transport.sdp})
            async def browser_events() -> None:
                while True:
                    raw = await websocket.receive_text()
                    if raw == 'stop':
                        logger.info('Voice stopped by browser after %.1fs', time.monotonic() - started_at)
                        return
                    if len(raw) < 1000:
                        event = json.loads(raw)
                        if event.get('type') == 'voice.client_state':
                            state = event.get('state')
                            if state in {'started', 'connected', 'disconnected', 'failed', 'closed'}:
                                logger.info('Voice browser state=%s at %.1fs', state, time.monotonic() - started_at)
            tasks = [asyncio.create_task(bridge.live_events()),
                     asyncio.create_task(bridge.room_events()), asyncio.create_task(browser_events())]
            done, _ = await asyncio.wait(tasks, timeout=600, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
            if bridge.close_reason:
                await websocket.send_json({'type': 'voice.ended', 'message': voice_close_message(bridge.close_reason)})
            elif tasks[1] in done:
                await websocket.send_json({'type': 'voice.ended', 'message': 'Voice ended because the room was reset, restored or undone. Start voice again for the updated room.'})
            elif not done:
                await websocket.send_json({'type': 'voice.ended', 'message': 'The ten-minute voice session ended. Start voice again to continue.'})
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception as exc:
        logger.warning(
            'Voice failed after %.1fs (%s; received close=%s; sent close=%s; API code=%s)',
            time.monotonic() - started_at, type(exc).__name__,
            getattr(getattr(exc, 'rcvd', None), 'code', None),
            getattr(getattr(exc, 'sent', None), 'code', None), getattr(exc, 'code', None))
        message = voice_error_message(exc, live_id is not None)
        try:
            await websocket.send_json({'type': 'voice.error', 'message': message})
        except Exception:
            pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if bridge:
            if bridge.submit_task:
                bridge.submit_task.cancel()
                await asyncio.gather(bridge.submit_task, return_exceptions=True)
            room.subscribers.discard(bridge.queue)
        if owns_voice:
            room.voice_active = False
        if client:
            if live_id:
                try:
                    await client.live.sessions.hangup(live_id, timeout=5)
                except Exception:
                    pass
            await client.close()
        try:
            await websocket.close()
        except Exception:
            pass
