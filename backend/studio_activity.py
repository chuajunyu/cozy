"""Readable activity for accepted manual edits, separate from designer speech."""

from backend.design import DesignState


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
