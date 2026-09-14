import asyncio
import json
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace

import pytest

from backend.astra import AstraDesigner, WorkLimitReached
from backend.astra_usage import session_label, token_usage
from backend.model_context import model_json, model_state
from backend.protocol import Command, handle_command
from backend.sessions import Session
from backend.tests.test_astra import FakeTransport
from backend.tests.test_studio import add, edit


@pytest.fixture(autouse=True)
def usage_records(monkeypatch):
    records = []
    monkeypatch.setattr('backend.astra.record_usage', records.append)
    return records


async def until(predicate):
    async with asyncio.timeout(2):
        while not predicate():
            await asyncio.sleep(.001)


@asynccontextmanager
async def workers(designer):
    tasks = [asyncio.create_task(designer.read_inputs()), asyncio.create_task(designer.read_background())]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        async with asyncio.timeout(2):
            results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                raise result


def designer_for(session):
    designer = AstraDesigner(session)
    designer.connection = FakeTransport()
    designer.debounce_seconds = .02
    designer.debounce_max_seconds = .06
    session.designer = designer
    session.task = SimpleNamespace(done=lambda: False)
    return designer


def receipts(queue):
    events = []
    while not queue.empty():
        event = queue.get_nowait()
        if event['type'] == 'feedback.ack':
            events.append((event['requestId'], event['stage']))
    return events


def test_active_rotations_save_individually_but_send_one_latest_state_and_all_receipts():
    async def run():
        session = Session()
        await add(session)
        designer = designer_for(session)
        await designer.handle_event({'type': 'response.created', 'response': {'id': 'first'}})
        queue = asyncio.Queue()
        session.subscribers.add(queue)
        previous_undo = len(session.history)
        async with workers(designer):
            ids = []
            for rotation in [90, 180, 270]:
                command = await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=rotation)
                ids.append(command.requestId)
            assert len(session.history) == previous_undo + 3
            assert designer.connection.steers == []
            await until(lambda: designer.connection.steers)
            assert len(designer.connection.steers) == 1
            state = json.loads(designer.connection.steers[0]['input'].split('Latest authoritative state:\n')[1])
            assert state['slots']['desk']['rotation'] == 270
            assert len(state['feedback']) == 1
            await designer.handle_event({'type': 'response.steer.accepted', 'steer': {'id': 'batch'}})
            await designer.handle_event({'type': 'response.created', 'response': {'id': 'second', 'previous_response_id': 'first'}})
            events = receipts(queue)
            for request_id in ids:
                assert [stage for id, stage in events if id == request_id] == ['sent', 'queued', 'applied']
    asyncio.run(run())


def test_idle_edits_and_completion_before_debounce_never_create_a_response():
    async def run():
        session = Session()
        await add(session)
        designer = designer_for(session)
        queue = asyncio.Queue()
        session.subscribers.add(queue)
        async with workers(designer):
            await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=90)
            assert not designer.background
            await designer.handle_event({'type': 'response.created', 'response': {'id': 'first'}})
            command = await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=180)
            await designer.handle_event({'type': 'response.completed', 'response': {'id': 'first', 'output': []}})
            assert not designer.background
            assert (command.requestId, 'saved') in receipts(queue)
            designer.submit('late', 'Manual change', background=True)
            assert ('late', 'saved') in receipts(queue)
            await asyncio.sleep(.04)
            assert not designer.connection.creates and not designer.connection.steers
    asyncio.run(run())


def test_background_waits_for_response_id_and_max_wait_survives_continuous_edits(monkeypatch):
    async def run():
        designer = designer_for(Session())
        designer.active = True
        clock = [100.0]
        monkeypatch.setattr('backend.astra.time', SimpleNamespace(monotonic=lambda: clock[0]))
        designer.debounce_seconds = 1
        designer.debounce_max_seconds = 3
        async with workers(designer):
            designer.submit('a', 'Move desk', background=True)
            clock[0] = 103.1
            designer.submit('b', 'Rotate desk', background=True)
            await asyncio.sleep(.01)
            assert not designer.connection.steers  # no active response ID yet
            await designer.handle_event({'type': 'response.created', 'response': {'id': 'first'}})
            await until(lambda: designer.connection.steers)
            assert len(designer.connection.steers) == 1
            assert designer.connection.steers[0]['previous_response_id'] == 'first'
            assert 'Move desk' in designer.connection.steers[0]['input']
            assert 'Rotate desk' in designer.connection.steers[0]['input']
    asyncio.run(run())


def test_written_steering_bypasses_debounce_and_includes_pending_edits():
    async def run():
        designer = designer_for(Session())
        designer.debounce_seconds = designer.debounce_max_seconds = 60
        await designer.handle_event({'type': 'response.created', 'response': {'id': 'first'}})
        queue = asyncio.Queue()
        designer.session.subscribers.add(queue)
        async with workers(designer):
            designer.submit('move', 'Move desk', background=True)
            # Let the debounce worker enter its timer before chat drains it.
            await asyncio.sleep(.01)
            designer.submit('chat', 'Use warm colors')
            await until(lambda: designer.connection.steers)
            assert len(designer.connection.steers) == 1
            assert not designer.background
            assert 'Use warm colors' in designer.connection.steers[0]['input']
            assert 'Move desk' in designer.connection.steers[0]['input']
            assert set(receipts(queue)) == {('move', 'sent'), ('chat', 'sent')}
    asyncio.run(run())


def test_failed_batch_and_generation_change_finish_every_pending_receipt():
    async def run():
        designer = designer_for(Session())
        await designer.handle_event({'type': 'response.created', 'response': {'id': 'first'}})
        queue = asyncio.Queue()
        designer.session.subscribers.add(queue)
        designer.submit('a', 'Move desk', background=True)
        designer.submit('b', 'Move chair', background=True)
        await designer.steer({'requestId': 'chat', 'text': 'Continue'})
        receipts(queue)
        await designer.handle_event({'type': 'response.steer.accepted', 'steer': {'id': 'batch'}})
        await designer.handle_event({'type': 'response.steer.failed', 'steer': {'id': 'batch'}})
        assert {id for id, stage in receipts(queue) if stage == 'failed'} == {'a', 'b', 'chat'}
        designer.submit('pending', 'Move again', background=True)
        designer.session.generation += 1
        async with workers(designer):
            await until(lambda: not designer.background)
        assert ('pending', 'saved') in receipts(queue)
        assert len(designer.connection.steers) == 1
    asyncio.run(run())


def test_lock_finishing_before_submission_does_not_restart_astra():
    async def run():
        session = Session()
        await add(session)
        designer = designer_for(session)
        await designer.handle_event({'type': 'response.created', 'response': {'id': 'first'}})
        await handle_command(session, Command(type='item.lock', requestId='lock', slotIds=['desk'], locked=True))
        assert designer.background['lock']['background']
        await designer.handle_event({'type': 'response.completed', 'response': {'id': 'first', 'output': []}})
        async with workers(designer):
            await asyncio.sleep(.04)
        assert session.state.slots['desk'].locked
        assert not designer.connection.creates and not designer.connection.steers
    asyncio.run(run())


def test_new_prompt_has_stable_history_first_and_deduplicates_message_and_feedback():
    async def run():
        session = Session()
        session.message('user', 'Keep a desk', 'old')
        session.message('user', 'Make this warmer', 'new', [{'slotId': 'desk', 'name': 'Desk', 'category': 'desk'}])
        session.state.feedback = [{'type': 'chat.send', 'requestId': 'old', 'text': 'Keep a desk'},
                                  {'type': 'chat.send', 'requestId': 'new', 'text': 'Make this warmer'}]
        designer = designer_for(session)
        async with workers(designer):
            designer.submit('new', 'Make this warmer')
            await until(lambda: designer.connection.creates)
            messages = designer.connection.creates[0]['input']
            assert messages[0]['content'] == 'Keep a desk'
            assert sum(m['content'].count('Make this warmer') for m in messages) == 1
            assert 'Referenced objects:' in messages[-1]['content']
            assert json.loads(messages[-2]['content'].split('\n', 1)[1])['feedback'] == []
    asyncio.run(run())


def test_legacy_manual_history_compacts_without_losing_preferences_or_mutating_save():
    state = Session().snapshot()
    state['feedback'] = [{'text': 'Manual change: item.update; item desk. Background activity, not a chat request.', 'slotIds': ['desk']} for _ in range(100)]
    state['feedback'].append({'type': 'chat.send', 'text': 'Manual change: please keep my walnut desk', 'requestId': 'user'})
    state['rejected'] = {'desk': [{'catalogId': 'old-desk', 'reason': 'Too large'}]}
    original = deepcopy(state)
    compact = model_state(state)
    assert len(compact['feedback']) == 2
    assert compact['feedback'][0]['text'] == 'Manual change: please keep my walnut desk'
    assert compact['rejected'] == state['rejected']
    assert compact['room'] == state['room']
    assert state == original
    assert len(model_json({'state': state})) < len(json.dumps({'state': state})) / 3


def test_usage_includes_steered_failed_and_missing_responses_without_double_counting(usage_records):
    async def run():
        designer = designer_for(Session())
        usage = {'input_tokens': 1000, 'input_tokens_details': {'cached_tokens': 500, 'cache_write_tokens': 200},
                 'output_tokens': 80, 'output_tokens_details': {'reasoning_tokens': 50}, 'total_tokens': 1080}
        event = {'type': 'response.incomplete', 'response': {'id': 'steered', 'output': [], 'usage': usage,
                                                          'incomplete_details': {'reason': 'steered'}}}
        await designer.handle_event(event)
        await designer.handle_event(event)
        assert designer.run_output_tokens == 80
        assert len(usage_records) == 1
        assert usage_records[0]['cached_tokens'] == 500
        assert usage_records[0]['cache_write_tokens'] == 200
        assert usage_records[0]['reasoning_tokens'] == 50
        assert designer.session.id not in json.dumps(usage_records)
        with pytest.raises(RuntimeError):
            await designer.handle_event({'type': 'response.failed', 'response': {'id': 'failed'}})
        assert usage_records[-1]['output_tokens'] is None
        assert designer.run_output_tokens == 80
    asyncio.run(run())


def test_usage_parser_does_not_invent_unknown_counts():
    assert all(value is None for value in token_usage({}).values())
    assert token_usage({'usage': {'output_tokens': True, 'input_tokens': -1}})['output_tokens'] is None
    assert session_label('secret') != 'secret'


@pytest.mark.parametrize('code', ['insufficient_quota', 'billing_hard_limit_reached', 'rate_limit_exceeded'])
def test_sdk_top_level_error_preserves_usage_limit_code(code):
    from openai.types.responses import ResponseErrorEvent
    from backend.astra import UpstreamError

    async def run():
        designer = AstraDesigner(Session())
        event = ResponseErrorEvent(type='error', sequence_number=1, code=code,
                                   message='private upstream details')
        with pytest.raises(UpstreamError) as error:
            await designer.handle_event(event.model_dump())
        assert error.value.code == code
        assert 'private upstream details' not in str(error.value)
    asyncio.run(run())


def test_output_budget_limits_continuation_and_reports_recoverable_limit(monkeypatch):
    monkeypatch.setenv('COZY_ASTRA_MAX_RUN_OUTPUT_TOKENS', '1000')
    monkeypatch.setenv('COZY_ASTRA_REASONING_EFFORT', 'low')

    async def run():
        designer = designer_for(Session())
        designer.run_output_tokens = 700
        await designer.create([], 'first')
        assert designer.connection.creates[0]['max_output_tokens'] == 300
        assert designer.connection.creates[0]['reasoning']['effort'] == 'low'
        with pytest.raises(WorkLimitReached):
            await designer.handle_event({'type': 'response.incomplete', 'response': {
                'id': 'second', 'output': [], 'usage': {'output_tokens': 300},
                'incomplete_details': {'reason': 'steered'}}})
        assert len(designer.connection.creates) == 1
    asyncio.run(run())


def test_manual_history_preserves_chat_across_many_moves():
    async def run():
        session = Session()
        await add(session)
        session.state.feedback.append({'type': 'chat.send', 'requestId': 'brief', 'text': 'Keep walnut furniture'})
        for index in range(110):
            await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=(index % 4) * 90)
        assert len(session.state.feedback) == 2
        assert session.state.feedback[0]['text'] == 'Keep walnut furniture'
        assert session.snapshot()['slots']['desk']['rotation'] == 90
    asyncio.run(run())


def test_usage_log_persists_json_and_rotates_without_prompt_content(tmp_path, monkeypatch):
    import logging
    from backend.astra_usage import record_usage

    logger = logging.getLogger('cozy.astra.usage')
    old_handlers = logger.handlers[:]
    logger.handlers = []
    path = tmp_path / 'usage.jsonl'
    monkeypatch.setenv('COZY_ASTRA_USAGE_LOG', str(path))
    try:
        record_usage({'response': 'one', 'output_tokens': 10, 'cached_tokens': None})
        entry = json.loads(path.read_text())
        assert entry['output_tokens'] == 10 and entry['cached_tokens'] is None
        assert entry['timestamp']
        logger.handlers[0].maxBytes = 100
        record_usage({'response': 'two', 'output_tokens': 20})
        assert json.loads(path.read_text())['response'] == 'two'
        assert json.loads((tmp_path / 'usage.jsonl.1').read_text())['response'] == 'one'
    finally:
        for handler in logger.handlers:
            handler.close()
        logger.handlers = old_handlers


def test_invalid_cost_settings_fall_back_without_preventing_manual_use(monkeypatch):
    monkeypatch.setenv('COZY_ASTRA_MAX_RESPONSES', 'invalid')
    monkeypatch.setenv('COZY_ASTRA_MAX_OUTPUT_TOKENS', '-2')
    monkeypatch.setenv('COZY_ASTRA_REASONING_EFFORT', 'none')
    designer = AstraDesigner(Session())
    assert designer.max_turns == 40
    assert designer.max_output_tokens == 7000
    assert designer.reasoning_effort == 'medium'


def test_run_cleans_up_debounce_on_cancel_and_explains_work_limit():
    class Transport(FakeTransport):
        def __init__(self):
            super().__init__()
            self.events = asyncio.Queue()
            self.closed = False

        def __aiter__(self):
            return self

        async def __anext__(self):
            return await self.events.get()

        async def create(self, **kwargs):
            await super().create(**kwargs)
            self.events.put_nowait({'type': 'response.created', 'response': {'id': 'first'}})

    async def run(limited):
        transport = Transport()

        @asynccontextmanager
        async def connect(**kwargs):
            try:
                yield transport
            finally:
                transport.closed = True

        session = Session()
        queue = asyncio.Queue()
        session.subscribers.add(queue)
        designer = AstraDesigner(session, client=SimpleNamespace(responses=SimpleNamespace(connect=connect)))
        designer.max_run_output_tokens = 1000
        designer.submit('brief', 'Make a room')
        task = asyncio.create_task(designer.run())
        try:
            await until(lambda: designer.active_id)
            designer.submit('move', 'Move desk', background=True)
            await asyncio.sleep(.01)
            if isinstance(limited, str):
                if limited in {'project_spend_limit_exceeded', 'provider_specific_quota_code'}:
                    # Actual Responses WebSocket quota error has a specific code
                    # AND an insufficient_quota type, without an HTTP status.
                    transport.events.put_nowait({'type': 'error', 'error': {
                        'code': limited, 'type': 'insufficient_quota', 'message': 'private upstream details'}})
                else:
                    transport.events.put_nowait({'type': 'error', 'error': {'code': limited, 'status_code': 429,
                                                                         'message': 'private upstream details'}})
            elif limited:
                transport.events.put_nowait({'type': 'response.incomplete', 'response': {
                    'id': 'first', 'output': [], 'usage': {'output_tokens': 1000},
                    'incomplete_details': {'reason': 'steered'}}})
            else:
                task.cancel()
            async with asyncio.timeout(2):
                await asyncio.gather(task, return_exceptions=True)
            assert transport.closed and not designer.active and not designer.background
            assert len(transport.creates) == 1 and not transport.steers
            events = []
            while not queue.empty():
                events.append(queue.get_nowait())
            assert any(e.get('requestId') == 'move' and e.get('stage') == 'saved' for e in events)
            if isinstance(limited, str):
                expected = ('astra_credits_exhausted' if limited in {'insufficient_quota', 'project_spend_limit_exceeded', 'provider_specific_quota_code'} else
                            'astra_rate_limited' if limited == 'rate_limit_exceeded' else 'astra_usage_limited')
                assert any(e.get('code') == expected for e in events)
                if expected == 'astra_credits_exhausted':
                    assert any('spending limit' in e.get('message', '') for e in events)
                assert 'private upstream details' not in json.dumps(events)
                assert not any('connection was interrupted' in e.get('message', '') for e in events)
            elif limited:
                assert any(e.get('code') == 'astra_work_limit' and 'saved' in e['message'] for e in events)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run(False))
    asyncio.run(run(True))
    asyncio.run(run('insufficient_quota'))
    asyncio.run(run('rate_limit_exceeded'))
    asyncio.run(run('unknown_429'))
    asyncio.run(run('project_spend_limit_exceeded'))
    asyncio.run(run('provider_specific_quota_code'))


@pytest.mark.parametrize('code', ['astra_credits_exhausted', 'astra_rate_limited', 'astra_usage_limited'])
def test_three_ideas_preserve_safe_usage_limit_messages(code):
    from backend.provider_errors import LIMIT_MESSAGES
    from backend.variants import candidate_run, generate_set

    class RejectedDesigner:
        def __init__(self, session):
            self.session = session

        def submit(self, *args):
            pass

        async def run(self):
            self.session.publish({'type': 'error', 'code': code, 'message': 'raw upstream data must not be exposed'})

    async def run():
        session = Session()
        candidates = [{'id': str(i), 'status': 'queued', 'direction': {}} for i in range(3)]
        data = {'source': session.state.model_dump(), 'request': 'Cozy room', 'candidates': candidates}
        session.variants = data
        await generate_set(session, data, RejectedDesigner)
        assert all(c['status'] == 'failed' and c['error'] == LIMIT_MESSAGES[code] for c in candidates)
        await candidate_run(session, data, candidates[0], RejectedDesigner)
        assert candidates[0]['error'] == LIMIT_MESSAGES[code]
    asyncio.run(run())
