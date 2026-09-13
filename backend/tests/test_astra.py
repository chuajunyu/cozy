import asyncio
from types import SimpleNamespace

from backend.astra import AstraDesigner
from backend.sessions import Session


class FakeTransport:
    def __init__(self):
        self.creates = []
        self.steers = []
        self.response = SimpleNamespace(create=self.create, steer=self.steer)

    async def create(self, **kwargs):
        self.creates.append(kwargs)

    async def steer(self, **kwargs):
        self.steers.append(kwargs)


def test_steering_queues_then_applies_on_successor():
    async def run():
        session = Session()
        queue = asyncio.Queue()
        session.subscribers.add(queue)
        designer = AstraDesigner(session)
        designer.connection = FakeTransport()
        await designer.handle_event({"type": "response.created", "response": {"id": "first"}})
        await designer.steer({"requestId": "feedback-1", "text": "Keep the bed"})
        await designer.handle_event({"type": "response.steer.accepted", "steer": {"id": "steer-1"}})
        await designer.handle_event({"type": "response.incomplete", "response": {"id": "first", "incomplete_details": {"reason": "steered"}, "output": []}})
        assert designer.active and not designer.connection.creates
        await designer.handle_event({"type": "response.created", "response": {"id": "second", "previous_response_id": "first"}})
        stages = []
        while not queue.empty():
            event = queue.get_nowait()
            if event["type"] == "feedback.ack":
                stages.append(event["stage"])
        assert stages == ["sent", "queued", "applied"]
        assert not designer.accepted
    asyncio.run(run())


def test_pending_tool_result_continued_once_and_no_partial_json_execution():
    async def run():
        session = Session()
        designer = AstraDesigner(session)
        designer.connection = FakeTransport()
        await designer.handle_event({"type": "response.created", "response": {"id": "first"}})
        await designer.handle_event({"type": "response.function_call_arguments.delta", "delta": '{"baseRevision":'})
        assert not session.tool_results
        item = {"type": "function_call", "call_id": "call-1", "name": "get_design_state", "arguments": "{}"}
        await designer.handle_event({"type": "response.output_item.done", "item": item})
        await designer.handle_event({"type": "response.completed", "response": {"id": "first", "output": [item]}})
        await designer.handle_event({"type": "response.steer.pending", "steer": {"previous_response_id": "first"}, "required_input": [{"call_id": "call-1"}]})
        assert len(designer.connection.creates) == 1
        assert len(designer.connection.creates[0]["input"]) == 1
        assert len(session.tool_results) == 1
    asyncio.run(run())


def test_multiple_inputs_during_startup_are_steered_after_created():
    async def run():
        designer = AstraDesigner(Session())
        designer.connection = FakeTransport()
        designer.waiting = [{"requestId": "a", "text": "Warm colors"}, {"requestId": "b", "text": "Avoid glass"}]
        await designer.handle_event({"type": "response.created", "response": {"id": "first"}})
        assert len(designer.connection.steers) == 2
        assert not designer.waiting
    asyncio.run(run())


def test_websocket_tls_has_verified_roots_without_native_ca_bundle(monkeypatch):
    import ssl
    from backend.astra import astra_tls_context
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    assert context.cert_store_stats()['x509_ca'] == 0
    monkeypatch.setattr(ssl, 'create_default_context', lambda: context)
    configured = astra_tls_context()
    assert configured.check_hostname
    assert configured.verify_mode == ssl.CERT_REQUIRED
    assert configured.cert_store_stats()['x509_ca'] > 0


def test_steering_failure_is_scoped_to_its_request_and_other_updates_continue():
    async def run():
        session = Session()
        queue = asyncio.Queue()
        session.subscribers.add(queue)
        designer = AstraDesigner(session)
        designer.connection = FakeTransport()
        await designer.handle_event({'type': 'response.created', 'response': {'id': 'first'}})
        for request in ['a', 'b']:
            await designer.steer({'requestId': request, 'text': request})
            await designer.handle_event({'type': 'response.steer.accepted', 'steer': {'id': request}})
        await designer.handle_event({'type': 'response.steer.failed', 'steer': {'id': 'a'}})
        assert 'b' in designer.accepted
        await designer.handle_event({'type': 'response.created', 'response': {'id': 'next', 'previous_response_id': 'first'}})
        events = []
        while not queue.empty():
            events.append(queue.get_nowait())
        assert any(e.get('code') == 'steering_failed' and e['requestId'] == 'a' for e in events)
        assert any(e['type'] == 'feedback.ack' and e['requestId'] == 'b' and e['stage'] == 'applied' for e in events)
    asyncio.run(run())


def test_canceled_generation_ignores_late_receipts_and_text():
    async def run():
        session = Session()
        designer = AstraDesigner(session)
        designer.connection = FakeTransport()
        session.generation += 1
        await designer.handle_event({'type': 'response.created', 'response': {'id': 'late'}})
        await designer.handle_event({'type': 'response.output_text.delta', 'item_id': 'late', 'delta': 'obsolete'})
        assert not session.messages and designer.active_id is None
    asyncio.run(run())


def test_unconfigured_designer_fails_pending_delivery_without_api_call(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    async def run():
        session = Session()
        queue = asyncio.Queue()
        session.subscribers.add(queue)
        designer = AstraDesigner(session)
        designer.submit('a', 'Design my room')
        designer.submit('b', 'Also add a desk')
        await designer.run()
        events = []
        while not queue.empty():
            events.append(queue.get_nowait())
        assert [(e['requestId'], e['stage']) for e in events if e['type'] == 'feedback.ack'] == [('a', 'failed'), ('b', 'failed')]
        assert designer.inbox.empty()
    asyncio.run(run())
