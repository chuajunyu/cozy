"""Browser commands mutate local state before being forwarded to Astra."""

import asyncio
import re
from typing import Literal

from pydantic import Field

from backend.astra import AstraDesigner
from backend.design import DesignError, Model, Room, require
from backend.sessions import Session
from backend.architecture import explicit_permissions
from backend.concurrency import can_rebase


class Command(Model):
    type: Literal["chat.send", "feedback.send", "item.lock"]
    baseRevision: int | None = None
    requestId: str = Field(min_length=1, max_length=100)
    text: str = Field(default="", max_length=6000)
    action: Literal["comment", "like", "reroll", "reroll_unlocked"] = "comment"
    slotIds: list[str] = Field(default_factory=list, max_length=100)
    expectedProducts: dict[str, str] = Field(default_factory=dict)
    locked: bool = True
    budget: float | None = Field(default=None, gt=0, le=1_000_000)


def explicit_budget(text: str) -> float | None:
    amount = r"(?:S\$|SGD\s*|\$)?\s*([\d,]+(?:\.\d{1,2})?)"
    match = re.search(r"\b(?:room\s+|total\s+|overall\s+)?budget(?:\s+(?:of|is|to))?\s*" + amount, text, re.I)
    if match and re.search(r"\b(?:bed|chair|desk|sofa|rug|table|lamp)\s*$", text[:match.start()], re.I):
        return None
    if match is None:
        # A price mentioned in discussion is not a new spending limit.
        match = re.search(r"(?:\b(?:room|bedroom|design|everything|it)\s+(?:cost\s+)?|^)(?:under|below)\s*" + amount, text, re.I)
    if match:
        value = float(match[1].replace(",", ""))
        require(0 < value <= 1_000_000, "invalid_budget", "Enter a positive budget up to S$1,000,000.")
        return value
    return None


async def handle_command(session: Session, command: Command, designer_factory=AstraDesigner) -> None:
    async with session.command_lock:
        await _handle_command(session, command, designer_factory)


async def _handle_command(session: Session, command: Command, designer_factory) -> None:
    async with session.lock:
        if command.requestId in session.requests:
            session.publish(session.requests[command.requestId])
            return
        if command.baseRevision is not None:
            conversational = command.type == 'chat.send' or (command.type == 'feedback.send' and command.action in {'comment', 'like'})
            unchanged_targets = bool(command.slotIds) and all(can_rebase(session.revisions.get(command.baseRevision), session.state, id) for id in command.slotIds)
            require(command.baseRevision == session.state.revision or conversational or unchanged_targets,
                    "stale_revision", "This piece changed while you were editing. Review it and try again.")
        state = session.state.model_copy(deep=True)
        slots = list(dict.fromkeys(command.slotIds))
        if command.action == "reroll_unlocked" and command.type == "feedback.send":
            slots = [id for id, slot in state.slots.items() if slot.catalogId and not slot.locked and not slot.door]
        for id in slots:
            require(id in state.slots, "unknown_slot", "That furniture slot no longer exists.")
            if id in command.expectedProducts:
                require(state.slots[id].catalogId == command.expectedProducts[id], "item_changed",
                        "That recommendation has changed. Review the current piece and try again.")
        if command.type == "chat.send":
            require(bool(command.text.strip()), "empty_message", "Describe the room or change you want.")
            state.brief = command.text if not state.brief else state.brief
            budget = explicit_budget(command.text)
            if budget is None:
                budget = command.budget
            if budget is not None:
                state.budget = budget
            text = command.text
        elif command.type == "item.lock":
            require(bool(slots), "missing_target", "Select a placed item to lock or unlock.")
            for id in slots:
                require(state.slots[id].catalogId is not None, "pending_slot", "Wait for a recommendation before locking it.")
                state.slots[id].locked = command.locked
                if command.locked:
                    state.slots[id].replacing = False
                    # A lock explicitly keeps the current candidate even if previously rejected.
                    state.rejected[id] = [r for r in state.rejected.get(id, []) if r["catalogId"] != state.slots[id].catalogId]
                    if state.rerollTargets:
                        state.rerollTargets = [target for target in state.rerollTargets if target != id]
            text = ("Lock" if command.locked else "Unlock") + " exact products and positions: " + ", ".join(slots)
        else:
            if command.action == "like":
                require(bool(slots), "missing_target", "Select a piece to like.")
                for id in slots:
                    state.slots[id].liked = True
                text = "I like these choices (soft preference, not a lock): " + ", ".join(slots)
            elif command.action in {"reroll", "reroll_unlocked"}:
                require(all(not state.slots[id].door for id in slots), 'architecture_permission', 'Doors are room elements; request their edits explicitly in chat.')
                require(bool(slots), "missing_target", "Select an unlocked recommendation to replace.")
                for id in slots:
                    slot = state.slots[id]
                    require(not slot.locked, "locked", "Unlock the selected piece before replacing it.")
                    require(slot.catalogId is not None, "pending_slot", "Wait for this slot's first recommendation.")
                    state.rejected.setdefault(id, []).append({"catalogId": slot.catalogId, "reason": command.text or "Prefer a different option"})
                    slot.replacing = True
                state.rerollTargets = sorted(set((state.rerollTargets or []) + slots))
                text = "Replace these slots: " + ", ".join(slots) + ". Reason: " + (command.text or "Offer a meaningfully different option.")
            else:
                require(bool(command.text.strip()), "empty_message", "Add a comment or choose a replacement reason.")
                text = ("Regarding " + ", ".join(slots) + ": " if slots else "") + command.text
        state.feedback.append({"requestId": command.requestId, "type": command.type, "action": command.action,
                               "slotIds": slots, "products": {id: state.slots[id].catalogId for id in slots}, "text": text})
        state.feedback = state.feedback[-100:]
        state.revision += 1
        if command.type == "item.lock" or state.budget != session.state.budget:
            session.remember()
        session.state = state
        if command.type in {'chat.send', 'feedback.send'}:
            session.room_permissions.clear()
            grants = explicit_permissions(command.text, slots) if command.type == 'chat.send' or command.action == 'comment' else []
            if grants:
                session.room_permissions[command.requestId] = grants
        references = [{"slotId": id, "name": session.products.get(state.slots[id].catalogId, {}).get("name") or state.slots[id].label,
                       "category": "door" if state.slots[id].door else state.slots[id].category} for id in slots]
        display = command.text
        if command.type == 'item.lock':
            display = 'Keep these pieces in place.' if command.locked else 'Allow changes to these pieces.'
        elif command.type == 'feedback.send' and command.action == 'like':
            display = 'I like these choices.'
        elif command.type == 'feedback.send' and command.action in {'reroll', 'reroll_unlocked'}:
            display = 'Find alternatives.' + (' ' + command.text if command.text else '')
        session.message("user", display, command.requestId, references)
        session.broadcast_state()
        ack = {"type": "feedback.ack", "requestId": command.requestId, "stage": "received"}
        session.requests[command.requestId] = ack
        if len(session.requests) > 500:
            del session.requests[next(iter(session.requests))]
        session.publish(ack)
        # Quiet likes/locks after completion need no API call; future prompts include this state.
        should_run = command.type == "chat.send" or (command.type == "feedback.send" and command.action != "like") or (session.task is not None and not session.task.done() and session.designer.active)
        if should_run:
            if session.task is None or session.task.done():
                session.designer = designer_factory(session)
                session.task = asyncio.create_task(session.designer.run())
            session.designer.submit(command.requestId, text)
        else:
            session.publish({**ack, "stage": "applied"})
