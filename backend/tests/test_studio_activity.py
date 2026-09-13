import asyncio

import pytest

from backend.astra import AstraDesigner
from backend.design import DesignError
from backend.sessions import Session
from backend.studio import handle_studio
from backend.tests.test_astra import FakeTransport
from backend.tests.test_studio import add, edit


def test_activity_is_named_replayable_and_only_records_accepted_edits():
    async def run():
        session = Session()
        await add(session)
        command = await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', x=.2)
        message = session.messages[-1]
        assert message['role'] == 'system' and message['kind'] == 'activity'
        assert message['text'] == 'You moved'
        assert message['references'][0]['name'] == session.products['sample-desk']['name']
        assert 'silently' in session.state.feedback[-1]['text']
        count = len(session.messages)
        await handle_studio(session, command)
        assert len(session.messages) == count
        with pytest.raises(DesignError):
            await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', x=100)
        assert len(session.messages) == count
        await edit(session, 'item.delete', slotId='desk', expectedProduct='sample-desk')
        assert session.messages[-1]['references'] == message['references']
        assert session.envelope()['messages'][-1]['text'] == 'You removed'
    asyncio.run(run())


def test_room_activity_and_restore_stay_out_of_assistant_chat():
    async def run():
        session = Session()
        await edit(session, 'room.update', room={**session.state.room.model_dump(), 'sunHour': 15})
        assert session.messages[-1]['text'] == 'You updated sunlight'
        await edit(session, 'room.undo')
        assert session.messages[-1]['text'] == 'You undid the last room change'
        assert all(m['role'] == 'system' for m in session.messages)
    asyncio.run(run())


def test_background_edit_does_not_start_a_new_response_after_completion():
    async def run():
        designer = AstraDesigner(Session())
        designer.connection = FakeTransport()
        designer.submit('move', 'Manual change: item.update', background=True)
        designer.submit('chat', 'Make it cozier')
        task = asyncio.create_task(designer.read_inputs())
        for _ in range(20):
            await asyncio.sleep(0)
            if designer.connection.creates:
                break
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert len(designer.connection.creates) == 1
        assert designer.connection.creates[0]['input'][-1]['content'] == 'Make it cozier'
    asyncio.run(run())


def test_active_designer_receives_manual_context_without_a_chat_bubble():
    async def run():
        session = Session()
        await add(session)
        designer = AstraDesigner(session)
        designer.connection = FakeTransport()
        designer.active = True
        designer.active_id = 'working-response'
        session.designer = designer
        session.task = asyncio.create_task(designer.read_inputs())
        await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', x=.3)
        for _ in range(20):
            await asyncio.sleep(0)
            if designer.connection.steers:
                break
        session.task.cancel()
        await asyncio.gather(session.task, return_exceptions=True)
        steer = designer.connection.steers[0]['input']
        assert 'silently' in steer and 'Latest authoritative state' in steer
        assert not designer.connection.creates
        assert session.messages[-1]['text'] == 'You moved'
        assert all(m['role'] == 'system' for m in session.messages)
    asyncio.run(run())
