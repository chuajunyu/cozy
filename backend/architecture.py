"""Request-scoped room edits; broad design prompts never grant room permissions."""

import re
from typing import Literal

from pydantic import Field

from backend.design import DoorAnchor, Model, Slot, Window, require, total, validate_layout
from backend.placement import settle_state


class RoomEdit(Model):
    requestId: str
    baseRevision: int
    operation: Literal['window.add','window.update','window.remove','door.add','door.update','door.remove','door.open','door.close','room.resize','sun.set']
    wall: Literal['north','east','south','west'] | None = None
    slotId: str | None = Field(default=None, max_length=60, pattern=r'^[a-zA-Z0-9_-]+$')
    window: Window | None = None
    door: DoorAnchor | None = None
    width: float | None = Field(default=None, ge=2, le=12)
    depth: float | None = Field(default=None, ge=2, le=12)
    height: float | None = Field(default=None, ge=2, le=5)
    sunHour: float | None = Field(default=None, ge=6, le=20)


def explicit_permissions(text):
    permissions = []
    for clause in re.split(r'[.!?;\n]|\band\b', text.lower()):
        clause = clause.strip()
        if re.search(r"\b(not|never|without|avoid|don't|do not|shouldn't|cannot)\b", clause):
            continue
        match = re.match(r'(?:(?:please|can you|could you|would you|i want you to)\s+)*(add|create|install|place|put|move|relocate|resize|widen|narrow|remove|delete|open|close|set|change)\b(.*)', clause)
        if not match:
            continue
        verb, rest = match.groups()
        target = 'window' if re.search(r'\bwindows?\b', rest) else 'door' if re.search(r'\bdoors?\b', rest) else None
        action = 'add' if verb in {'add','create','install','place','put'} else 'remove' if verb in {'remove','delete'} else verb if verb in {'open','close'} else 'update'
        operation = f'{target}.{action}' if target else 'sun.set' if re.search(r'\bsun(?:light)?\b|\btime(?: of day)?\b', rest) and verb in {'set','change'} else 'room.resize' if re.search(r'\broom\b', rest) and verb in {'resize','widen','narrow','set','change'} else None
        if operation in {'window.open','window.close'} or operation is None:
            continue
        walls = re.findall(r'\b(north|east|south|west)\b', rest)
        dimensions = re.findall(r'\b(width|depth|height)\b', rest)
        if operation == 'room.resize' and verb in {'set', 'change'} and not dimensions and not re.search(r'\b(size|dimensions)\b', rest):
            continue
        if operation == 'sun.set' and not re.search(r'\bsun(?:light)?\b|\btime of day\b|\bsolar\b', rest):
            continue
        permissions.append({'operation': operation, 'walls': walls, 'dimensions': dimensions})
    return permissions


def edit_room(session, raw):
    command = RoomEdit.model_validate(raw)
    require(command.baseRevision == session.state.revision, 'stale_revision', 'Read the latest room before editing.')
    grants = session.room_permissions.get(command.requestId, [])
    state = session.state.model_copy(deep=True)
    slot = state.slots.get(command.slotId or '')
    wall = command.wall or (command.window.wall if command.window else command.door.wall if command.door else slot.door.wall if slot and slot.door else None)
    if command.door:
        require(command.door.wall == wall, 'architecture_permission', 'The door anchor must match the permitted wall.')
    if command.operation in {'door.open', 'door.close', 'door.remove'} and slot and slot.door:
        require(slot.door.wall == wall, 'architecture_permission', 'Select the door on the requested wall.')
    grant = next((g for g in grants if g['operation'] == command.operation and (not g['walls'] or wall in g['walls'])), None)
    require(grant is not None, 'architecture_permission', 'Ask the user for an explicit instruction for this room change.')
    op = command.operation
    if op.startswith('window.'):
        require(wall is not None, 'window', 'Specify the window wall.')
        existing = next((w for w in state.room.windows if w.wall == wall), None)
        require((existing is None) == (op == 'window.add'), 'window', 'Choose an existing window to change or an empty wall to add.')
        state.room.windows = [w for w in state.room.windows if w.wall != wall]
        if op != 'window.remove':
            require(command.window is not None and command.window.wall == wall, 'window', 'Supply the requested window dimensions.')
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
