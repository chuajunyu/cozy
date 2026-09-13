"""Readable activity for accepted manual edits, separate from designer speech."""

from backend.design import DesignState


def activity_change(kind: str, slot_id: str | None, before: DesignState,
                    after: DesignState, products: dict) -> dict | None:
    """Bounded, semantic changes; never derive actions from user-facing prose."""
    old, new = before.slots.get(slot_id), after.slots.get(slot_id)
    slot = new or old
    actions = []
    detail = None
    if kind in {'item.add', 'item.delete', 'item.replace'}:
        if old == new:
            return None
        actions.append({'item.add': 'added', 'item.delete': 'removed', 'item.replace': 'replaced'}[kind])
    elif kind == 'item.update' and old != new:
        if (old.x, old.z, old.elevation, old.supportId, old.wallMount) != (new.x, new.z, new.elevation, new.supportId, new.wallMount):
            actions.append('moved')
        if old.rotation != new.rotation:
            actions.append('rotated')
        if old.door and new.door:
            if (old.door.wall, old.door.offset) != (new.door.wall, new.door.offset) and 'moved' not in actions:
                actions.append('moved')
            if old.door.open != new.door.open:
                actions.append('door')
                detail = 'open' if new.door.open else 'closed'
        if not actions:
            actions.append('adjusted')
    elif kind == 'fixture.update' and old != new:
        actions.append('light')
        detail = 'off' if new.light and not new.light.on else 'on'
    elif kind == 'room.update':
        for fields, label in [
            (('windows',), 'windows'), (('sunHour', 'daylight'), 'sunlight'),
            (('floorColor',), 'floor color'), (('wallColors',), 'wall colors'),
            (('width', 'depth', 'height'), 'room dimensions'),
        ]:
            if any(getattr(before.room, f) != getattr(after.room, f) for f in fields):
                actions.append(label)
        if before.budget != after.budget:
            actions.append('budget')
        slot = None
    if not actions:
        return None
    reference = ({'slotId': slot.id, 'name': products.get(slot.catalogId, {}).get('name') or slot.label,
                  'category': 'door' if slot.door else slot.category} if slot else None)
    return {'key': 'item:' + slot.id if slot else 'room', 'actions': actions, 'reference': reference, 'detail': detail}


def change_label(change: dict) -> str:
    actions = change['actions']
    if change['reference'] is None:
        return 'Updated ' + (' and '.join(actions) if len(actions) <= 2 else ', '.join(actions[:-1]) + ' and ' + actions[-1])
    words = [{'door': 'set door ' + (change['detail'] or ''),
              'light': 'adjusted light' + (' (' + change['detail'] + ')' if change['detail'] else '')}.get(a, a) for a in actions]
    # Keep lifecycle order meaningful, including adding then removing a piece.
    separator = ', then ' if 'removed' in actions else ' and '
    return separator.join(words).capitalize()


def merge_activity(changes: list[dict], change: dict) -> list[dict]:
    result = [dict(c) for c in changes]
    existing = next((c for c in result if c['key'] == change['key']), None)
    if existing is None:
        result.append(dict(change))
    else:
        # Retain the latest lifecycle order if an ID is removed and reused; the
        # summary must not end with "removed" for a piece that exists again.
        lifecycle = {'added', 'removed', 'replaced'} & set(change['actions'])
        existing['actions'] = list(dict.fromkeys([*[a for a in existing['actions'] if a not in lifecycle], *change['actions']]))
        existing['reference'] = change['reference']
        if change['detail'] is not None:
            existing['detail'] = change['detail']
    for entry in result:
        entry['label'] = change_label(entry)
    return result


def describe_activity(kind: str, slot_id: str | None, before: DesignState,
                      after: DesignState, products: dict) -> tuple[str, list[dict]] | None:
    old = before.slots.get(slot_id)
    new = after.slots.get(slot_id)
    slot = new or old
    references = [{"slotId": slot.id, "name": products.get(slot.catalogId, {}).get("name") or slot.label,
                   "category": "door" if slot.door else slot.category}] if slot else []
    if kind == 'item.add':
        return 'You added', references
    if kind == 'item.delete':
        return 'You removed', references
    if kind == 'item.replace':
        return 'You replaced a piece with', references
    if kind == 'item.update' and old != new:
        if old.door and new.door and old.door.open != new.door.open:
            return ('You opened' if new.door.open else 'You closed'), references
        if old.rotation != new.rotation and (old.x, old.z, old.elevation) == (new.x, new.z, new.elevation):
            return 'You rotated', references
        return 'You moved', references
    if kind == 'fixture.update' and old != new:
        return 'You adjusted the light on', references
    if kind == 'room.undo':
        return 'You undid the last room change', []
    if kind == 'room.clear':
        return 'You reset the room', []
    if kind == 'room.update':
        changes = []
        if before.room.windows != after.room.windows:
            changes.append('windows')
        if before.room.sunHour != after.room.sunHour or before.room.daylight != after.room.daylight:
            changes.append('sunlight')
        if before.room.floorColor != after.room.floorColor:
            changes.append('floor color')
        if before.room.wallColors != after.room.wallColors:
            changes.append('wall colors')
        if any(getattr(before.room, field) != getattr(after.room, field) for field in ('width', 'depth', 'height')):
            changes.append('room dimensions')
        if before.budget != after.budget:
            changes.append('budget')
        if changes:
            return 'You updated ' + ', '.join(changes), []
    return None
