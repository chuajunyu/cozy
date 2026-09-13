"""Request-scoped room edits; broad design prompts never grant room permissions."""

from typing import Annotated, Literal

from pydantic import Field

from backend.design import DoorAnchor, Model, Slot, Window, require, total, validate_layout
from backend.placement import settle_state
from backend.room_requests import explicit_permissions


class RoomEdit(Model):
    requestId: str
    baseRevision: int
    operation: Literal['window.add','window.update','window.remove','door.add','door.update','door.remove','door.open','door.close','room.resize','sun.set','room.finish']
    wall: Literal['north','east','south','west'] | None = Field(default=None, description='Current/source wall for an existing window or door; destination wall for additions. A moved window/door supplies its destination inside window/door.')
    slotId: str | None = Field(default=None, max_length=60, pattern=r'^[a-zA-Z0-9_-]+$')
    window: Window | None = None
    door: DoorAnchor | None = None
    width: float | None = Field(default=None, ge=2, le=12)
    depth: float | None = Field(default=None, ge=2, le=12)
    height: float | None = Field(default=None, ge=2, le=5)
    sunHour: float | None = Field(default=None, ge=6, le=20)
    wallColors: dict[Literal['north', 'east', 'south', 'west'], Annotated[str, Field(pattern=r'^#[0-9a-fA-F]{6}$')]] | None = Field(default=None, description='Only explicitly requested walls and their hex colors; omitted walls retain their paint. All walls can be set together.')
    floorColor: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$', description='Hex floor color, only for an explicit floor-finish request.')


def edit_room(session, raw):
    command = RoomEdit.model_validate(raw)
    allowed = {
        'room.finish': {'wallColors', 'floorColor'}, 'room.resize': {'width', 'depth', 'height'}, 'sun.set': {'sunHour'},
        'window.add': {'wall', 'window'}, 'window.update': {'wall', 'window'}, 'window.remove': {'wall'},
        'door.add': {'wall', 'slotId', 'door'}, 'door.update': {'wall', 'slotId', 'door'},
        'door.remove': {'wall', 'slotId'}, 'door.open': {'wall', 'slotId'}, 'door.close': {'wall', 'slotId'},
    }
    supplied = {field for field in command.model_fields_set if getattr(command, field) is not None} - {'requestId', 'baseRevision', 'operation'}
    require(supplied <= allowed[command.operation], 'invalid_arguments', 'Supply only fields used by this room-edit operation.')
    require(command.baseRevision == session.state.revision, 'stale_revision', 'Read the latest room before editing.')
    grants = session.room_permissions.get(command.requestId, [])
    state = session.state.model_copy(deep=True)
    slot = state.slots.get(command.slotId or '')
    wall = command.wall or (slot.door.wall if slot and slot.door else command.window.wall if command.window else command.door.wall if command.door else None)
    if command.operation.startswith('door.') and command.operation != 'door.add' and slot and slot.door:
        require(slot.door.wall == wall, 'architecture_permission', 'Select the door on the requested wall.')
    def permits(grant: dict) -> bool:
        if grant['operation'] != command.operation:
            return False
        if command.operation == 'room.finish':
            return (not command.wallColors or bool(grant.get('wallPaint')) and
                    (not grant['walls'] or set(command.wallColors) <= set(grant['walls'])) and
                    len(command.wallColors) <= grant.get('wallLimit', 1)) and (command.floorColor is None or bool(grant.get('floorPaint')))
        return (not grant['walls'] or wall in grant['walls']) and (not grant.get('slotIds') or command.slotId in grant['slotIds'])
    grant = next((g for g in grants if permits(g)), None)
    require(grant is not None, 'architecture_permission', 'Ask the user for an explicit instruction for this room change.')
    op = command.operation
    if op == 'room.finish':
        require(bool(command.wallColors) or command.floorColor is not None, 'room_finish', 'Supply at least one requested surface color.')
        if command.wallColors:
            require(grant.get('wallPaint') and (not grant['walls'] or set(command.wallColors) <= set(grant['walls'])) and
                    len(command.wallColors) <= grant.get('wallLimit', 1), 'architecture_permission', 'Paint only the explicitly requested wall surfaces.')
            state.room.wallColors.update(command.wallColors)
        if command.floorColor is not None:
            require(grant.get('floorPaint'), 'architecture_permission', 'Floor color needs its own explicit request.')
            state.room.floorColor = command.floorColor
    elif op.startswith('window.'):
        require(wall is not None, 'window', 'Specify the window wall.')
        existing = next((w for w in state.room.windows if w.wall == wall), None)
        require((existing is None) == (op == 'window.add'), 'window', 'Choose an existing window to change or an empty wall to add.')
        state.room.windows = [w for w in state.room.windows if w.wall != wall]
        if op != 'window.remove':
            require(command.window is not None, 'window', 'Supply the requested window dimensions.')
            if existing:
                changed = {field for field in Window.model_fields if getattr(existing, field) != getattr(command.window, field)}
                require(changed <= set(grant.get('fields', Window.model_fields)), 'architecture_permission', 'Change only the requested window properties.')
                require((command.window.wall == wall or grant.get('allowWallChange')) and
                        (not grant.get('targetWalls') or command.window.wall in grant['targetWalls']), 'architecture_permission', 'Move only to the requested wall.')
            else:
                require(command.window.wall == wall, 'architecture_permission', 'The new window must match the requested wall.')
            require(not any(w.wall == command.window.wall for w in state.room.windows), 'window', 'The destination wall already has a window.')
            state.room.windows.append(command.window)
    elif op == 'room.resize':
        changed = False
        for field in ('width','depth','height'):
            value = getattr(command, field)
            if value is not None:
                require(not grant['dimensions'] or field in grant['dimensions'], 'architecture_permission', 'Change only the requested room dimension.')
                setattr(state.room, field, value)
                changed = True
        require(changed, 'room_dimensions', 'Supply a requested room dimension.')
    elif op == 'sun.set':
        require(command.sunHour is not None, 'sun_time', 'Supply a solar hour.')
        state.room.sunHour = command.sunHour
    elif op == 'door.add':
        require(command.door is not None and command.slotId and slot is None, 'door', 'Supply a new door ID and anchor.')
        require(not command.wall or command.door.wall == command.wall, 'door', 'Door wall must match the requested wall.')
        p = session.products['sample-room-door']
        state.slots[command.slotId] = Slot(id=command.slotId, label='Door', category='door', zone='Room', group='Room elements', catalogId=p['id'], door=command.door)
    else:
        require(slot is not None and slot.door is not None, 'door', 'Select an existing door.')
        if op in {'door.open','door.close'}:
            slot.door.open = op == 'door.open'
        else:
            require(not slot.locked, 'locked', 'Unlock this door before moving or deleting it.')
            if op == 'door.remove':
                del state.slots[slot.id]
            else:
                require(command.door is not None, 'door', 'Supply a door anchor.')
                require(command.door.open == slot.door.open, 'architecture_permission', 'Opening or closing the door requires its own explicit request.')
                require((command.door.wall == slot.door.wall or grant.get('allowWallChange')) and
                        (not grant.get('targetWalls') or command.door.wall in grant['targetWalls']), 'architecture_permission', 'Move only to the requested wall.')
                slot.door = command.door
    state = settle_state(state, session.state, session.products)
    validate_layout(state, session.products, check_budget=False)
    require(state.budget is None or total(state, session.products) <= max(state.budget, total(session.state, session.products)),
            'over_budget', 'Stay within the budget, or reduce the current cost before adding more.')
    state.revision += 1
    session.accept(state)
    grants.remove(grant)
    session.broadcast_state()
    return {'ok': True, 'state': session.snapshot()}
