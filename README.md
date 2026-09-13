# Cozy

An interior design studio built with React 19, TypeScript, Vite, Three.js, React
Three Fiber 9, Drei, and a Python FastAPI backend. Edit a room, inspect generated
furniture, and ingest a curated IKEA catalog with real GLB models.

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

Open <http://localhost:5173>. Add furniture from the collection; drag pieces to
move them, drag empty space to orbit, and scroll to zoom. Select an item to
rotate, lock, or delete it. Furniture lab previews generated JSON and ingested
IKEA models. The expandable backend connection check sends echo messages;
if disconnected, restart the backend and press **Reconnect**.

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

1. Confirm the floor, walls, sample furniture, and imported GLB models render.
2. Add, drag, rotate, lock, delete, and undo; check overlap rejection and budget totals.
   Orbit and zoom; switch to top view and change the light slider.
3. Send several messages and check each backend echo.
4. Stop FastAPI, confirm the disconnected status, restart it, and reconnect.
5. Check the layout at desktop and mobile widths.

The production build is emitted to `frontend/dist`. `npm run preview` previews
those static files only; use the development server for the proxied backend
connection. Production serving and deployment are intentionally deferred.

## Boundaries

AI integration, geographic sunlight calculations, authentication, and production
deployment are not implemented. Scene state stays local to the browser. The
frontend retains the latest 50 connection log entries. Fonts use Google Fonts
when available and fall back to system fonts offline.


## Local furniture studio (September 2026)

The frontend now has a searchable collection, room editing, a furniture lab,
3D/top views, drag/rotate/delete/lock, bounds and footprint-overlap checks,
budget totals, 30-step undo, and browser-local persistence. Locks protect manual
movement, rotation, and deletion. Rugs may overlap other furniture. Start fresh
clears the room and can be undone. Width/depth changes reject placements outside
the new room. These checks do not model door clearance or chair access space.

The AI panel is explicitly a placeholder. The existing backend is still an echo
service; room edits are local and do not yet use a server scene protocol. Use the
expandable backend connection check to test transport independently.

### IKEA ingestion

Run from the repository root:

```sh
python3 scripts/ingest_ikea.py data/ikea-urls.json
```

The curated list currently contains 176 Singapore product pages; each run is capped at 200. The importer extracts
published Product and 3DModel JSON-LD: article ID, purchase URL, brand, color,
SGD price/offer information, availability, photo URLs, dimensions in meters,
source model links, and retrieval date. Visible product measurements fill gaps
in structured dimensions; descriptions provide searchable feature evidence.
Filters support product type, color, features, and maximum price. Price bands
are relative to each product type in this local dataset. It downloads validated self-contained
GLB files, preferring non-Draco variants. No private API credentials, browser
extension, screenshots, or Astra call are required for supported pages.

All records are in `data/ikea-catalog.json`. `data/ikea-ready.json` and
`data/ikea-review.json` separate complete products from records with explicit
missing fields. The frontend reads only ready products from
`frontend/public/ikea-catalog.json`. Samples have their own collection tab. Successfully cached records are reused;
add `--refresh` to re-fetch them. Missing prices, dimensions, and models are kept
as explicit gaps, and only complete records enter the interactive collection.
Aggregate offers use the nested offer for that exact product URL and carry a
price-condition note. Check prices and purchase inclusions on the linked page.

Downloaded models remain in `frontend/public/models/ikea/` and are gitignored.
Downloading does not establish redistribution rights; evaluate these assets
locally and confirm rights before including them in a published app. The
referenced downloader repository is research context only; its code is not
copied or installed into Cozy.

GLB previews are centered at the floor and scaled to catalog exterior dimensions.
The initial sample furniture remains available with clearly identified demo
prices. Click a product thumbnail to inspect its model and source details, and
use Add to room to place it.

### Generated geometry import

Furniture lab accepts one JSON product (under 500 KB), previews it before approval,
and offers a downloadable desk example. The shared type is in `src/catalog.ts`:
`dimensions` and part `size` use `[width, height, depth]` in meters. Parts support
`box` and `cylinder`, floor-based positions, and six-digit hex colors. Cylinder
size is its exterior diameter in X/Z and its height in Y. Generated geometry is
validated for finite dimensions, bounds, and a maximum of 150 parts. Nothing
executes generated JavaScript. Existing catalog IDs cannot be overwritten.


### Lighting preview

Select a lamp in the room to switch its light on/off and adjust preview brightness.
White-spectrum or RGB controls follow the imported capability metadata. For
bulb-dependent fixtures, color controls explicitly simulate a chosen bulb and
do not claim that the lamp includes a smart bulb. Fixed LED products have no
color selector. Day, Evening, Night, and a daylight slider combine fixture
illumination with a fixed-direction sunlight preview on room surfaces.

Select a desk or bedside table before adding a table lamp to place it on top.
Its position remains independently editable. A mounting-height slider supports
raised fixtures; collision checks account for height. Up to eight fixtures can
light one room. Settings persist locally and support undo. The Samples tab
includes an RGB study lamp and a ceiling fan with a white-spectrum light; the
fan blades are static and these are clearly demo products.

Lighting is illustrative: no measured lux/lumens, geographic sun position,
window placement, fixture shadow maps, or physically accurate light bounce.
The room retains a single directional shadow map and renders on demand.

Some lamp footprints are measured from downloaded GLB geometry using
`scripts/measure_ikea_models.mjs`, only when existing published dimensions agree
within 10%. These records retain dimension provenance and are labeled in the
product details; model bounds may include cables. After measurement, regenerate
the split catalogs through the importer. Unresolved dimensions remain in review.
