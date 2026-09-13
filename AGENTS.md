# Repository guidance

## Project and layout

Cozy is a minimal interior design room studio with a React/TypeScript frontend
and a Python FastAPI backend. Read `README.md` for setup and interface details.

- `frontend/src/App.tsx`: application UI and room controls.
- `frontend/src/Room.tsx`: Three.js scene using React Three Fiber and Drei.
- `frontend/src/useConnection.ts`: WebSocket lifecycle and connection log.
- `frontend/src/styles.css`: application styling.
- `frontend/vite.config.ts`: development server and backend proxies.
- `backend/main.py`: HTTP and WebSocket transport.
- `backend/messages.py`: application message validation and handling.
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
  HTTPS. Development requests use Vite's `/health` and `/ws` proxies.
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
- The current app is a scaffold. Add persistence, authentication, AI integrations,
  asset downloads, or deployment configuration only when the task calls for them.

## Local commands

Requires Node.js 22.12+ and Python 3.11+. Run these PowerShell commands from the
repository root. Use the repository virtual environment for Python commands.

Install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
npm.cmd --prefix frontend ci
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

## Verification

Run checks relevant to the changed code:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build
```

The build already includes type checking; a successful build covers both frontend
commands. There is currently no frontend test or lint script. Add meaningful
backend regression coverage for changed behavior; documentation-only changes do
not require running the application suite.

For scene, UI, or connection changes, check the affected browser behavior:

- Room geometry and shadows render; orbit, zoom, and the light slider work.
- Multiple messages echo successfully.
- Stopping the backend shows disconnection; restarting it and using Reconnect
  restores messaging.
- The layout remains usable at desktop and mobile widths.

Use the development server for integrated browser checks. `npm run preview`
serves the production frontend files only and does not supply the backend proxy.
Report what was verified and any checks that could not be run.
