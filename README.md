# Cozy

A collaborative interior design studio using React 19.2, TypeScript, Vite,
React Three Fiber 9, Drei, and Python FastAPI. The collection, contextual tools,
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

The checked-in catalog has 203 preview-ready source records and 245 records awaiting
review. The backend only marks a product preview-ready when its local GLB passes
validation. Unavailable assets are excluded from placement and recommendations;
out-of-stock products may be added manually but are excluded from agent search.
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

## Deploy

See [DEPLOYMENT.md](DEPLOYMENT.md) for free Render hosting and custom subdomains.
The Blueprint deploys **main** as one Docker service: it builds the React
frontend, downloads and validates the recorded furniture models and Draco
decoders, and runs the FastAPI backend. FastAPI serves the built frontend and
assets at `/`, with `/health`, `/catalog`, `/ws`, and `/ws/voice` on the same host.
When a local `frontend/dist/index.html` exists, FastAPI serves that build too;
restart the backend after creating the first build. Vite development is unchanged.

## Use the studio

- The room fills the workspace. Add furniture, Ask Astra, Room setup and Lighting
  open one panel at a time. Panels become expandable bottom sheets below 900px.
  Closing or switching panels preserves chat drafts and collection filters.
  Drag the sidebar's left edge to adjust its width; on smaller screens, drag the
  sheet's top edge to adjust its height. Sizes persist while switching panels.
  The focused handle also supports arrow keys, Home/End, and Enter to reset;
  double-clicking the handle restores its default size.
- Browse and filter the IKEA collection or samples, then add pieces directly to
  the room. The furniture lab and separate model-preview scene have been removed.
  Repeated GLB instances have independent transforms; Draco, WebP textures and
  texture transforms are supported locally.
- Select a piece for Rotate, Replace and Lock/Unlock. More opens dimensions,
  placement, Like and Delete. Lamp and door selections expose their relevant
  quick actions. Mattress fitting controls appear in the selected piece's details.
- Drag furniture, doors, windows and wall lamps directly to move them. Doors stay
  on the floor; windows and wall lamps can also move vertically. Drag past a corner
  to change walls, or use Top view to drag toward another wall. Escape cancels a
  drag; releasing saves one undoable edit. Locked pieces stay fixed.
  Drag empty space to orbit, scroll to zoom, or switch
  to Top view. Fit room reframes the complete room. Panel resizing preserves the
  chosen orbit and relative zoom; the room canvas stays mounted throughout.
- Add furniture → Room elements includes doors and four window styles: Classic,
  Wide, Floor-to-ceiling and Panoramic. Full-height presets leave slim frame
  clearance at the floor and ceiling. Select a window and open Style & size to
  change its style, dimensions or remove it. The room supports one window per wall;
  new windows use a clear wall and do not replace existing ones. Precise placement
  controls are collapsed by default. Room setup also links to these room elements.
  Lighting contains solar time.
  Select a surface before adding a table lamp to place it on top. Fixture settings
  live with the selected lamp; illumination is illustrative, not measured photometry.
- Click the cost summary for budget editing and the room's piece list. The studio
  menu contains Reset room and connection details. Escape closes the panel before
  deselecting a piece. Disconnection, restoration and validation notices remain visible.
- Ask Astra opens at the latest conversation and message box. Scrolling back to
  read history stops automatic scrolling until you return to the composer.
- Manual room edits appear as compact activity rows (for example, You moved with a
  named object pill), not Astra speech. They remain in authoritative room context
  and steer active work silently; an edit alone never starts a new design response.
- Describe a room to Astra. It streams explanations and places coordinated groups.
  Select an item or use a group's Comment button to scope feedback. Named object
  pills show the targets in the composer and sent messages; click one to select
  the object or remove its composer pill to change the scope. Whole room clears it. Like is a soft preference. Locks preserve exact product and
  pose. Replace and Find alternatives for unlocked pieces keep current pieces visible until valid
  alternatives are accepted. Feedback and manual edits can steer an active run.
- Undo restores the previous accepted room change, including agent groups, room
  settings, locks, placement and fixture changes. The shared history keeps 30
  steps. Undo pauses the agent and fences late tool results before restoring;
  send a new prompt to resume. Chat, likes and catalog imports are not undo steps.
  Reset room explicitly removes all pieces, including locked pieces, and is undoable.
  It preserves room dimensions and budget.

The floor is at y=0 and x/z coordinates are centered on the room. Product dimensions
are named width/height/depth in backend meters; generated JSON uses [width, height,
depth]. The renderer centers GLBs and normalizes their bounds without changing the
cached source scene. Rendering remains on demand with DPR capped at 1.5 and one
1024 x 1024 directional shadow map. A model load error shows a selectable fallback
without taking down other room items.

## Sessions and device backups

A random bearer session token lives in `sessionStorage`. Refresh/reconnect recovers
the backend room, custom products, chat and current agent status. Disconnecting
preserves the session and active design. Inactive disconnected sessions expire
after an hour; a backend restart resets all sessions. This is a local prototype,
not an authenticated multi-user persistence service.

Accepted snapshots and approved custom geometry are backed up to this browser's
`localStorage` under `cozy.studio.v3`. New empty sessions automatically restore the
saved room through a server-owned preview and apply step. Routine session expiry
and backend restarts do not produce banners. Reconnect retries automatically with
backoff from 1 to 10 seconds; the last rendered room remains visible while recovering.
A live nonempty server room always wins over the device backup. Missing products,
assets or invalid layouts reject the whole restore; the original backup remains.
Only failed recovery shows a short notice, with retry/download options in the studio
menu. Reset room archives a failed save and replaces it only after server acceptance.
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
  Chat messages optionally include `references: [{slotId, name, category}]`; names
  are captured at send time and survive replacement/deletion. Model feedback retains
  internal target IDs separately from the visible message.
  Chat events include `chat.message`, `chat.delta`, `agent.status`, `feedback.ack`,
  `design.group` and `design.completed`. Receipt, upstream submission, queued
  steering and applied feedback are distinguished. Errors leave the socket usable.
- `room.clear` accepts `allowLocked` IDs for an explicit reset; ordinary clears still protect locks.
- Frames are bounded: 32 KB ordinary commands, 510 KB imports, 2 MB restores.
  The original echo command remains supported for transport checks.

Every accepted change advances a revision. Stale model proposals are rejected.
Direct item moves, deletes, replacements and fixture edits may rebase over an
unrelated change when the last 50 revision snapshots prove that the target and
its supporting group are unchanged. The latest layout and locks are still
validated before committing. Room-wide changes retain strict revision checks;
conversation accepts current state while expected-product guards protect its targets.
clients never rewind to an older snapshot. Atomic validation checks IDs, categories,
renderable assets, bounds, height, collisions, locks, rejected products, fixture
limits. Manual budgets are targets, with red cost and over-budget indicators;
they never block setting a lower target, editing, undo or saved-room recovery.
Enter a budget and choose Save budget; typing does not submit intermediate values.
Astra stays within budget, or makes incremental savings when already over it.
Rugs may overlap solids; height-separated objects can stack.
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
rotation/locks, contextual panels, fixtures, undo, stale changes, reload/reconnect,
backend reset/restore, missing-model fallback and desktop/mobile layouts.
The optional `python -m backend.tests.live_smoke` uses real API calls and is separate
from deterministic tests. `npm run preview` serves static production output only;
use Vite's development server for integrated backend checks.

No database, accounts, live shopping search or geographic sunlight
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
Automatic recovery includes the required locked adjustment IDs in the apply command;
locks survive restoration. Version 2 and legacy saves remain untouched. Version 3
backups include windows, solar time and supports, but never workers, textures,
permissions or undo history. Legacy brightness is accepted but ignored by rendering.

Daylight is computed in a browser worker from authoritative room dimensions and
openings. Worker errors leave editing available and expose a Retry daylight button.

## Demo notices

Normal recovery is automatic. The canvas can briefly show Opening your room,
Reconnecting, Saving, daylight progress, or Astra activity. No session-expired or
saved-room confirmation banner appears.

Actionable notices float below the header and can be dismissed without resizing
the room canvas or shifting the controls.

The sunlight slider previews direct sun locally and saves once on release (or
keyboard completion). During sunlight and furniture drags, the last completed
reflected lighting stays visible. Bounce lighting updates after the gesture
settles, without a routine progress popup. Escape cancels a sunlight preview.
The outside background follows this solar time too: bright by day, warm around
sunset, and dark blue at night, including while previewing the sunlight slider.

Actionable notices remain for invalid placements, locked/stale edits, budget or
item/fixture limits, unavailable Astra, failed recovery, and failed device saving.
Technical connection/recovery details are under Studio menu > Connection & collection.
Replacement uses an explicit dialog; mattress-fit and model-loading information
appear with the affected piece. Reset room is explicit and undoable.

The backend needs outbound HTTPS/WSS access to OpenAI in addition to the local
frontend/backend ports. A sandboxed backend may accept browser connections while
its Astra connection fails with ConnectionRefusedError. Restart it in a process
with outbound network access; changing local ports or rotating keys does not fix
that restriction.

## Editing alongside Astra

Astra does not hold a room lock while generating. Short transactions serialize
accepted changes. Dragging continues across unrelated scene revisions; a change
to the dragged piece's pose, product, lock, support or room dimensions cancels
that gesture. New collisions are checked against the latest room at drop time.
Chat remains available while a manual command awaits acknowledgment. Manual
commands still use one in-flight write at a time. Same-object conflicts require
retrying against the current object; Lock remains the explicit way to preserve
an exact product and pose across future design iterations. Undo and Reset pause
Astra as before.
## Expanded IKEA Singapore collection

448 product records cover study, living, dining, kitchen trolleys/islands, storage
and wall décor; 203 have usable local models and 245 remain in review. Three URLs
failed to load. Prices and availability retain their retrieval timestamps.

Run `python3 scripts/ingest_ikea.py data/ikea-urls.json` to regenerate from cached
records (or add `--refresh` to fetch again). Curated batches are limited to 500
entries with an explicit error, rather than silent truncation. Run
`python -m scripts.prepare_assets` and restart the backend to load the new models.
Models and decoder files remain Git-ignored.

Four real wall lamps are included: VARPTROSS, SOLKLINT, VARMBLIXT (white circle)
and HAVSDUN. Their dimensions, orientation and emitter evidence are recorded in
`data/ikea-wall-mounts.json`. The catalog changes include the wall-placement support
these products require: `slot.wallMount = {wall, offset, height}` uses centre
height in meters, with server-derived placement, locking, undo and saved anchors.
Catalog `modelRotation` applies quarter turns before model fitting. Fixture output
remains illustrative; wall décor lacking reviewed mounting stays out of placement.

## Room surfaces

Open **Room setup → Surfaces** to color all walls, one compass wall, or the floor.
Presets apply immediately. Custom color and Restore default are inside the
optional Custom color disclosure and affect only the selected surface.
Colors affect the rendered material and reflected daylight, survive device
backup and server restoration, and support Undo. Older saves use natural oak
for the floor. Wall lamps live in Add furniture and can be dragged along a wall or
up and down. Select one and open More → Precise placement for numeric controls.
Invalid overlapping placements are rejected without changing the saved room.

Astra's WebSocket TLS connection loads the `certifi` CA bundle as well as configured
system roots, including on macOS Python installations without a native CA bundle.
Certificate and hostname verification remain enabled. Known backend connection
errors are displayed in the UI without forwarding raw upstream exception bodies.

### Two-way voice

Voice is off by default. Enable **Voice chat** in Ask Astra to show the voice
controls. This frontend preference is remembered in this browser; no environment
flag or backend restart is needed. Turning it off ends an active call and hides
voice controls, while keeping text chat and conversation history available.
Enabling the toggle does not start recording; press **Start voice** separately.

When enabled, open **Ask Astra → Start voice**, allow microphone access, and talk naturally.
Voice controls sit below the conversation, beside the text composer. Spoken
transcripts appear only in the conversation, which scrolls to the latest message;
there is no separate transcript above the chat. Text chat remains available in both modes.
GPT live-1 handles speech and delegates room requests to the existing GPT-6 Astra
designer. Replies are spoken and the spoken transcript appears in the conversation; internal designer output is not duplicated in chat. Mute pauses microphone
input; **End voice** releases the microphone and closes the Live session. Switching panels keeps voice connected. Already submitted room work continues.

Voice uses the existing backend `OPENAI_API_KEY` with access to `gpt-live-1` and
`gpt-6-astra`. No key is sent to the browser. Serve the frontend over HTTPS or
localhost, and proxy `/ws/voice` as a WebSocket (the existing Vite `/ws` proxy does
this). Audio travels directly over WebRTC; the backend owns session startup and
Astra delegation. One voice call per room is allowed; calls close after ten minutes,
on room reset/restore, or when the controlling browser disconnects. Typed chat
remains available. Voice is billed by call duration, with separate Astra usage.

API references: [GPT-Live](https://developers.openai.com/api/docs/guides/live),
[client delegation](https://developers.openai.com/api/docs/guides/live-delegation),
[WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live).

Voice control retries transient upstream WebSocket disconnects up to three times.
The browser allows 15 seconds for a temporarily disconnected audio connection to
recover. A dropped connection is reported separately from API access/quota errors;
the ten-minute application cap shows its own end-of-session message.

Voice transcripts appear as you speak and update in place, so room processing
does not move your message below Astra’s reply.
Voice remains connected through a brief interruption of the room-state socket.
Recoverable Live command errors show a notice instead of hanging up the call.
Backend voice diagnostics record connection states, elapsed time and close/error
codes, without recording raw audio or authentication headers.

Voice uses minimal acknowledgments and asks the model to resume an unfinished answer
after interruptions. Actual session closures show a reason when the provider supplies
one; a connected call with interrupted speech is different from a disconnected call.

Chat recovery keeps the latest 50 user/assistant messages (up to 6,000 characters
each) in sessionStorage for the current browser tab. Reconnects and page reloads
reuse them when a backend restart or session expiry creates a replacement session.
Both text Astra and a new voice call receive recent restored conversation context;
restoring history does not replay requests or override the saved room. Existing
live sessions remain authoritative. Closing the tab or clearing its storage removes
this browser fallback; it is not account-level or cross-device chat storage.
