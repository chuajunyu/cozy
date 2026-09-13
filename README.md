# Cozy

A minimal room studio: React 19, TypeScript, Vite, Three.js, React Three Fiber 9,
Drei, and a Python FastAPI backend. A lit sample room and WebSocket echo panel
provide a working foundation for an interior design app.

## Requirements

- Node.js 22.12+ (Node 22 or 24 LTS recommended) and npm.
- Python 3.11+.
- Two terminals, both starting at the repository root.

React is kept on 19.2 because the installed React Three Fiber 9 release requires
React below 19.3. The npm lockfile records the resolved frontend dependencies.

## Install

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
cd frontend
npm ci
```

macOS / Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
cd frontend
npm ci
```

For runtime-only Python dependencies, install `backend/requirements.txt` instead.
The virtual environment is local to this repository; activation is optional when
using its Python executable directly. On PowerShell installations that block
`npm.ps1`, use `npm.cmd` for the npm commands.

## Develop

Terminal 1, from the repository root on Windows:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

On macOS / Linux, replace `.\.venv\Scripts\python.exe` with `.venv/bin/python`.

Terminal 2:

```sh
cd frontend
npm run dev
```

Open <http://localhost:5173>. Drag the room to orbit, scroll to zoom, and move
the light slider to change the shadows. Send a message in the connection panel
to see it echoed by the backend. If the backend stops, the panel shows its
disconnected state; restart the backend and press **Reconnect**.

Vite uses port 5173 without silently choosing another port. It proxies `/health`
and `/ws` to FastAPI on port 8000. The browser derives its WebSocket URL from
the current page's host (`ws` for HTTP and `wss` for HTTPS), avoiding separate
browser API URL configuration and development CORS setup.

## Interfaces

- `GET /health` returns `{"status":"ok"}`.
- `/ws` accepts persistent native WebSocket connections with JSON text frames.
- Send `{"type":"echo","text":"hello"}` and receive the same event.
- Invalid input receives `{"type":"error","code":"invalid_json","message":"..."}`
  (or `invalid_message`, `unsupported_type`, `invalid_text`, `unsupported_frame`).
  The socket stays open for subsequent valid messages.

`backend/messages.py` contains application message handling; `backend/main.py`
owns HTTP and WebSocket transport. Add future message types in the handler and
frontend event receiver. There is no AI connection or API key requirement.

The room uses meters, with the floor surface at y=0. It renders only on demand,
caps device pixel ratio at 1.5, and uses one 1024×1024 directional shadow map.
The light slider demonstrates rendering, not geographic sunlight simulation.

## Verify

From the repository root on Windows:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm run typecheck
npm run build
```

Backend tests cover health, repeated messages, invalid input followed by valid
input, binary frames, and disconnect/reconnect. For browser checks:

1. Confirm the floor, two walls, furniture box, and shadows render.
2. Orbit and zoom; move the light slider and confirm shadows change.
3. Send several messages and check each backend echo.
4. Stop FastAPI, confirm the disconnected status, restart it, and reconnect.
5. Check the layout at desktop and mobile widths.

The production build is emitted to `frontend/dist`. `npm run preview` previews
those static files only; use the development server for the proxied backend
connection. Production serving and deployment are intentionally deferred.

## Boundaries

Scaffold only: no furniture editing, model downloads, AI, sunlight calculations,
persistence, authentication, or deployment configuration. The frontend retains
only the latest 50 connection log entries in memory. Fonts use Google Fonts
when available and fall back to system sans-serif fonts offline.

