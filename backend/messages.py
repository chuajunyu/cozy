"""Application message handling, independent of the WebSocket transport."""

import json
from typing import Any


def error_event(code: str, message: str) -> dict[str, str]:
    return {"type": "error", "code": code, "message": message}


def handle_message(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, RecursionError):
        return error_event("invalid_json", "Send a valid JSON object.")

    if not isinstance(payload, dict):
        return error_event("invalid_message", "The message must be a JSON object.")
    if payload.get("type") != "echo":
        return error_event("unsupported_type", "Supported message type: echo.")
    if not isinstance(payload.get("text"), str):
        return error_event("invalid_text", "Echo messages require a string text field.")
    return {"type": "echo", "text": payload["text"]}
