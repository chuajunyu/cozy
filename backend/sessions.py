"""Single-worker, in-memory sessions; browser tokens are bearer capabilities."""

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.design import DesignState, snapshot
from backend.catalog import BY_ID, CATALOG_SUMMARY
from backend.studio_activity import merge_activity


class SavedReference(BaseModel):
    slotId: str = Field(max_length=100)
    name: str = Field(max_length=300)
    category: str = Field(max_length=100)


class SavedMessage(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    role: Literal['user', 'assistant']
    text: str = Field(max_length=6000)
    references: list[SavedReference] = Field(default_factory=list, max_length=50)


class ConversationRecovery(BaseModel):
    messages: list[SavedMessage] = Field(default_factory=list, max_length=50)

    def history(self) -> list[dict]:
        # Restored conversation is context only; it never replays room commands.
        unique = {m.id: m.model_dump(exclude_defaults=True) for m in self.messages}
        return list(unique.values())


@dataclass
class Session:
    id: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    state: DesignState = field(default_factory=DesignState)
    custom_products: dict = field(default_factory=dict)
    history: list[DesignState] = field(default_factory=list)
    revisions: dict[int, DesignState] = field(default_factory=dict)
    generation: int = 0
    room_permissions: dict = field(default_factory=dict)
    variants: dict | None = None
    variant_tasks: dict = field(default_factory=dict)
    variant_semaphore: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(3))
    variant_source: Any = None
    variant_grants: list = field(default_factory=list)
    design_instructions: str = ''
    planning: bool = False
    restore_previews: dict = field(default_factory=dict)
    command_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    messages: list[dict] = field(default_factory=list)
    tool_results: dict[str, dict] = field(default_factory=dict)
    requests: dict[str, dict] = field(default_factory=dict)
    status: str = "idle"
    activity: str = "Ready when you are"
    activity_burst: str | None = None
    activity_touched: float = 0
    voice_active: bool = False
    designer: Any = None
    task: asyncio.Task | None = None
    previous_response_id: str | None = None
    touched: float = field(default_factory=time.monotonic)

    @property
    def products(self) -> dict:
        return {**BY_ID, **self.custom_products}

    def snapshot(self) -> dict:
        self.revisions[self.state.revision] = self.state.model_copy(deep=True)
        while len(self.revisions) > 50:
            del self.revisions[next(iter(self.revisions))]
        return {**snapshot(self.state, self.products), "undoCount": len(self.history)}

    def remember(self) -> None:
        self.history = [*self.history[-29:], self.state.model_copy(deep=True)]

    def accept(self, state: DesignState) -> None:
        if self.variant_source is not None:
            from backend.variants import protected
            protected(self.variant_source, state, self.variant_grants, self.products)
        self.remember()
        self.state = state

    def publish(self, event: dict) -> None:
        self.touched = time.monotonic()
        for queue in tuple(self.subscribers):
            # A slow/disconnected browser resynchronizes from a fresh snapshot.
            if queue.full():
                self.subscribers.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({"type": "connection.resync"})
            else:
                queue.put_nowait(event)

    def broadcast_state(self) -> None:
        from backend.variants import invalidate
        invalidate(self)
        self.publish({"type": "design.updated", "state": self.snapshot()})

    def set_status(self, status: str, activity: str) -> None:
        self.status, self.activity = status, activity
        self.publish({"type": "agent.status", "status": status, "activity": activity})

    def close_activity(self) -> None:
        self.activity_burst = None

    def record_activity(self, change: dict, request_id: str, *, steering: bool, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        previous = next((m for m in self.messages if m['id'] == self.activity_burst), None)
        if previous and (now - self.activity_touched >= 5 or
                         (len(previous['activity']['changes']) >= 50 and
                          all(c['key'] != change['key'] for c in previous['activity']['changes']))):
            previous = None
        changes = merge_activity(previous['activity']['changes'] if previous else [], change)
        references = [c['reference'] for c in changes if c['reference']]
        text = ('You ' + changes[0]['label'][0].lower() + changes[0]['label'][1:] if len(changes) == 1
                else f"Updated {len(references)} pieces" if len(references) == len(changes)
                else 'Updated your room')
        metadata = {'changes': changes, 'editCount': (previous['activity']['editCount'] if previous else 0) + 1,
                    'latestRequestId': request_id, 'steering': steering}
        self.activity_burst = self.message('system', text, previous['id'] if previous else request_id,
                                           references, kind='activity', activity=metadata)
        self.activity_touched = now

    def message(self, role: str, text: str, id: str | None = None, references: list[dict] | None = None, *, kind: str | None = None, activity: dict | None = None) -> str:
        id = id or secrets.token_hex(8)
        message = {"id": id, "role": role, "text": text, **({"references": references} if references else {}), **({"kind": kind} if kind else {}), **({'activity': activity} if activity else {})}
        existing = next((i for i, item in enumerate(self.messages) if item["id"] == id), None)
        if existing is None:
            if role in {'user', 'assistant'}:
                self.close_activity()
            self.messages.append(message)
        else:
            self.messages[existing] = message
        self.messages = self.messages[-50:]
        self.publish({"type": "chat.message", "message": message})
        return id

    def delta(self, id: str, text: str, *, internal: bool = False) -> None:
        message = next((m for m in self.messages if m["id"] == id), None)
        if message is None:
            self.close_activity()
            self.messages.append({"id": id, "role": "assistant", "text": "", **({"internal": True} if internal else {})})
            self.messages = self.messages[-50:]
            message = self.messages[-1]
        message["text"] += text
        self.publish({"type": "chat.delta", "id": id, "text": text, **({"internal": True} if internal else {})})

    def envelope(self, reset: bool = False) -> dict:
        return {"type": "session.ready", "sessionId": self.id, "reset": reset,
                "variants": self.variants, "state": self.snapshot(), "messages": [m for m in self.messages if not m.get("internal")],
                "status": self.status, "activity": self.activity, "catalog": list(self.products.values()), "catalogSummary": CATALOG_SUMMARY}


class SessionStore:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    def get(self, token: str | None) -> tuple[Session, bool]:
        now = time.monotonic()
        for key, session in list(self.sessions.items()):
            if not session.subscribers and now - session.touched > 3600:
                for task in session.variant_tasks.values():
                    task.cancel()
                if session.task:
                    session.task.cancel()
                del self.sessions[key]
        if token and token in self.sessions:
            session = self.sessions[token]
            session.touched = now
            return session, False
        session = Session()
        self.sessions[session.id] = session
        return session, bool(token)

    async def close(self) -> None:
        variants = [task for s in self.sessions.values() for task in s.variant_tasks.values()]
        for task in variants:
            task.cancel()
        await asyncio.gather(*variants, return_exceptions=True)
        tasks = [s.task for s in self.sessions.values() if s.task and not s.task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.sessions.clear()
