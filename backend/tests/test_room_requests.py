import pytest

from backend.architecture import edit_room, explicit_permissions
from backend.design import DesignError
from backend.sessions import Session


@pytest.mark.parametrize('text', [
    'Make it cozier', 'Give me a blue theme', 'I have blue walls',
    'I like blue walls', 'Give me blue wall art', 'Add a blue floor lamp',
    'Do not paint the walls blue', 'Keep the north window',
])
def test_general_or_prohibited_requests_grant_nothing(text):
    assert explicit_permissions(text) == []


@pytest.mark.parametrize('text', ['Give me a room with blue walls', 'Paint the walls blue',
                                 'I would like blue walls', 'Can you make the walls blue'])
def test_explicit_walls_in_brief(text):
    grants = explicit_permissions(text)
    assert len(grants) == 1 and grants[0]['wallPaint']
    assert not grants[0]['floorPaint']
    assert set(grants[0]['walls']) == {'north', 'east', 'south', 'west'}


def test_finish_scoping_atomic_rejection_and_single_use():
    s = Session()
    before = s.state.model_copy(deep=True)
    s.room_permissions['paint'] = explicit_permissions('Paint the north wall blue')
    raw = dict(requestId='paint', baseRevision=0, operation='room.finish')
    for extra in [dict(wallColors={'south': '#123456'}),
                  dict(wallColors={'north': '#123456'}, floorColor='#ffffff'),
                  dict(wallColors={'north': '#123456'}, sunHour=12)]:
        with pytest.raises(DesignError):
            edit_room(s, {**raw, **extra})
        assert s.state == before and s.room_permissions['paint']
    edit_room(s, {**raw, 'wallColors': {'north': '#123456'}})
    assert s.state.room.wallColors == {**before.room.wallColors, 'north': '#123456'}
    assert s.state.room.floorColor == before.room.floorColor
    assert s.state.revision == 1
    with pytest.raises(DesignError):
        edit_room(s, {**raw, 'baseRevision': 1, 'wallColors': {'north': '#ffffff'}})


def test_floor_grant_cannot_paint_walls_and_unrequested_edits_fail():
    s = Session()
    s.room_permissions['floor'] = explicit_permissions('Change the floor color to white')
    with pytest.raises(DesignError):
        edit_room(s, dict(requestId='floor', baseRevision=0, operation='room.finish', wallColors={'north': '#ffffff'}))
    edit_room(s, dict(requestId='floor', baseRevision=0, operation='room.finish', floorColor='#ffffff'))
    with pytest.raises(DesignError):
        edit_room(s, dict(requestId='general', baseRevision=1, operation='room.finish', floorColor='#123456'))


def test_window_move_does_not_allow_resize_or_another_destination():
    s = Session()
    window = s.state.room.windows[0]
    source = window.wall
    destination = next(w for w in ['north', 'south', 'west'] if w != source)
    s.room_permissions['move'] = explicit_permissions(f'Move the {source} window to the {destination} wall')
    raw = dict(requestId='move', baseRevision=0, operation='window.update', wall=source)
    moved = {**window.model_dump(), 'wall': destination}
    with pytest.raises(DesignError):
        edit_room(s, {**raw, 'window': {**moved, 'width': window.width + .1}})
    wrong = next(w for w in ['north', 'south', 'west', 'east'] if w not in [source, destination])
    with pytest.raises(DesignError):
        edit_room(s, {**raw, 'window': {**moved, 'wall': wrong}})
    edit_room(s, {**raw, 'window': moved})
    assert s.state.room.windows[0].wall == destination
    assert s.state.room.windows[0].width == window.width
