import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from backend.main import app
from backend.sessions import Session
from backend.voice import VoiceBridge


def test_voice_requires_existing_room():
    with TestClient(app) as client:
        with client.websocket_connect('/ws/voice') as socket:
            socket.send_json({'sessionId': 'missing', 'sdp': 'v=0'})
            assert socket.receive_json() == {
                'type': 'voice.error',
                'message': 'Reconnect to your room before starting voice.',
            }


def test_voice_waits_for_transcript_then_uses_budget_command_and_returns_result():
    async def run():
        room = Session()
        submitted = []

        class Designer:
            def __init__(self, room):
                pass

            async def run(self):
                await asyncio.Future()

            def submit(self, request_id, text):
                submitted.append(text)

        commentary = AsyncMock()
        connection = SimpleNamespace(session=SimpleNamespace(commentary=SimpleNamespace(append=commentary)))
        bridge = VoiceBridge(room, connection, Designer)
        bridge.awaiting.append('delegation-1')
        bridge.schedule_submit()
        # Transcript fragments arrive after the delegation and must be coalesced.
        bridge.unsubmitted = 'My budget is '
        bridge.schedule_submit()
        bridge.unsubmitted += '1000'
        bridge.schedule_submit()
        await bridge.submit_task
        assert submitted == ['My budget is 1000']
        assert room.state.budget == 1000
        # An additional fragment alone must not start a second design request.
        previous_task = bridge.submit_task
        bridge.unsubmitted = ' and a desk'
        bridge.schedule_submit()
        assert bridge.submit_task is previous_task
        await bridge.report('The room budget is now S$1,000.')
        commentary.assert_awaited_once_with(delegation_id='delegation-1', content='The room budget is now S$1,000.')
        assert bridge.pending == []
        room.task.cancel()
        await asyncio.gather(room.task, return_exceptions=True)

    asyncio.run(run())


def test_dropped_voice_connection_is_not_reported_as_model_access_error():
    from websockets.exceptions import ConnectionClosedError
    from backend.voice import voice_error_message

    message = voice_error_message(ConnectionClosedError(None, None), started=True)
    assert 'connection dropped' in message
    assert 'access' not in message
    assert 'room is saved' in message


def test_voice_chat_exposes_spoken_transcript_without_duplicate_designer_output():
    room = Session()
    queue = asyncio.Queue()
    room.subscribers.add(queue)
    room.delta('designer-result', 'The room is 4 by 3.5 metres.', internal=True)
    room.delta('voice-spoken', 'Your room is four by three point five metres.')
    assert [m['id'] for m in room.envelope()['messages']] == ['voice-spoken']
    assert queue.get_nowait()['internal'] is True  # The bridge still receives it.
    assert queue.get_nowait().get('internal') is None


def test_recoverable_voice_error_does_not_cut_off_following_speech():
    async def run():
        class Connection:
            async def __aiter__(self):
                for event in [
                    {'type': 'error', 'error': {'code': 'invalid_request_error'}},
                    {'type': 'session.output_transcript.delta', 'delta': 'The room is ready.'},
                    {'type': 'session.closed', 'reason': 'close_requested'},
                ]:
                    yield SimpleNamespace(model_dump=lambda event=event: event)

        room = Session()
        bridge = VoiceBridge(room, Connection(), None)
        await bridge.live_events()
        assert room.envelope()['messages'][-1]['text'] == 'The room is ready.'

    asyncio.run(run())


def test_corrected_voice_request_gets_one_spoken_result():
    async def run():
        commentary = AsyncMock()
        connection = SimpleNamespace(session=SimpleNamespace(commentary=SimpleNamespace(append=commentary)))
        bridge = VoiceBridge(Session(), connection, None)
        bridge.pending = ['original-request', 'corrected-request']
        await bridge.report('The corrected request is complete.')
        commentary.assert_awaited_once_with(delegation_id='corrected-request', content='The corrected request is complete.')

    asyncio.run(run())


def test_voice_transcript_precedes_reply_and_stays_put_when_delegated():
    async def run():
        submitted = []

        class Designer:
            def __init__(self, room):
                pass

            async def run(self):
                await asyncio.Future()

            def submit(self, request_id, text):
                submitted.append((request_id, text))

        class Connection:
            async def __aiter__(self):
                for event in [
                    {'type': 'session.input_transcript.delta', 'delta': 'My budget is '},
                    {'type': 'session.output_transcript.delta', 'delta': 'Let me update it.'},
                    {'type': 'session.input_transcript.delta', 'delta': '1000'},
                    {'type': 'session.delegation.created', 'delegation': {'id': 'task-1'}},
                ]:
                    yield SimpleNamespace(model_dump=lambda event=event: event)

        room = Session()
        bridge = VoiceBridge(room, Connection(), Designer)
        await bridge.live_events()
        # User speech is visible before the delayed room command is dispatched.
        before = room.envelope()['messages']
        assert [(m['role'], m['text']) for m in before] == [
            ('user', 'My budget is 1000'), ('assistant', 'Let me update it.')]
        await bridge.submit_task
        assert room.envelope()['messages'] == before
        assert submitted == [(before[0]['id'], 'My budget is 1000')]
        assert room.state.budget == 1000
        room.task.cancel()
        await asyncio.gather(room.task, return_exceptions=True)

    asyncio.run(run())


def test_voice_closure_distinguishes_provider_timeout_from_connection_loss():
    from backend.voice import voice_close_message

    assert 'time limit' in voice_close_message('expired')
    assert 'connection was lost' in voice_close_message('connection_lost')
    assert 'time limit' not in voice_close_message('connection_lost')
    assert 'session ended' in voice_close_message('unknown')
