# Repository guidance

## Project and layout

Cozy is a collaborative interior design room studio with a React/TypeScript frontend
and a Python FastAPI backend. Read `README.md` for setup and interface details.

- `frontend/src/App.tsx`: application UI and room controls.
- `frontend/src/Room.tsx`: Three.js scene using React Three Fiber and Drei.
- `frontend/src/useConnection.ts`: WebSocket lifecycle and connection log.
- `frontend/src/PanelHost.tsx`: contextual panels and mobile sheets.
- `frontend/src/RoomCustomization.tsx`: wall and floor finishes and wall-lamp controls.
- `frontend/src/styles.css`: application styling.
- `frontend/vite.config.ts`: development server and backend proxies.
- `backend/main.py`: HTTP and WebSocket transport.
- `backend/protocol.py` and `backend/studio.py`: designer and manual room commands.
- `backend/sessions.py`: authoritative room state, revisions and undo history.
- `backend/placement.py`: shared placement validation and support settling.
- `backend/tests/test_api.py`: backend API and WebSocket tests.

## Working conventions

- Keep changes focused on the requested task and preserve unrelated local edits.
- Follow existing code style: strict TypeScript, functional React components and
  hooks, two-space indentation and single quotes in frontend code; four-space
  indentation and type annotations in Python.
- Keep application message handling separate from FastAPI transport code.
- Update both backend handling and frontend event parsing when changing the
  WebSocket protocol. Keep invalid-input errors recoverable on the same socket.
- Derive browser WebSocket URLs from the current page host, including `wss` on
  HTTPS. Development requests use Vite's `/health`, `/catalog` and `/ws` proxies.
- Use meters in the room scene with the floor surface at `y = 0`. Preserve
  on-demand rendering and current rendering budgets unless the task requires
  changing them: maximum DPR 1.5 and one 1024 x 1024 directional shadow map.
- Clean up connection handlers and sockets when effects are disposed. Keep the
  connection log bounded (currently the latest 50 entries).
- Keep React and React DOM compatible with React Three Fiber. The current
  project uses React 19.2 and Fiber 9; check compatibility before upgrading.
- Use npm and keep `frontend/package-lock.json` in sync with dependency changes.
  Do not commit dependencies, virtual environments, build output, or secrets.
- Update `README.md` when setup, commands, interfaces, or user behavior changes.
- Preserve automatic saved-room recovery and the explicit Reset room action. Keep
  routine session recovery quiet and expose controls in their relevant task panel.
- Keep the room canvas mounted when panels switch; do not restore the furniture lab.
- Validate room finishes and wall anchors on both client and server. Preserve them
  through backups, restore and undo; older saves must retain sensible defaults.
- Keep OPENAI_API_KEY on the backend in an ignored environment file or process
  environment. Manual editing must work without an API key.

## Local commands

Requires Node.js 22.12+ and Python 3.11+. Run these PowerShell commands from the
repository root. Use the repository virtual environment for Python commands.

Install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
npm.cmd --prefix frontend ci
.\.venv\Scripts\python.exe -m scripts.prepare_assets
```

Run the backend and frontend in separate terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
npm.cmd --prefix frontend run dev
```

The frontend runs at `http://localhost:5173` with a fixed port. On macOS/Linux,
use `.venv/bin/python` and `npm` instead of the Windows executables.
For concurrent worktrees, set `COZY_BACKEND_URL` to their backend URL and pass
`-- --port <port>` to the frontend dev command. Restart the backend after asset
preparation so the collection reflects locally available models.

## Verification

Run checks relevant to the changed code:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests scripts/tests -q
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
```

The build already includes type checking. Frontend regression tests run through
Node's test runner; no lint script is configured. Add meaningful regression
coverage for changed behavior; documentation-only changes do
not require running the application suite.

For scene, UI, or connection changes, check the affected browser behavior:

- Room geometry and shadows render; orbit, zoom, and the light slider work.
- Manual edits and contextual object references reach the shared room.
- Restarting the backend reconnects and restores the saved room automatically.
- Wall and floor colors persist after reload, and panel switches preserve the floor.
- Wall lamps remain attached to their selected wall and expose placement controls
  only when selected.
- The layout remains usable at desktop and mobile widths.

Use the development server for integrated browser checks. `npm run preview`
serves the production frontend files only and does not supply the backend proxy.
Report what was verified and any checks that could not be run.
