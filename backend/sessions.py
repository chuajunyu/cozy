"""Single-worker, in-memory sessions; browser tokens are bearer capabilities."""

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from backend.design import DesignState, snapshot
from backend.catalog import BY_ID, CATALOG_SUMMARY


@dataclass
class Session:
    id: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    state: DesignState = field(default_factory=DesignState)
    custom_products: dict = field(default_factory=dict)
    history: list[DesignState] = field(default_factory=list)
    generation: int = 0
    command_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    messages: list[dict] = field(default_factory=list)
    tool_results: dict[str, dict] = field(default_factory=dict)
    requests: dict[str, dict] = field(default_factory=dict)
    status: str = "idle"
    activity: str = "Ready when you are"
    designer: Any = None
    task: asyncio.Task | None = None
    previous_response_id: str | None = None
    touched: float = field(default_factory=time.monotonic)

    @property
    def products(self) -> dict:
        return {**BY_ID, **self.custom_products}

    def snapshot(self) -> dict:
        return {**snapshot(self.state, self.products), "undoCount": len(self.history)}

    def remember(self) -> None:
        self.history = [*self.history[-29:], self.state.model_copy(deep=True)]

    def accept(self, state: DesignState) -> None:
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
        self.publish({"type": "design.updated", "state": self.snapshot()})

    def set_status(self, status: str, activity: str) -> None:
        self.status, self.activity = status, activity
        self.publish({"type": "agent.status", "status": status, "activity": activity})

    def message(self, role: str, text: str, id: str | None = None) -> str:
        id = id or secrets.token_hex(8)
        self.messages.append({"id": id, "role": role, "text": text})
        self.messages = self.messages[-50:]
        self.publish({"type": "chat.message", "message": self.messages[-1]})
        return id

    def delta(self, id: str, text: str) -> None:
        message = next((m for m in self.messages if m["id"] == id), None)
        if message is None:
            self.messages.append({"id": id, "role": "assistant", "text": ""})
            self.messages = self.messages[-50:]
            message = self.messages[-1]
        message["text"] += text
        self.publish({"type": "chat.delta", "id": id, "text": text})

    def envelope(self, reset: bool = False) -> dict:
        return {"type": "session.ready", "sessionId": self.id, "reset": reset,
                "state": self.snapshot(), "messages": self.messages,
                "status": self.status, "activity": self.activity, "catalog": list(self.products.values()), "catalogSummary": CATALOG_SUMMARY}


class SessionStore:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    def get(self, token: str | None) -> tuple[Session, bool]:
        now = time.monotonic()
        for key, session in list(self.sessions.items()):
            if not session.subscribers and now - session.touched > 3600:
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
        tasks = [s.task for s in self.sessions.values() if s.task and not s.task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.sessions.clear()
