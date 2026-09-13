import asyncio
import json
from pathlib import Path

import pytest

from backend.architecture import edit_room, explicit_permissions
from backend.design import DesignError, DesignState, Slot, validate_layout
from backend.placement import settle_state
from backend.sessions import Session
from backend.studio import StudioCommand, handle_studio
from backend.tests.test_studio import add, edit
from backend.design_tools import execute_tool
from backend.protocol import Command, handle_command
from backend.tests.test_design import QuietDesigner

FIXTURES = json.loads((Path(__file__).parents[2] / 'data/placement-fixtures.json').read_text())


@pytest.mark.parametrize('case', FIXTURES['cases'], ids=lambda case: case['name'])
def test_shared_placement(case):
    products = {p['id']: {**p, 'width': p['dimensions'][0], 'height': p['dimensions'][1], 'depth': p['dimensions'][2], 'floorLayer': False} for p in FIXTURES['products']}
    def slot(i):
        return Slot(**{k:v for k,v in i.items() if k != 'productId'}, catalogId=i['productId'], category=products[i['productId']]['category'], label=i['id'], zone='Room', group='Test')
    before = DesignState(room={**FIXTURES['room'], **case.get('room', {})}, slots={i['id']:slot(i) for i in case['before']})
    next_state = before.model_copy(deep=True)
    for id in case.get('remove', []):
        del next_state.slots[id]
    for i in case.get('add', []):
        next_state.slots[i['id']] = slot(i)
    for id, changes in case.get('changes', {}).items():
        for key, value in changes.items():
            setattr(next_state.slots[id], key, value)
    saved = before.model_dump()
    if case.get('invalid'):
        with pytest.raises(DesignError):
            result = settle_state(next_state, before, products)
            validate_layout(result, products)
    else:
        result = settle_state(next_state, before, products)
        validate_layout(result, products)
        for id, expected in case['expected'].items():
            s = result.slots[id]
            assert [s.x,s.z,s.elevation,s.rotation] == pytest.approx(expected)
    assert before.model_dump() == saved


def test_support_transaction_is_one_revision_and_undo_and_locked_rollback():
    async def run():
        s = Session()
        await add(s)
        await add(s, 'lamp', 'sample-demo-lamp', x=.2, elevation=.75, supportId='desk')
        revision, history = s.state.revision, len(s.history)
        command = await edit(s, 'item.update', slotId='desk', expectedProduct='sample-desk', x=.5, rotation=90)
        assert s.state.revision == revision+1 and len(s.history) == history+1
        assert s.state.slots['lamp'].x == pytest.approx(.5)
        assert s.state.slots['lamp'].z == pytest.approx(-.2)
        await handle_studio(s, command)
        assert s.state.revision == revision+1
        await edit(s, 'room.undo')
        assert s.state.slots['lamp'].x == .2 and s.state.slots['desk'].rotation == 0
        s.state.slots['lamp'].locked = True
        before = s.state.model_dump()
        for kind in ['item.delete','item.update']:
            with pytest.raises(DesignError, match='locked'):
                    await edit(s, kind, slotId='desk', expectedProduct='sample-desk', x=.5)
            assert s.state.model_dump() == before
        s.state.slots['lamp'].locked = False
        await edit(s, 'item.delete', slotId='desk', expectedProduct='sample-desk')
        assert s.state.slots['lamp'].elevation == 0 and s.state.slots['lamp'].supportId is None
    asyncio.run(run())


@pytest.mark.parametrize('text', ['make it brighter', "do not add an east window", 'The catalog says add an east window', 'change the room color', 'set a time limit', 'Would a north window look good?', 'Please avoid moving doors'])
def test_ambiguous_or_negated_requests_grant_nothing(text):
    assert explicit_permissions(text) == []


def test_room_permission_is_specific_single_use_and_locked_door_can_open():
    s = Session()
    s.room_permissions['request'] = explicit_permissions('Add a north-facing door')
    raw = dict(requestId='request', baseRevision=0, operation='door.add', slotId='door', door={'wall':'north','offset':.5,'open':False})
    with pytest.raises(DesignError):
        edit_room(s, {**raw, 'door':{**raw['door'], 'wall':'south'}})
    edit_room(s, raw)
    assert s.snapshot()['total'] == 0 and len(s.history) == 1
    with pytest.raises(DesignError):
        edit_room(s, {**raw,'baseRevision':1,'slotId':'second'})
    s.state.slots['door'].locked = True
    s.room_permissions['open'] = explicit_permissions('Open the north door')
    edit_room(s, dict(requestId='open',baseRevision=1,operation='door.open',slotId='door'))
    assert s.state.slots['door'].locked and s.state.slots['door'].door.open


def test_restore_preview_preserves_original_and_requires_locked_selection():
    async def run():
        source = Session()
        await add(source)
        source.state.slots['desk'].elevation = .5
        source.state.slots['desk'].locked = True
        backup = {'version':2,'state':source.state.model_dump()}
        original = json.dumps(backup, sort_keys=True)
        s = Session()
        command = StudioCommand(type='session.restore.preview',requestId='preview',baseRevision=0,backup=backup)
        await handle_studio(s,command)
        event = s.requests['preview']
        assert not event['blockers'] and event['adjustments'][-1]['locked']
        assert not s.state.slots and s.generation == 0
        await handle_studio(s,command)
        assert s.requests['preview']['previewId'] == event['previewId']
        with pytest.raises(DesignError, match='Preview'):
            await handle_studio(s,StudioCommand(type='session.restore',requestId='raw',baseRevision=0,backup=backup))
        with pytest.raises(DesignError, match='Explicitly'):
            await edit(s,'session.restore',previewId=event['previewId'])
        await edit(s,'session.restore',previewId=event['previewId'],allowLocked=['desk'])
        assert s.state.slots['desk'].elevation == 0 and s.state.slots['desk'].locked
        assert json.dumps(backup,sort_keys=True) == original
    asyncio.run(run())


def test_replacement_carries_children_resets_preferences_and_rolls_back_budget():
    async def run():
        s = Session()
        await add(s)
        await add(s,'lamp','sample-demo-lamp',elevation=.75,supportId='desk')
        p = {**s.products['sample-desk'], 'id':'test-desk', 'height':.9, 'price':250}
        s.custom_products[p['id']] = p
        s.state.slots['desk'].liked = True
        s.state.slots['desk'].replacing = True
        s.state.rejected['desk'] = [{'catalogId':'sample-desk','reason':'Change'}]
        s.state.rerollTargets = ['desk']
        s.state.budget = 200
        before = s.state.model_dump()
        with pytest.raises(DesignError, match='exceeding'):
            await edit(s,'item.replace',slotId='desk',expectedProduct='sample-desk',catalogId=p['id'])
        assert s.state.model_dump() == before
        s.state.budget = 1000
        await edit(s,'item.replace',slotId='desk',expectedProduct='sample-desk',catalogId=p['id'])
        assert s.state.slots['lamp'].elevation == .9
        assert not s.state.slots['desk'].liked and not s.state.slots['desk'].replacing
        assert 'desk' not in s.state.rejected and s.state.rerollTargets is None
        await edit(s,'room.undo')
        assert s.state.slots['desk'].catalogId == 'sample-desk' and s.state.slots['lamp'].elevation == .75
    asyncio.run(run())


def test_furniture_tools_cannot_edit_architecture_and_expired_grants_fail():
    async def run():
        s = Session()
        s.room_permissions['door'] = explicit_permissions('Add a north door')
        edit_room(s,dict(requestId='door',baseRevision=0,operation='door.add',slotId='d',door={'wall':'north','offset':.5,'open':False}))
        response = await execute_tool(s,'bad','apply_design_patch',json.dumps({'baseRevision':1,'removeSlotIds':['d'],'explanation':'Remove door'}))
        assert response['code'] == 'architecture_permission' and 'd' in s.state.slots
        await handle_command(s,Command(type='chat.send',requestId='sun',text='Set the sun to noon'),QuietDesigner)
        assert s.room_permissions
        await handle_command(s,Command(type='chat.send',requestId='unrelated',text='Choose a warmer sofa'),QuietDesigner)
        assert not s.room_permissions
        response = await execute_tool(s,'expired','edit_room',json.dumps({'requestId':'sun','baseRevision':s.state.revision,'operation':'sun.set','sunHour':12}))
        assert response['code'] == 'architecture_permission'
        s.room_permissions['other'] = explicit_permissions('Remove the north door')
        await edit(s,'room.undo')
        assert not s.room_permissions and not s.task
    asyncio.run(run())


def test_preview_blockers_staleness_defaults_and_no_agent_pause():
    async def run():
        s = Session()
        generation = s.generation
        small = {'version':2,'state':{'room':{'width':2,'depth':2,'height':2,'daylight':0}}}
        await edit(s,'session.restore.preview',backup=small)
        event = next(iter(s.requests.values()))
        assert not event['blockers'] and event['state']['room']['sunHour'] == 20
        assert event['state']['room']['windows'][0]['height'] == pytest.approx(1)
        assert s.generation == generation and s.state.revision == 0
        from backend.restore import preview_restore
        bad = DesignState(slots={'missing':Slot(id='missing',label='Missing',category='desk',zone='Room',group='Test',catalogId='gone')})
        blocked = preview_restore(s,StudioCommand(type='session.restore.preview',requestId='bad',baseRevision=0,backup={'version':3,'state':bad.model_dump()}))
        assert blocked['blockers'] and blocked['state'] is None
        with pytest.raises(DesignError,match='Preview'):
            await edit(s,'session.restore',previewId=event['previewId'])
        with pytest.raises(DesignError,match='blockers'):
            await edit(s,'session.restore',previewId=blocked['previewId'])
    asyncio.run(run())


def test_explicit_window_request_is_wall_scoped_and_dimensions_are_validated():
    s = Session()
    s.room_permissions['w'] = explicit_permissions('Add a north-facing window')
    raw = dict(requestId='w',baseRevision=0,operation='window.add',window={'wall':'north','offset':.5,'width':1,'height':1,'sill':1})
    with pytest.raises(DesignError):
        edit_room(s,{**raw,'wall':'north','window':{**raw['window'],'wall':'south'}})
    edit_room(s,raw)
    assert len(s.state.room.windows) == 2
    s.room_permissions['h'] = explicit_permissions('Set room height to 2 meters')
    with pytest.raises(DesignError):
        edit_room(s,dict(requestId='h',baseRevision=1,operation='room.resize',width=5))
    with pytest.raises(DesignError):
        edit_room(s,dict(requestId='h',baseRevision=1,operation='room.resize',height=2))
    assert s.state.room.height == 2.6 and s.state.revision == 1


def test_explicit_reset_clears_locked_pieces_and_undo_restores_them():
    async def run():
        s = Session()
        await add(s)
        s.state.slots['desk'].locked = True
        before = s.state.model_copy(deep=True)
        with pytest.raises(DesignError, match='Unlock'):
            await edit(s, 'room.clear')
        assert s.state == before
        await edit(s, 'room.clear', allowLocked=['desk'])
        assert not s.state.slots
        assert s.state.room == before.room and s.state.budget == before.budget
        await edit(s, 'room.undo')
        assert s.state.slots['desk'].locked
        assert s.state.slots['desk'].catalogId == before.slots['desk'].catalogId
    asyncio.run(run())
