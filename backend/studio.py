"""Manual studio transactions share the agent's authoritative state."""

import asyncio
from typing import Literal

from pydantic import Field

from backend.design import DesignState, LightSettings, Model, Room, Slot, require, validate_layout
from backend.products import GeneratedProduct, generated
from backend.sessions import Session


class Backup(Model):
    version: Literal[2]
    state: DesignState
    products: list[GeneratedProduct] = Field(default_factory=list, max_length=100)


class StudioCommand(Model):
    type: Literal["item.add", "item.update", "item.delete", "room.update", "fixture.update",
                  "room.clear", "room.undo", "catalog.import", "session.restore"]
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
    room: Room | None = None
    budget: float | None = Field(default=None, gt=0, le=1_000_000)
    product: GeneratedProduct | None = None
    backup: Backup | None = None


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
    session.set_status("idle", "Design paused; your room is preserved")


async def handle_studio(session: Session, command: StudioCommand) -> None:
    # All browser commands use this mutex; model commits still use session.lock.
    async with session.command_lock:
        async with session.lock:
            if command.requestId in session.requests:
                session.publish(session.requests[command.requestId])
                return
            require(command.baseRevision == session.state.revision, "stale_revision", "The room changed. Review it and try again.")
            if command.type == "room.undo":
                require(bool(session.history), "empty_history", "There is no room change to undo.")
            if command.type == "room.clear":
                require(not any(s.locked for s in session.state.slots.values()), "locked", "Unlock pieces before clearing the room.")
            if command.type == "session.restore":
                require(session.state.revision == 0 and not session.state.slots, "restore_conflict", "A live room cannot be replaced by a backup.")
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
            if kind in {"item.update", "item.delete", "fixture.update"}:
                require(slot is not None and slot.catalogId is not None, "unknown_slot", "Select a placed item.")
                require(command.expectedProduct == slot.catalogId, "item_changed", "The selected product changed.")
                if kind != "fixture.update":
                    require(not slot.locked, "locked", "Unlock the piece before changing its placement.")
            if kind == "item.add":
                require(command.slotId is not None and command.slotId not in state.slots, "duplicate_slot", "Use a new item ID.")
                p = products.get(command.catalogId)
                require(p is not None, "unknown_product", "Choose a catalog product.")
                require(command.x is not None and command.z is not None, "missing_position", "Supply a position.")
                state.slots[command.slotId] = Slot(id=command.slotId, label=p["name"][:80], category=p["category"],
                    zone="Room", group="Your additions", catalogId=p["id"], x=command.x, z=command.z,
                    rotation=command.rotation or 0, elevation=command.elevation or 0, light=command.light,
                    explanation="Added by you.")
            elif kind == "item.update":
                for field in ("x", "z", "rotation", "elevation"):
                    value = getattr(command, field)
                    if value is not None:
                        setattr(slot, field, value)
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
            validate_layout(state, products)
            if kind == "room.undo":
                session.history.pop()
            elif kind == "session.restore":
                session.history.clear()
            elif kind != "catalog.import":
                session.remember()
            state.revision = session.state.revision + 1
            text = f"Manual change: {kind}; item {command.slotId or 'room'}. Use the latest room and preserve this intent."
            if kind not in {"catalog.import", "session.restore", "room.undo"}:
                state.feedback.append({"text": text, "slotIds": [command.slotId] if command.slotId else []})
                state.feedback = state.feedback[-100:]
            session.state = state
            session.custom_products = custom
            if kind in {"catalog.import", "session.restore"}:
                session.publish({"type": "catalog.updated", "catalog": list(session.products.values())})
            session.broadcast_state()
            ack = {"type": "command.ack", "requestId": command.requestId, "revision": state.revision}
            session.requests[command.requestId] = ack
            if len(session.requests) > 500:
                del session.requests[next(iter(session.requests))]
            session.publish(ack)
            if session.designer and session.task and not session.task.done() and session.designer.active:
                session.designer.submit(command.requestId, text)
