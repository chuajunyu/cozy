import asyncio
import json

import pytest
from pydantic import ValidationError

from backend.catalog import BY_ID
from backend.design import DesignError, Room, Slot, WallMount, validate_layout
from backend.placement import settle_state
from backend.sessions import Session
from backend.tests.test_studio import add, edit

LAMP = 'ikea-20595132'


def test_wall_lamp_centered_anchors_all_walls_and_room_height():
    from backend.wall_fixtures import normalize
    p = BY_ID[LAMP]
    for wall, rotation in [('north', 0), ('east', 270), ('south', 180), ('west', 90)]:
        s = Session()
        s.state.room.windows = []
        lamp = Slot(id='lamp', label='Lamp', category='lamp', zone='Room', group='Test', catalogId=LAMP, wallMount=WallMount(wall=wall, offset=.5, height=1.7))
        normalize(lamp, p, s.state.room)
        assert lamp.rotation == rotation
        assert lamp.elevation == pytest.approx(1.7-p['height']/2)
        s.state.slots[lamp.id] = lamp
        validate_layout(s.state)
        lamp.x += .3
        with pytest.raises(DesignError):
            validate_layout(s.state)


def test_wall_lamp_transactions_windows_paint_lock_undo_restore():
    async def run():
        s = Session()
        await add(s, 'lamp', LAMP, wallMount={'wall':'north','offset':.5,'height':1.7})
        await edit(s, 'room.update', room={**s.state.room.model_dump(), 'wallColors': {'north':'#be7967'}})
        await edit(s, 'item.update', slotId='lamp', expectedProduct=LAMP, wallMount={'wall':'north','offset':.1,'height':1.8})
        saved = s.state.model_dump(mode='json')
        # A window which hits the lamp rejects atomically; a clear opening fits.
        with pytest.raises(DesignError):
            await edit(s, 'room.update', room={**s.state.room.model_dump(), 'windows':[{'wall':'north','offset':0,'width':1.8,'height':1.4,'sill':.9}]})
        assert s.state.model_dump(mode='json') == saved
        await edit(s, 'room.update', room={**s.state.room.model_dump(), 'windows':[{'wall':'north','offset':1,'width':1.2,'height':1,'sill':.8}]})
        await edit(s, 'room.undo')
        assert s.state.room.windows[0].wall == 'east'
        # Mounts and paint survive the existing explicit backup preview flow.
        restored = Session()
        await edit(restored, 'session.restore', backup={'version':3,'state':json.loads(s.state.model_dump_json()),'products':[]})
        assert restored.state.room.wallColors == {'north':'#be7967'}
        assert restored.state.slots['lamp'].wallMount.height == 1.8
        restored.state.slots['lamp'].locked = True
        before = restored.state.model_copy(deep=True)
        candidate = before.model_copy(deep=True)
        candidate.room.width += 1
        with pytest.raises(DesignError):
            settle_state(candidate, before, restored.products)
        await edit(restored, 'fixture.update', slotId='lamp', expectedProduct=LAMP, light={'on':False,'brightness':1,'color':'#ffd3a0'})
        assert not restored.state.slots['lamp'].light.on
    asyncio.run(run())


def test_invalid_paint_rejects_and_old_rooms_default():
    assert Room().wallColors == {}
    for colors in [{'ceiling':'#ffffff'}, {'north':'red'}, {'west':'url(evil)'}, {'north':None}]:
        with pytest.raises(ValidationError):
            Room(wallColors=colors)


def test_floor_color_validated_and_preserved_through_edit_undo_restore():
    assert Room().floorColor == '#c7ac88'
    for color in ['red', '#fff', '#ffffff00', None, 123, 'url(evil)']:
        with pytest.raises(ValidationError):
            Room(floorColor=color)

    async def run():
        s = Session()
        await edit(s, 'room.update', room={**s.state.room.model_dump(), 'floorColor': '#79553e', 'wallColors': {'west': '#dadfd3'}})
        await add(s)
        saved = json.loads(s.state.model_dump_json())
        assert s.state.room.floorColor == '#79553e'
        await edit(s, 'room.update', room={**s.state.room.model_dump(), 'floorColor': '#596064'})
        await edit(s, 'room.undo')
        assert s.state.room.floorColor == '#79553e'
        restored = Session()
        await edit(restored, 'session.restore', backup={'version': 3, 'state': saved, 'products': []})
        assert restored.state.room.floorColor == '#79553e'
        assert restored.state.room.wallColors == {'west': '#dadfd3'}
        assert 'desk' in restored.state.slots
    asyncio.run(run())
