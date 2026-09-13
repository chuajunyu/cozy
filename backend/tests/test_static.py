from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from backend.static import mount_frontend


def test_production_frontend_preserves_api_and_websocket_routes(tmp_path: Path):
    directory = tmp_path / "dist"
    directory.mkdir()
    (directory / "index.html").write_text("<html>Cozy studio</html>")
    (directory / "assets").mkdir()
    (directory / "assets" / "app.js").write_text("console.log('Cozy')")
    (tmp_path / "private.txt").write_text("must not be served")
    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.websocket("/ws")
    async def websocket(socket: WebSocket):
        await socket.accept()
        for _ in range(2):
            await socket.send_text(await socket.receive_text())

    mount_frontend(app, directory)
    with TestClient(app) as client:
        assert "Cozy studio" in client.get("/").text
        script = client.get("/assets/app.js")
        assert script.status_code == 200
        assert "javascript" in script.headers["content-type"]
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/assets/missing.js").status_code == 404
        assert client.get("/%2e%2e/private.txt").status_code == 404
        with client.websocket_connect("/ws") as socket:
            for text in ["first", "second"]:
                socket.send_text(text)
                assert socket.receive_text() == text


def test_development_does_not_require_frontend_build(tmp_path: Path):
    app = FastAPI()
    mount_frontend(app, tmp_path / "missing")
    with TestClient(app) as client:
        assert client.get("/").status_code == 404
