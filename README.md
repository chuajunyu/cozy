# Cozy

A collaborative interior design studio: React 19, TypeScript, Vite, Three.js,
React Three Fiber 9, Drei, and Python FastAPI. GPT-6 Astra develops a cohesive
concept, places coordinated groups, and adapts to feedback while it works.

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

Set `OPENAI_API_KEY` in the backend environment or in a root `.env.local` file
(see `.env.example`). `.env.local` is Git-ignored and loaded only by FastAPI.
Never put the key in frontend files or a `VITE_` variable. The configured key
must have access to `gpt-6-astra`. Live design requests incur OpenAI API usage.

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

Open <http://localhost:5173>. Set an optional SGD budget and describe your room.
Astra explains a whole-room concept, then places anchor and supporting groups.
Select furniture in the canvas or on the concept board. Like, lock/unlock,
replace with an optional reason, reroll selected/all unlocked pieces, or comment
on a group. Chat stays open while Astra works. Drag to orbit, scroll to zoom,
and move the lighting slider to explore shadows.

Vite uses port 5173 without silently choosing another port. It proxies `/health`,
`/catalog`, and `/ws` to FastAPI on port 8000. The browser derives its WebSocket URL from
the current page's host (`ws` for HTTP and `wss` for HTTPS), avoiding separate
browser API URL configuration and development CORS setup.

## Interfaces

- `GET /health` returns `{"status":"ok"}`.
- `GET /catalog` returns curated product metadata.
- `/ws` accepts persistent native WebSocket connections with JSON text frames.
- Initialize with `{"type":"session.init","sessionId":null}` or the saved ID.
- `session.ready` returns the session ID, scene, catalog, chat and agent status.
- Commands: `chat.send`, `feedback.send`, and `item.lock`; each requires a unique
  `requestId`. Feedback actions are `comment`, `like`, `reroll`, `reroll_unlocked`.
- Item/group commands use `slotIds`; `expectedProducts` guards against acting on
  a recommendation that changed since the user saw it. `item.lock` includes a
  boolean `locked`; `chat.send` can include a positive numeric SGD `budget`.
- Server events: `design.updated` (full accepted snapshot), `chat.message`,
  `chat.delta`, `agent.status`, `feedback.ack`, `design.group`, `design.completed`.
- Feedback stages distinguish local receipt, upstream submission, queued
  steering, and incorporation into a model continuation.
- The original `echo` event remains supported as a basic connection check.
- Invalid input receives `{"type":"error","code":"invalid_json","message":"..."}`
  (or `invalid_message`, `unsupported_type`, `invalid_text`, `unsupported_frame`).
  The socket stays open for subsequent valid messages.

`backend/main.py` owns transport, `protocol.py` validates browser commands,
`sessions.py` owns per-session memory, `design.py` validates atomic scene edits,
`design_tools.py` exposes model tools, and `astra.py` manages the Responses
WebSocket lifecycle. API credentials and raw upstream protocol objects stay on the backend.

The browser receives user-facing explanations and validated design state, not
private reasoning. Catalog products have illustrative SGD prices and procedural
model IDs; these are not real product listings or shopping recommendations.

## Session and consistency rules

Run **one FastAPI worker**. A random session token is stored in browser
`sessionStorage`; all accepted scene state, locks, rejection history, feedback,
recent conversation, and tool-call results live in backend memory. Tokens are
bearer capabilities for this local prototype, not an account/authentication system.

Disconnecting preserves the session and any active design. Reconnect restores
the authoritative snapshot. A backend restart (including `--reload` after an
edit) resets sessions; the UI reports this explicitly. Disconnected sessions
inactive for an hour are discarded when another session initializes. The store
keeps the most recent 50 chat messages, 100 feedback entries, and 500 deduplication
records per session. No database or local scene persistence is included.

Locks preserve product, position, and rotation. Likes are soft preferences.
Stable slots retain rejected candidate IDs and reasons across replacements.
Targeted rerolls preserve unrelated products; small positional adjustments of
up to 0.5 m per axis are permitted for unlocked surrounding pieces. Selecting
"Reroll unlocked" explicitly requests alternatives for every placed unlocked slot.
Existing pieces remain visible until the replacement group passes validation.

Model tools use a base revision. Every user constraint update and accepted edit
advances it; stale proposals are rejected with current state. Groups commit all
at once after ID, category, bounds, collision, lock, rejection, and budget checks.
Rugs may overlap solid furniture; two rugs may not overlap each other. An explicit
lower budget may temporarily invalidate the visible old arrangement, which is
flagged while Astra finds a valid replacement. A completed room cannot exceed budget.

The upstream adapter uses one event reader and a concurrent input task. Only
completed tool calls execute. Results are cached by call ID; steering continuations
reuse results without replaying accepted steering or applying edits twice.
The implementation handles `response.steer.accepted`, `response.steer.pending`,
`response.steer.failed`, and steered `response.incomplete` responses. On an API
failure the room stays visible; a new prompt retries using the saved local context.

The room uses meters, centered on x=0/z=0, with the floor surface at y=0.
Positive z points toward the initial camera. Dimensions are 4×3.5×2.6 m and
rotations are 0/90/180/270 degrees. It renders only on demand,
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

Backend tests run without live API calls. They cover session isolation and
reconnect, atomic group validation, immutable locks, targeted scope, rejected
candidates, budgets, revisions, duplicate commands/tool calls, and simulated
steering continuations. For browser checks:

1. Generate a room and confirm coordinated groups appear before final completion.
2. Orbit and zoom; move the light slider and confirm shadows change.
3. Lock an anchor during generation, comment, and replace an unlocked piece.
4. Refresh and confirm recovery; restart FastAPI and confirm the reset notice.
5. Check the layout at desktop and mobile widths.

Optional live smoke test (uses the configured API key and incurs API usage):

```powershell
.\.venv\Scripts\python.exe -m backend.tests.live_smoke
```

It requests a bedroom, locks an anchor during generation, and checks the final
room preserves it. Run this separately from the deterministic test suite.

The production build is emitted to `frontend/dist`. `npm run preview` previews
those static files only; use the development server for the proxied backend
connection. When a build exists, FastAPI also serves it at `/`, after the API
and WebSocket routes. Restart FastAPI after creating the first build.

## Deploy to Render

The root `Dockerfile` builds React with Node 22, then runs FastAPI and the built
frontend together in a Python 3.11 container as a non-root user. One public URL
serves the page, `/health`, `/catalog`, and `/ws`. No frontend backend-URL variable
or separate frontend hosting is needed. Render terminates HTTPS, and the browser
automatically uses `wss` on both the Render URL and a custom domain.

1. Commit the current application and deployment files on `codex/render-deploy`,
   then push that branch to your GitHub repository:

   ```sh
   git push -u origin codex/render-deploy
   ```

2. In the [Render dashboard](https://dashboard.render.com/), choose **New >
   Blueprint**, connect the repository, and select `codex/render-deploy` as the
   Blueprint branch. Render reads the root `render.yaml`.
3. Review the service settings: Docker runtime, Singapore region, one instance,
   `/health` health check, and the paid `0.5c-512mb` compute plan. Review Render's
   displayed price before creating the service. The paid plan avoids free-tier
   idle spin-down; change the region in the YAML before initial deployment if
   needed. The service branch is explicitly set to `codex/render-deploy`.
4. Enter `OPENAI_API_KEY` when prompted. Use a key with Astra access; keep it in
   Render's environment settings, never Git or frontend variables. `.dockerignore`
   excludes local environment files from the Docker build context.
5. Apply the Blueprint and wait for the service to become healthy. Open the
   assigned `https://<service>.onrender.com` URL. Check `/health`, generate a room,
   send feedback during generation, lock a piece, and refresh to check recovery.

The Docker command respects Render's `PORT` and binds to `0.0.0.0`. Keep **one
Uvicorn worker and one service instance**: room state and active Astra work live
in that process. Deploys, restarts, and instance replacements clear sessions;
the browser displays a reset notice. Adding a persistent disk alone does not
persist these Python objects. Pushes to the configured branch trigger deployment,
so avoid deploying during a live demonstration. If you later merge to another
branch, update both the Blueprint source branch and `services[0].branch`.

This deployment retains the prototype's access model: anyone with the public URL
can start a design using your backend API key. It does not add accounts or access
control. API usage is billed separately from hosting.

### Connect your subdomain

After the Render URL works, attach a subdomain such as `cozy.example.com`:

1. Open the service's **Settings > Custom Domains > Add Custom Domain** in Render
   and enter your actual subdomain.
2. At your DNS provider, add a **CNAME** record with name `cozy` (or your chosen
   subdomain label) and target the service's exact `<service>.onrender.com`
   hostname. The target has no `https://` prefix or path. Follow any additional
   verification records shown by Render. Change only records for this subdomain.
3. If DNS is managed by Cloudflare, initially set the CNAME to **DNS only**
   (gray cloud), following Render's Cloudflare DNS guide.
4. Click **Verify** in Render and wait for DNS verification and the managed TLS
   certificate. Then open `https://cozy.example.com`, check `/health`, and confirm
   chat and steering work. No code change or rebuild is required for the hostname.

Browser session storage is per origin, so moving from the Render hostname to
your custom subdomain starts a separate room session.

See Render's [Blueprint reference](https://render.com/docs/blueprint-spec),
[custom domain guide](https://render.com/docs/custom-domains), and
[Cloudflare DNS guide](https://render.com/docs/configure-cloudflare-dns).

### Test the production container locally

With Docker running, from the repository root:

```sh
docker build -t cozy .
docker run --rm -p 10000:10000 --env-file .env.local cozy
```

Open `http://localhost:10000`. This runs the same combined frontend/backend used
on Render. Omit `--env-file .env.local` to check static serving and connections
without enabling live Astra requests. The dev servers remain available as before.

## Boundaries

One room, one Astra designer, and a small local catalog. No live shopping search,
downloaded furniture models, manual floor dragging, database, accounts, multiple
agents, or geographic sunlight analysis. Footprint
checks do not constitute a building-code, accessibility, or ergonomic assessment.
Fonts use Google Fonts when available and fall back to system sans-serif offline.

