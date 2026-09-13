"""Run a single worker: python -m uvicorn backend.main:app --reload."""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.astra import AstraDesigner
from backend.catalog import CATALOG, CATALOG_SUMMARY
from backend.design import DesignError
from backend.messages import error_event, handle_message
from backend.protocol import Command, handle_command
from backend.sessions import ConversationRecovery, SessionStore
from backend.studio import StudioCommand, handle_studio
from backend.voice import voice_endpoint

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local", override=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.sessions = SessionStore()
    app.state.designer_factory = AstraDesigner
    yield
    await app.state.sessions.close()


app = FastAPI(title="Cozy", version="0.2.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/catalog")
async def catalog() -> dict:
    return {"products": CATALOG, **CATALOG_SUMMARY}


app.websocket("/ws/voice")(voice_endpoint)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=1024)
    session = None

    async def writer() -> None:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
            if event["type"] == "connection.resync":
                await websocket.close(code=1013)
                return

    sender = asyncio.create_task(writer())
    try:
        while True:
            event = await websocket.receive()
            if event["type"] == "websocket.disconnect":
                break
            raw = event.get("text")
            if raw is None:
                queue.put_nowait(error_event("unsupported_frame", "Send JSON in a text frame."))
                continue
            if len(raw.encode("utf-8")) > 2_000_000:
                queue.put_nowait(error_event("message_too_large", "Keep restore messages under 2 MB."))
                continue
            try:
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    raise ValueError()
                kind = payload.get("type")
                limit = 2_000_000 if kind in {"session.init", "session.restore", "session.restore.preview"} else 510_000 if kind == "catalog.import" else 32_000
                if len(raw.encode("utf-8")) > limit:
                    queue.put_nowait(error_event("message_too_large", "This command exceeds its message size limit."))
                    continue
                if kind == "session.init":
                    if session is not None:
                        queue.put_nowait(error_event("already_initialized", "This socket already has a session."))
                        continue
                    token = payload.get("sessionId")
                    if token is not None and (not isinstance(token, str) or len(token) > 100):
                        raise ValueError()
                    recovery = ConversationRecovery.model_validate({'messages': payload.get('messages', [])})
                    session, reset = app.state.sessions.get(token)
                    if reset:
                        session.messages = recovery.history()
                    queue.put_nowait(session.envelope(reset))
                    session.subscribers.add(queue)
                elif kind in {"session.restore.preview", "item.replace", "item.add", "item.update", "item.delete", "room.update", "fixture.update", "room.clear", "room.undo", "catalog.import", "session.restore"}:
                    if session is None:
                        queue.put_nowait(error_event("session_required", "Initialize a session first."))
                        continue
                    await handle_studio(session, StudioCommand.model_validate(payload))
                elif kind in {"chat.send", "feedback.send", "item.lock"}:
                    if session is None:
                        queue.put_nowait(error_event("session_required", "Initialize a session first."))
                        continue
                    await handle_command(session, Command.model_validate(payload), app.state.designer_factory)
                else:
                    queue.put_nowait(handle_message(raw))
            except DesignError as exc:
                queue.put_nowait({**error_event(exc.code, str(exc)), "requestId": payload.get("requestId")})
            except ValidationError:
                queue.put_nowait({**error_event("invalid_message", "Check the command fields and try again."), "requestId": payload.get("requestId")})
            except (ValueError, RecursionError):
                queue.put_nowait(handle_message(raw))
    except WebSocketDisconnect:
        pass
    finally:
        if session:
            session.subscribers.discard(queue)
        sender.cancel()
        await asyncio.gather(sender, return_exceptions=True)
