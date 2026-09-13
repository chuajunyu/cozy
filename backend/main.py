"""Run a single worker: python -m uvicorn backend.main:app --reload."""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.astra import AstraDesigner
from backend.catalog import CATALOG
from backend.design import DesignError
from backend.messages import error_event, handle_message
from backend.protocol import Command, handle_command
from backend.sessions import SessionStore
from backend.static import mount_frontend

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
    return {"products": CATALOG}


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
            if len(raw) > 32_000:
                queue.put_nowait(error_event("message_too_large", "Keep messages under 32 KB."))
                continue
            try:
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    raise ValueError()
                kind = payload.get("type")
                if kind == "session.init":
                    if session is not None:
                        queue.put_nowait(error_event("already_initialized", "This socket already has a session."))
                        continue
                    token = payload.get("sessionId")
                    if token is not None and (not isinstance(token, str) or len(token) > 100):
                        raise ValueError()
                    session, reset = app.state.sessions.get(token)
                    queue.put_nowait({**session.envelope(reset), "catalog": CATALOG})
                    session.subscribers.add(queue)
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
                queue.put_nowait(error_event("invalid_message", "Check the command fields and try again."))
            except (ValueError, RecursionError):
                queue.put_nowait(handle_message(raw))
    except WebSocketDisconnect:
        pass
    finally:
        if session:
            session.subscribers.discard(queue)
        sender.cancel()
        await asyncio.gather(sender, return_exceptions=True)


# Keep this last so /health, /catalog and /ws take precedence over static files.
mount_frontend(app, Path(__file__).resolve().parents[1] / "frontend" / "dist")
