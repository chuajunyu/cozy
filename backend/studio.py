"""Manual studio transactions share the agent's authoritative state."""

import asyncio
from typing import Any, Literal

from pydantic import Field

from backend.design import DesignState, DoorAnchor, WallMount, LightSettings, Model, Room, Slot, require, validate_layout
from backend.placement import alternative_kind, inferred_support, settle_state
from backend.products import GeneratedProduct, generated
from backend.sessions import Session
from backend.concurrency import can_rebase
from backend.studio_activity import activity_change, describe_activity
from backend.model_context import compact_feedback


class Backup(Model):
    version: Literal[2, 3, 4]
    variants: Any = None
    state: DesignState
    products: list[GeneratedProduct] = Field(default_factory=list, max_length=100)


class StudioCommand(Model):
    type: Literal["lighting.apply", "item.add", "item.update", "item.delete", "item.replace", "room.update", "fixture.update",
                  "room.clear", "room.undo", "catalog.import", "session.restore", "session.restore.preview"]
    requestId: str = Field(min_length=1, max_length=100)
    baseRevision: int = Field(ge=0)
    slotId: str | None = Field(default=None, max_length=60, pattern=r"^[a-zA-Z0-9_-]+$")
    catalogId: str | None = None
    expectedProduct: str | None = None
    x: float | None = None
    z: float | None = None
    rotation: Literal[0, 90, 180, 270] | None = None
    elevation: float | None = Field(default=None, ge=0, le=5)
    light: LightSettings | None = None
    sunHour: float | None = Field(default=None, ge=6, le=20)
    fixtures: dict[str, LightSettings] = Field(default_factory=dict, max_length=8)
    supportId: str | None = Field(default=None, max_length=60)
    door: DoorAnchor | None = None
    wallMount: WallMount | None = None
    room: Room | None = None
    budget: float | None = Field(default=None, gt=0, le=1_000_000)
    product: GeneratedProduct | None = None
    backup: Backup | None = None
    previewId: str | None = None
    allowLocked: list[str] = Field(default_factory=list, max_length=100)


async def pause(session: Session) -> None:
    # Invalidate first, then cancel outside the scene lock. A pending tool cannot
    # sneak in while undo waits for the upstream task to finish.
    async with session.lock:
        session.generation += 1
        task = session.task
        if task and not task.done():
            task.cancel()
    if task:
        await asyncio.gather(task, return_exceptions=True)
    session.task = None
    session.designer = None
    session.previous_response_id = None
    session.room_permissions.clear()
    session.set_status("idle", "Design paused; your room is preserved")


async def handle_studio(session: Session, command: StudioCommand) -> None:
    # All browser commands use this mutex; model commits still use session.lock.
    async with session.command_lock:
        async with session.lock:
            if command.requestId in session.requests:
                session.publish(session.requests[command.requestId])
                return
            if command.baseRevision != session.state.revision and command.type in {'item.update', 'item.delete', 'item.replace', 'fixture.update'}:
                if can_rebase(session.revisions.get(command.baseRevision), session.state, command.slotId):
                    command = command.model_copy(update={'baseRevision': session.state.revision})
            require(command.baseRevision == session.state.revision, "stale_revision", "The room changed. Review it and try again.")
            if command.type == 'session.restore.preview':
                from backend.restore import preview_restore
                event = preview_restore(session, command)
                session.requests[command.requestId] = event
                session.publish(event)
                return
            if command.type == "room.undo":
                require(bool(session.history), "empty_history", "There is no room change to undo.")
            if command.type == "room.clear":
                locked = {s.id for s in session.state.slots.values() if s.locked}
                require(locked <= set(command.allowLocked), "locked", "Unlock pieces before clearing the room.")
            if command.type == "session.restore":
                require(session.state.revision == 0 and not session.state.slots, "restore_conflict", "A live room cannot be replaced by a backup.")
                require(command.previewId is not None, 'missing_preview', 'Preview the backup before restoring it.')
            # Fence commits during the cancellation gap, including fresh get-state calls.
            stopping = command.type in {"room.undo", "room.clear", "session.restore"}
            if stopping:
                session.generation += 1
        if stopping:
            await pause(session)
        async with session.lock:
            require(command.baseRevision == session.state.revision, "stale_revision", "The room changed. Review it and try again.")
            state = session.state.model_copy(deep=True)
            products = session.products
            custom = dict(session.custom_products)
            kind = command.type
            slot = state.slots.get(command.slotId or "")
            if kind in {"item.update", "item.delete", "fixture.update", "item.replace"}:
                require(slot is not None and slot.catalogId is not None, "unknown_slot", "Select a placed item.")
                require(command.expectedProduct == slot.catalogId, "item_changed", "The selected product changed.")
                door_switch = kind == 'item.update' and slot.door and command.door and slot.door.wall == command.door.wall and slot.door.offset == command.door.offset and not any(f in command.model_fields_set for f in ('x','z','rotation','elevation','supportId'))
                if kind != "fixture.update" and not door_switch:
                    require(not slot.locked, "locked", "Unlock the piece before changing its placement.")
            if kind == 'lighting.apply':
                from backend.lighting import apply_lighting
                state = apply_lighting(state, products, command.sunHour, command.fixtures)
            elif kind == "item.add":
                require(command.slotId is not None and command.slotId not in state.slots, "duplicate_slot", "Use a new item ID.")
                p = products.get(command.catalogId)
                require(p is not None, "unknown_product", "Choose a catalog product.")
                require(command.x is not None and command.z is not None, "missing_position", "Supply a position.")
                state.slots[command.slotId] = Slot(id=command.slotId, label=p["name"][:80], category=p["category"],
                    zone="Room", group="Your additions", catalogId=p["id"], x=command.x, z=command.z,
                    rotation=command.rotation or 0, elevation=command.elevation or 0, light=command.light,
                    supportId=command.supportId, door=command.door, wallMount=command.wallMount,
                    explanation="Added by you.")
            elif kind == "item.update":
                for field in ("x", "z", "rotation", "elevation"):
                    value = getattr(command, field)
                    if value is not None:
                        setattr(slot, field, value)
                if 'supportId' in command.model_fields_set:
                    slot.supportId = command.supportId
                if command.wallMount is not None:
                    slot.wallMount = command.wallMount
                if command.door is not None:
                    slot.door = command.door
            elif kind == 'item.replace':
                p = products.get(command.catalogId)
                require(p is not None and not p.get('door') and not slot.door, 'replacement', 'Choose a furniture alternative.')
                require(alternative_kind(p) == alternative_kind(products[slot.catalogId]), 'category_mismatch', 'Choose the same furniture type.')
                slot.catalogId = p['id']
                slot.category = p['category']
                slot.liked = slot.replacing = False
                slot.explanation = 'Chosen by you from similar pieces.'
                state.rejected.pop(slot.id, None)
                if state.rerollTargets:
                    state.rerollTargets = [id for id in state.rerollTargets if id != slot.id] or None
                if slot.light and p.get('lighting', {}).get('colorMode') != 'bulb-dependent':
                    slot.light.bulbProfile = None
                if not p.get('lighting'):
                    slot.light = None
                elif slot.light and (p['lighting']['colorMode'] == 'fixed' or p['lighting']['colorMode'] == 'white-spectrum' and slot.light.color.lower() not in {'#ffd3a0','#fff4dd','#dceaff'}):
                    slot.light.color = '#ffd3a0'
            elif kind == "fixture.update":
                require(command.light is not None, "missing_light", "Supply fixture settings.")
                slot.light = command.light
            elif kind == "item.delete":
                del state.slots[slot.id]
                state.rejected.pop(slot.id, None)
                if state.rerollTargets is not None:
                    state.rerollTargets = [id for id in state.rerollTargets if id != slot.id] or None
            elif kind == "room.update":
                if command.room is not None:
                    state.room = command.room
                if "budget" in command.model_fields_set:
                    state.budget = command.budget
            elif kind == "room.clear":
                state.slots.clear()
                state.rejected.clear()
                state.rerollTargets = None
            elif kind == "room.undo":
                previous = session.history[-1]
                state = previous.model_copy(deep=True)
                # Conversation stays current, while constraints/room roll back together.
                state.feedback = session.state.feedback
                state.rerollTargets = None
                for item in state.slots.values():
                    item.replacing = False
            elif kind == "catalog.import":
                require(command.product is not None, "missing_product", "Supply a generated product.")
                p = generated(command.product.model_dump(exclude_none=True))
                require(p["id"] not in products, "duplicate_product", "Existing catalog IDs cannot be overwritten.")
                require(len(custom) < 100, "catalog_limit", "This session supports 100 custom products.")
                custom[p["id"]] = p
            elif kind == "session.restore":
                if command.previewId:
                    from backend.restore import apply_preview
                    command.backup = apply_preview(session, command)
                require(command.backup is not None, "missing_backup", "Supply a room backup.")
                custom = {}
                for raw in command.backup.products:
                    p = generated(raw.model_dump(exclude_none=True))
                    require(p["id"] not in products and p["id"] not in custom, "duplicate_product", "Duplicate backup product ID.")
                    custom[p["id"]] = p
                state = command.backup.state.model_copy(deep=True)
                require(all(id == s.id for id, s in state.slots.items()), "invalid_backup", "Slot IDs must match their keys.")
                state.rerollTargets = None
                for item in state.slots.values():
                    item.replacing = False
            products = {**products, **custom}
            if kind in {'item.add', 'item.update', 'item.delete', 'item.replace', 'room.update'}:
                state = settle_state(state, session.state, products)
                if kind == 'item.replace':
                    for old in session.state.slots.values():
                        parent = inferred_support(old, session.state, products)
                        if parent:
                            require(state.slots[old.id].supportId == parent.id, 'support_fit', 'The replacement must preserve supporting surfaces.')
                    require(bool(slot.wallMount) or abs(state.slots[slot.id].elevation-slot.elevation) <= .005, 'support_fit', 'The replacement must retain its mounting height.')
            validate_layout(state, products, check_budget=False)
            if kind == 'lighting.apply' and state == session.state:
                ack = {'type': 'command.ack', 'requestId': command.requestId, 'revision': state.revision}
                session.requests[command.requestId] = ack
                session.publish(ack)
                return
            if kind == "room.undo":
                session.history.pop()
            elif kind == "session.restore":
                session.history.clear()
                session.restore_previews.clear()
            elif kind != "catalog.import":
                session.remember()
            state.revision = session.state.revision + 1
            text = f"Manual change: {kind}; item {command.slotId or 'room'}."
            if kind not in {"catalog.import", "session.restore", "room.undo"}:
                state.feedback.append({"type": "manual", "text": text, "slotIds": [command.slotId] if command.slotId else []})
                state.feedback = compact_feedback(state.feedback)
                state.feedback = state.feedback[-100:]
            change = activity_change(kind, command.slotId, session.state, state, products)
            if kind == 'lighting.apply':
                change = {'key': 'lighting', 'actions': ['lighting'], 'label': 'Updated lighting.', 'reference': None, 'detail': None}
            activity = describe_activity(kind, command.slotId, session.state, state, products) if kind in {'room.undo', 'room.clear'} else None
            if kind in {'room.undo', 'room.clear', 'session.restore'}:
                session.close_activity()
            session.state = state
            session.custom_products = custom
            if kind in {"catalog.import", "session.restore"}:
                session.publish({"type": "catalog.updated", "catalog": list(session.products.values())})
            if kind == 'session.restore':
                from backend.variants import recover_variants
                session.variants = recover_variants(command.backup.variants, state, session.products)
                session.publish({'type': 'variants.updated', 'variants': session.variants})
            session.broadcast_state()
            ack = {"type": "command.ack", "requestId": command.requestId, "revision": state.revision}
            session.requests[command.requestId] = ack
            if len(session.requests) > 500:
                del session.requests[next(iter(session.requests))]
            session.publish(ack)
            if activity:
                session.message('system', activity[0], command.requestId, activity[1], kind='activity')
            steering = bool(session.designer and session.task and not session.task.done() and session.designer.active)
            if change:
                session.record_activity(change, command.requestId, steering=steering)
            if steering:
                session.designer.submit(command.requestId, text, background=True)
