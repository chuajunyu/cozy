# Cozy

A collaborative interior design studio using React 19.2, TypeScript, Vite,
React Three Fiber 9, Drei, and Python FastAPI. The collection, furniture lab,
manual room editing and GPT-6 Astra designer share one authoritative backend room.

## Install

Requires Node.js 22.12+, npm, and Python 3.11+. From the repository root in
Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
npm.cmd --prefix frontend ci
.\.venv\Scripts\python.exe -m scripts.prepare_assets
```

On macOS/Linux use `python3`, `.venv/bin/python`, and `npm`. The asset command
requires curl (`curl.exe` on Windows). It downloads the recorded IKEA GLBs,
validates self-contained glTF 2.0 files and copies the installed Three.js Draco
decoders locally. It reuses valid cached files and reports failed downloads.
Run it before starting FastAPI, or restart FastAPI after preparing assets.
No metadata refresh or OpenAI API call happens during asset preparation.

The checked-in catalog has 98 preview-ready source records and 95 records awaiting
review. The backend only marks a product preview-ready when its local GLB passes
validation. Unavailable assets are excluded from placement and recommendations;
out-of-stock products may be previewed manually but are excluded from agent search.
GLBs, decoder copies, dependencies and generated output are Git-ignored.

`data/ikea-ready.json` retains dated source evidence, dimensions, SGD prices,
availability, source URLs and extension requirements. `data/ikea-categories.json`
resolves ambiguous table categories explicitly. `data/samples.json` contains the
original procedural samples; the original backend demo IDs remain supported.
Sample/custom prices are illustrative. IKEA data is a dated snapshot, not live
shopping availability. This repository does not redistribute the downloaded GLBs.

## Run

Set `OPENAI_API_KEY` in the backend environment or in root `.env.local` (see
`.env.example`). Keys and raw upstream protocol objects stay on the backend.
Never use a frontend `VITE_` variable for credentials. Manual editing works without
a key. Sending a design request to the normal backend uses `gpt-6-astra` and incurs
API usage.

Terminal 1:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2:

```powershell
npm.cmd --prefix frontend run dev
```

Open http://localhost:5173. Vite uses a fixed port and proxies `/health`, `/catalog`
and `/ws` to port 8000. For a separate worktree instance, set
`$env:COZY_BACKEND_URL='http://127.0.0.1:8001'` and use
`npm.cmd --prefix frontend run dev -- --port 5174`, with its backend on 8001.
Browser WebSocket URLs use the page host, including `wss` on HTTPS.
Run one FastAPI worker because sessions are in memory.

## Use the studio

- Browse and filter the IKEA collection or samples. Preview a model in the
  furniture lab and add it to the room. Repeated GLB instances have independent
  transforms. Draco, WebP textures and texture transforms are supported locally.
- Drag furniture to move it; use rotate, lock and delete on a selected piece.
  Drag empty space to orbit, scroll to zoom, or switch to top view.
- Adjust room width/depth/height, budget, windows and solar time. Up to eight
  fixtures use fixed lumen output with on/off, mounting height and colors allowed by their
  metadata. Select a surface before adding a table lamp to place it on top.
  Lighting is an illustrative preview, not measured photometry.
- Import a data-only JSON product in the furniture lab. Inspect geometry and scale,
  approve it for the session catalog, then add it to the room. Example JSON is
  downloadable there. Imports accept bounded box/cylinder parts and optional
  lighting, not scripts or external model URLs. Custom IDs use `custom-`; bundled
  samples use `sample-`. Existing IDs cannot be overwritten.
- Describe a room to Astra. It streams explanations and places coordinated groups.
  Select an item or use a group's Comment button to scope feedback; Whole room
  clears that scope. Like is a soft preference. Locks preserve exact product and
  pose. Replace and Reroll unlocked keep current pieces visible until valid
  alternatives are accepted. Feedback and manual edits can steer an active run.
- Undo restores the previous accepted room change, including agent groups, room
  settings, locks, placement and fixture changes. The shared history keeps 30
  steps. Undo pauses the agent and fences late tool results before restoring;
  send a new prompt to resume. Chat, likes and catalog imports are not undo steps.
  Start fresh clears an unlocked room and is itself undoable.

The floor is at y=0 and x/z coordinates are centered on the room. Product dimensions
are named width/height/depth in backend meters; generated JSON uses [width, height,
depth]. The renderer centers GLBs and normalizes their bounds without changing the
cached source scene. Rendering remains on demand with DPR capped at 1.5 and one
2048 x 2048 directional shadow map. A model load error shows a selectable fallback
without taking down other room items.

## Sessions and device backups

A random bearer session token lives in `sessionStorage`. Refresh/reconnect recovers
the backend room, custom products, chat and current agent status. Disconnecting
preserves the session and active design. Inactive disconnected sessions expire
after an hour; a backend restart resets all sessions. This is a local prototype,
not an authenticated multi-user persistence service.

Accepted snapshots and approved custom geometry are backed up to this browser's
`localStorage` under `cozy.studio.v3`. After a reset, the UI offers Restore saved
room, Download backup, or Archive and start fresh. Restore validates the entire
backup on the server and only applies to an empty new session. Missing products,
assets or invalid layouts reject the whole restore; the original backup remains.
Archiving preserves the old save separately before allowing new edits.

Legacy `cozy-studio-v1` saves migrate corner coordinates to centered coordinates,
map sample/custom IDs, and preserve rotation, elevation, fixtures and locks.
Duplicate IDs and missing products fail explicitly. Backups omit computed fields,
chat and credentials. Undo history is session-only and is not restored. Device
storage is optional; the UI reports write failures while preserving backend state.

## Interfaces and consistency

- `GET /health`: `{"status":"ok"}`. `GET /catalog`: products and review count.
- `/ws`: persistent native WebSocket, JSON text frames. Initialize with
  `{"type":"session.init","sessionId":null}` or a saved session ID.
- `session.ready`: session ID, authoritative state, catalog, conversation and status.
- Chat commands: `chat.send`, `feedback.send`, `item.lock`. Feedback actions are
  `comment`, `like`, `reroll`, `reroll_unlocked`; up to 100 `slotIds` can be targeted.
  `expectedProducts` guards against a changed recommendation.
- Studio commands: `item.add`, `item.update`, `item.delete`, `item.replace`, `fixture.update`,
  `room.update`, `room.clear`, `room.undo`, `catalog.import`, `session.restore.preview`, `session.restore`.
  They require unique `requestId` and current `baseRevision`; targeted item edits
  also require `slotId` and `expectedProduct`. See `backend/studio.py` schemas.
- `design.updated` carries a full accepted snapshot, revision and undo count.
  `catalog.updated` carries approved products. `command.ack` confirms a studio edit.
  Chat events include `chat.message`, `chat.delta`, `agent.status`, `feedback.ack`,
  `design.group` and `design.completed`. Receipt, upstream submission, queued
  steering and applied feedback are distinguished. Errors leave the socket usable.
- Frames are bounded: 32 KB ordinary commands, 510 KB imports, 2 MB restores.
  The original echo command remains supported for transport checks.

Every accepted change advances a revision. Stale browser/model edits are rejected;
clients never rewind to an older snapshot. Atomic validation checks IDs, categories,
renderable assets, bounds, height, collisions, locks, rejected products, fixture
limits and budget. Rugs may overlap solids; height-separated objects can stack.
A targeted reroll preserves unrelated products and permits small moves of unlocked
surrounding pieces for fit. A lower budget stated in chat can flag the old room
while the agent repairs it; direct invalid manual room edits are rejected.

`main.py` handles transport; `protocol.py` handles chat/feedback; `studio.py` handles
manual transactions and restore; `sessions.py` owns memory and history; `design.py`
validates layouts; `products.py` normalizes products; `design_tools.py` exposes
bounded catalog search and atomic tools; `astra.py` manages Responses WebSocket
streaming and steering. Completed tool calls are deduplicated, and canceled runs
cannot commit late results. Session limits include 100 room slots, 100 custom
products, 50 chat messages, 100 feedback entries and 500 deduplication records.

## Verify

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
```

Build includes strict TypeScript checking. Tests use simulations, not live API calls.
To exercise streaming, grouped placement, feedback, replacement and undo in a real
browser without API usage, replace the normal backend command with:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.tests.browser_server:app --host 127.0.0.1 --port 8000
```

This opt-in fixture identifies itself as a simulation. Start with an empty room;
it places a sofa/rug and accepts steering for 15 seconds after each input.
The normal `backend.main:app` entry point always uses the real designer.

Browser checks should cover compressed/uncompressed and repeated models, dragging,
rotation/locks, import approval, fixtures, undo, stale changes, reload/reconnect,
backend reset/restore, missing-model fallback and desktop/mobile layouts.
The optional `python -m backend.tests.live_smoke` uses real API calls and is separate
from deterministic tests. `npm run preview` serves static production output only;
use Vite's development server for integrated backend checks.

No database, accounts, deployment, live shopping search or geographic sunlight
analysis is included. Footprint checks do not assess building-code compliance,
accessibility or ergonomics. Fonts fall back to system fonts offline.

### Frontend v3 integration

Doors are anchored room elements with reserved inward swing clearance and no
purchase cost. Surface objects carry with their supports; deletion settles them.
Mattresses attach only to verified, fitting decks. Dependent changes are atomic
and share one undo step. A locked dependent blocks a move that would affect it.
Similar pieces uses a manual replacement command without starting a model call.

Astra's separate `edit_room` tool requires permission from the current explicit
chat request. For example, “Add a north-facing window” permits that operation;
“make it brighter” does not. Ordinary design requests keep architecture fixed.
Permissions expire on completion, cancellation, undo, or a later request.

Restore first produces a server-owned preview of adjustments and blockers.
Applying requires its `previewId`, the current revision, and an empty session.
Required changes to locked objects must be explicitly selected in the preview;
locks survive restoration. Version 2 and legacy saves remain untouched. Version 3
backups include windows, solar time and supports, but never workers, textures,
permissions or undo history. Legacy brightness is accepted but ignored by rendering.

Daylight is computed in a browser worker from authoritative room dimensions and
openings. Worker errors leave editing available and expose a Retry daylight button.
