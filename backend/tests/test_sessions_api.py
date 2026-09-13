from fastapi.testclient import TestClient

from backend.main import app
from backend.tests.test_design import furnished


def until(socket, kind):
    for _ in range(30):
        event = socket.receive_json()
        if event["type"] == kind:
            return event
    raise AssertionError(f"No {kind} event")


def test_reconnect_resync_lock_and_cross_session_isolation():
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as first:
            first.send_json({"type": "session.init"})
            ready = first.receive_json()
            token = ready["sessionId"]
            assert ready["catalog"] and ready["state"]["slots"] == {}
            app.state.sessions.sessions[token].state = furnished()
            first.send_json({"type": "item.lock", "requestId": "lock", "slotIds": ["sofa"], "expectedProducts": {"sofa": "sofa-sage"}, "locked": True})
            assert until(first, "design.updated")["state"]["slots"]["sofa"]["locked"]
            with client.websocket_connect("/ws") as second:
                second.send_json({"type": "session.init"})
                other = second.receive_json()
                assert other["sessionId"] != token and other["state"]["slots"] == {}
        with client.websocket_connect("/ws") as resumed:
            resumed.send_json({"type": "session.init", "sessionId": token})
            restored = resumed.receive_json()
            assert restored["sessionId"] == token and not restored["reset"]
            assert restored["state"]["slots"]["sofa"]["locked"]


def test_rejected_command_does_not_disconnect_or_mutate():
    with TestClient(app) as client, client.websocket_connect("/ws") as socket:
        socket.send_json({"type": "session.init"})
        token = socket.receive_json()["sessionId"]
        app.state.sessions.sessions[token].state = furnished()
        socket.send_json({"type": "item.lock", "requestId": "stale", "slotIds": ["sofa"], "expectedProducts": {"sofa": "sofa-terra"}})
        assert socket.receive_json()["code"] == "item_changed"
        assert not app.state.sessions.sessions[token].state.slots["sofa"].locked
        socket.send_json({"type": "echo", "text": "still connected"})
        assert socket.receive_json()["text"] == "still connected"
