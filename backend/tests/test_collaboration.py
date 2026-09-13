import asyncio
import json

import pytest

from backend.concurrency import can_rebase
from backend.design import DesignError
from backend.design_tools import execute_tool
from backend.protocol import Command, handle_command
from backend.sessions import Session
from backend.studio import StudioCommand, handle_studio
from backend.tests.test_design import QuietDesigner
from backend.tests.test_studio import add, edit


def test_object_references_are_named_in_chat_and_ids_remain_in_model_feedback():
    async def run():
        s = Session()
        await add(s)
        await handle_command(s, Command(type='feedback.send', requestId='comment', action='comment',
            slotIds=['desk'], expectedProducts={'desk': 'sample-desk'}, text='Can you continue?'), QuietDesigner)
        message = s.messages[-1]
        assert message['text'] == 'Can you continue?'
        assert message['references'] == [{'slotId': 'desk', 'name': s.products['sample-desk']['name'], 'category': 'desk'}]
        assert 'Regarding desk:' in s.state.feedback[-1]['text']
        saved_name = message['references'][0]['name']
        await edit(s, 'item.delete', slotId='desk', expectedProduct='sample-desk')
        assert s.envelope()['messages'][-1]['references'][0]['name'] == saved_name
    asyncio.run(run())


def test_direct_edit_rebases_over_unrelated_changes_but_never_over_same_piece():
    async def run():
        s = Session()
        await add(s)
        revision = s.state.revision
        await add(s, 'chair', 'sample-chair', x=1.3, z=1)
        command = StudioCommand(type='item.update', requestId='move', baseRevision=revision,
            slotId='desk', expectedProduct='sample-desk', x=-.5, z=0)
        await handle_studio(s, command)
        assert s.state.slots['desk'].x == -.5 and s.state.slots['chair'].x == 1.3
        before = s.state.model_copy(deep=True)
        with pytest.raises(DesignError, match='room changed'):
            await handle_studio(s, command.model_copy(update={'requestId': 'other-move', 'x': .5}))
        assert s.state == before
        result = await execute_tool(s, 'old-agent-plan', 'apply_design_patch', json.dumps({
            'baseRevision': revision, 'placements': [], 'removeSlotIds': ['desk'], 'explanation': 'Old plan',
        }))
        assert result['code'] == 'stale_revision' and s.state == before
    asyncio.run(run())


def test_dependency_changes_and_room_changes_do_not_rebase():
    async def run():
        s = Session()
        await add(s)
        await add(s, 'lamp', 'sample-demo-lamp', elevation=.75, supportId='desk')
        before = s.state.model_copy(deep=True)
        s.state.slots['lamp'].locked = True
        assert not can_rebase(before, s.state, 'desk')
        s.state = before.model_copy(deep=True)
        s.state.room.width += 1
        assert not can_rebase(before, s.state, 'desk')
        assert not can_rebase(None, s.state, 'desk')
    asyncio.run(run())


def test_conversation_accepts_an_unrelated_revision_but_rejects_replaced_target():
    async def run():
        s = Session()
        await add(s)
        revision = s.state.revision
        await add(s, 'chair', 'sample-chair', x=1.3, z=1)
        await handle_command(s, Command(type='feedback.send', requestId='comment', baseRevision=revision,
            slotIds=['desk'], expectedProducts={'desk': 'sample-desk'}, text='Keep this.'), QuietDesigner)
        assert s.messages[-1]['text'] == 'Keep this.'
        with pytest.raises(DesignError, match='recommendation has changed'):
            await handle_command(s, Command(type='feedback.send', requestId='wrong-product', baseRevision=revision,
                slotIds=['desk'], expectedProducts={'desk': 'old-desk'}, text='Keep this.'), QuietDesigner)
    asyncio.run(run())
