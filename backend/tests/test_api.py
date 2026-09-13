import pytest
from fastapi.testclient import TestClient

from backend.main import app


def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_multiple_messages_on_one_connection():
    with TestClient(app) as client, client.websocket_connect("/ws") as socket:
        for text in ["hello", "second message", "", "Hello 🌱"]:
            payload = {"type": "echo", "text": text}
            socket.send_json(payload)
            assert socket.receive_json() == payload


@pytest.mark.parametrize("raw,code", [
    ("not json", "invalid_json"),
    ("[]", "invalid_message"),
    ('{"type":"unknown"}', "unsupported_type"),
    ('{"type":"echo","text":42}', "invalid_text"),
])
def test_invalid_message_does_not_close_socket(raw, code):
    with TestClient(app) as client, client.websocket_connect("/ws") as socket:
        socket.send_text(raw)
        error = socket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == code
        assert isinstance(error["message"], str)
        socket.send_json({"type": "echo", "text": "still connected"})
        assert socket.receive_json() == {"type": "echo", "text": "still connected"}


def test_binary_frame_and_reconnect():
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as socket:
            socket.send_bytes(b"binary")
            assert socket.receive_json()["code"] == "unsupported_frame"
            socket.send_json({"type": "echo", "text": "after binary"})
            assert socket.receive_json()["text"] == "after binary"
        with client.websocket_connect("/ws") as socket:
            socket.send_json({"type": "echo", "text": "reconnected"})
            assert socket.receive_json()["text"] == "reconnected"
