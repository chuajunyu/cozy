import asyncio

import pytest
from pydantic import ValidationError

from backend.catalog import BY_ID
from backend.design import Room, Window
from backend.sessions import Session
from backend.tests.test_studio import add, edit


def test_bouquet_support_moves_and_undoes_with_vase():
    async def run():
        s = Session()
        vase = next(p for p in BY_ID.values() if p.get('placement', {}).get('support', {}).get('kind') == 'bouquet')
        await add(s, 'vase', vase['id'])
        await add(s, 'flowers', 'sample-meadow-bouquet', supportId='vase', elevation=vase['placement']['support']['height'])
        await edit(s, 'item.update', slotId='vase', expectedProduct=vase['id'], x=.5)
        assert s.state.slots['flowers'].x == .5
        assert s.state.slots['flowers'].supportId == 'vase'
        await edit(s, 'room.undo')
        assert s.state.slots['flowers'].x == 0
        restored = Session()
        await edit(restored, 'session.restore', backup={'version':3,'state':s.state.model_dump(mode='json'),'products':[]})
        assert restored.state.slots['flowers'].supportId == 'vase'
    asyncio.run(run())


def test_room_finishes_roundtrip_and_reject_unknown_patterns():
    room = Room(wallpapers={'north':'dots'}, windows=[Window(wall='east',offset=.5,width=1.5,height=1.2,sill=.9,curtain='linen')])
    assert Room.model_validate(room.model_dump()).windows[0].curtain == 'linen'
    with pytest.raises(ValidationError):
        Room(wallpapers={'north':'unknown'})
    with pytest.raises(ValidationError):
        Window(wall='east',offset=.5,width=1.5,height=1.2,sill=.9,curtain='unknown')
