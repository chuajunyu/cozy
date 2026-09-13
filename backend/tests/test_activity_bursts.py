import asyncio
from types import SimpleNamespace

from backend.sessions import Session
from backend.tests.test_studio import add, edit


def test_three_rotations_update_one_message_and_keep_three_undo_steps_and_steers():
    async def run():
        session = Session()
        await add(session)
        session.message('user', 'Keep designing')
        calls = []
        session.designer = SimpleNamespace(active=True, submit=lambda *args, **kwargs: calls.append((args, kwargs)))
        session.task = SimpleNamespace(done=lambda: False)
        history = len(session.history)
        revision = session.state.revision
        queue = asyncio.Queue()
        session.subscribers.add(queue)
        requests = []
        for rotation in [90, 180, 270]:
            command = await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=rotation)
            requests.append(command.requestId)
        row = session.messages[-1]
        assert row['text'] == 'You rotated'
        assert row['activity']['editCount'] == 3
        assert row['activity']['latestRequestId'] == requests[-1]
        assert row['activity']['steering']
        assert row['id'] == requests[0]
        assert len(session.history) == history + 3
        assert session.state.revision == revision + 3
        assert len(calls) == 3 and all(call[1]['background'] for call in calls)
        events = []
        while not queue.empty():
            events.append(queue.get_nowait())
        rows = [event['message'] for event in events if event['type'] == 'chat.message']
        assert len(rows) == 3 and len({m['id'] for m in rows}) == 1
        assert session.envelope()['messages'][-1] == row
        session.task = None
        session.designer = None
        for rotation in [180, 90, 0]:
            await edit(session, 'room.undo')
            assert session.state.slots['desk'].rotation == rotation
    asyncio.run(run())


def test_mixed_edits_deduplicate_actions_and_objects_and_ignore_noops():
    async def run():
        session = Session()
        await add(session)
        session.close_activity()
        await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', x=.2)
        await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=90)
        row = session.messages[-1]
        assert row['activity']['changes'][0]['label'] == 'Moved and rotated'
        await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=90)
        assert session.messages[-1] == row
        await add(session, 'chair', 'sample-chair', x=1.4, z=1)
        row = session.messages[-1]
        assert row['text'] == 'Updated 2 pieces'
        assert len(row['references']) == 2
        assert len(row['activity']['changes']) == 2
        assert not row['activity']['steering']
    asyncio.run(run())


def test_room_settings_merge():
    async def run():
        session = Session()
        for patch in [{'sunHour': 15}, {'sunHour': 16}, {'wallColors': {'north': '#ffffff'}}]:
            await edit(session, 'room.update', room={**session.state.room.model_dump(), **patch})
        assert len(session.messages) == 1
        assert session.messages[0]['text'] == 'You updated sunlight and wall colors'
        assert session.messages[0]['activity']['editCount'] == 3
    asyncio.run(run())


def test_burst_timeout_message_boundaries_and_streaming_tokens():
    session = Session()
    change = {'key': 'room', 'actions': ['sunlight'], 'reference': None, 'detail': None}
    session.record_activity(change, 'one', steering=False, now=0)
    session.record_activity(change, 'two', steering=False, now=4.9)
    assert len(session.messages) == 1
    session.record_activity(change, 'three', steering=False, now=9.9)
    assert len(session.messages) == 2
    session.message('user', 'Try blue')
    session.record_activity(change, 'four', steering=True, now=10)
    assert session.messages[-1]['id'] == 'four'
    session.delta('answer', 'Working')
    session.record_activity(change, 'five', steering=True, now=11)
    session.delta('answer', ' on it')
    session.record_activity(change, 'six', steering=True, now=12)
    assert session.messages[-1]['id'] == 'five'
    assert session.messages[-1]['activity']['editCount'] == 2
    session.message('assistant', 'Done', 'answer')
    session.record_activity(change, 'seven', steering=True, now=13)
    assert session.messages[-1]['id'] == 'five'


def test_summary_storage_is_bounded():
    session = Session()
    for index in range(51):
        change = {'key': f'item:{index}', 'actions': ['rotated'], 'reference': {'slotId': str(index), 'name': 'Desk', 'category': 'desk'}, 'detail': None}
        session.record_activity(change, str(index), steering=False, now=index / 100)
    assert len(session.messages) == 2
    assert len(session.messages[0]['activity']['changes']) == 50
    for index in range(1000):
        session.record_activity(change, f'repeat-{index}', steering=False, now=1 + index / 1000)
    assert len(session.messages[-1]['activity']['changes']) == 1
    assert len(session.messages[-1]['activity']['changes'][0]['actions']) == 1


def test_add_remove_sequence_and_undo_reset_boundaries():
    async def run():
        session = Session()
        await add(session)
        await edit(session, 'item.delete', slotId='desk', expectedProduct='sample-desk')
        assert session.messages[-1]['text'] == 'You added, then removed'
        await edit(session, 'room.undo')
        assert session.messages[-1]['text'] == 'You undid the last room change'
        await edit(session, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=90)
        assert session.messages[-1]['text'] == 'You rotated'
        await edit(session, 'room.clear')
        assert session.messages[-1]['text'] == 'You reset the room'
        await add(session)
        assert session.messages[-1]['text'] == 'You added'
    asyncio.run(run())


def test_final_toggle_and_reused_object_lifecycle_are_meaningful():
    from backend.design import DesignState, DoorAnchor, Slot
    from backend.studio_activity import activity_change, merge_activity
    before = DesignState(slots={'room': Slot(id='room', label='Door', category='door', zone='Room', group='Doors', catalogId='door', door=DoorAnchor(wall='north', offset=.5, open=False))})
    after = before.model_copy(deep=True)
    after.slots['room'].door.open = True
    opened = activity_change('item.update', 'room', before, after, {})
    closed = activity_change('item.update', 'room', after, before, {})
    assert opened['key'] == 'item:room'
    summary = merge_activity(merge_activity([], opened), closed)
    assert summary[0]['label'] == 'Set door closed'
    change = {'key': 'item:desk', 'actions': ['added'], 'reference': {'slotId': 'desk', 'name': 'Desk', 'category': 'desk'}, 'detail': None}
    summary = merge_activity([], change)
    summary = merge_activity(summary, {**change, 'actions': ['removed']})
    assert summary[0]['label'] == 'Added, then removed'
    summary = merge_activity(summary, change)
    assert summary[0]['label'] == 'Removed, then added'
