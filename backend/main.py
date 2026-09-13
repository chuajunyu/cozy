"""Run from the repository root: python -m uvicorn backend.main:app --reload."""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from backend.messages import error_event, handle_message

app = FastAPI(title="Cozy", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            event = await websocket.receive()
            if event["type"] == "websocket.disconnect":
                break
            raw = event.get("text")
            response = (
                handle_message(raw)
                if raw is not None
                else error_event("unsupported_frame", "Send JSON in a text frame.")
            )
            await websocket.send_json(response)
    except WebSocketDisconnect:
        pass
