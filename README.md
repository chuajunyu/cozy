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
caps device pixel ratio at 1.5, and uses one 2048×2048 directional shadow map.
The time slider drives a representative sun path, not geographic sunlight simulation.

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
   Orbit and zoom; switch to top view and change the time slider.
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
the new room. Door swing clearance is reserved; chair access space is not modeled.

When an item is selected, its alternatives replace the AI introduction in the
side panel. The AI feature itself is still a placeholder. The existing backend is still an echo
service; room edits are local and do not yet use a server scene protocol. Use the
expandable backend connection check to test transport independently.

### IKEA ingestion

Run from the repository root:

```sh
python3 scripts/ingest_ikea.py data/ikea-urls.json
```

The curated list currently contains 193 Singapore product pages; each run is capped at 200. The importer extracts
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

Select a lamp in the room to switch its light on/off. Brightness is fixed per fixture;
the brightness slider is removed and legacy saved brightness values are ignored.
Published luminous flux is used when available (e.g. VARMBLIXT 85 lm, NÖDMAST
50 lm). Otherwise the preview explicitly assumes a 470 lm standard bulb or a
1055 lm ceiling bulb; verify the actual bulb and purchase inclusions at IKEA.
White-spectrum or RGB controls follow the imported capability metadata. For
bulb-dependent fixtures, color controls explicitly simulate a chosen bulb and
do not claim that the lamp includes a smart bulb. Fixed LED products have no
color selector. Morning, Noon, Afternoon, Night, and a time slider combine fixture
illumination with directional sunlight entering through room windows.

Select a desk or bedside table before adding a table lamp to place it on top.
Dragging a supported object away detaches it. A mounting-height slider applies
only to anchored ceiling fixtures; ordinary objects use gravity and support checks. Up to eight fixtures can
light one room. Settings persist locally and support undo. The Samples tab
includes an RGB study lamp and a ceiling fan with a white-spectrum light; the
fan blades are static and these are clearly demo products.

Lighting is illustrative: no calibrated room lux, geographic sun position,
fixture shadow maps, specular light transport, or measured photometry. Diffuse
daylight bounce is calculated as described below.
The room retains a single directional shadow map and renders on demand.

Some lamp footprints are measured from downloaded GLB geometry using
`scripts/measure_ikea_models.mjs`, only when existing published dimensions agree
within 10%. These records retain dimension provenance and are labeled in the
product details; model bounds may include cables. After measurement, regenerate
the split catalogs through the importer. Unresolved dimensions remain in review.

### Windows and directional sunlight

The room starts with one east-facing window and a 09:00 sun. Under **Windows &
sunlight**, scrub 06:00–20:00 in half-hour steps or choose a preset. **Edit windows**
supports one window per compass wall (up to four), with independent position,
width, height, and sill controls. Removing every window and closing all doors blocks direct sun.
Dimensions adapt to smaller rooms; settings are saved with the scene and undoable.
The room preview stays visible while scrolling through controls.

Compass coordinates are fixed: north is -Z, east +X, south +Z, west -X. The
representative clear-sky arc rises east at 06:00, reaches 60 degrees altitude
in the south at noon, and sets west at 18:00. These are illustrative solar
times, not local clock-time predictions. Location, date, weather, nearby
buildings and weather are not modeled. Glazing uses a fixed transmission
assumption and diffuse bounce uses the approximation below.

Walls have real rectangular apertures. All four walls and the roof cast shadows,
even when hidden in cutaway/top view, preventing sunlight from bypassing the
windows. Furniture and window mullions cast directional shadows. One 2048-square
shadow map replaces the previous 1024 map to resolve window edges; demand
rendering and the DPR 1.5 cap are preserved. Hidden surfaces do not intercept
furniture interaction. Existing lamp light remains additive at every time.

### Indirect daylight transport

Outdoor daylight now reaches the whole visible interior through diffuse sky
illumination and reflected light. The old constant ambient room light is removed.
A Web Worker samples the diffuse rendering equation with cosine-weighted
Lambertian scattering, window visibility, a fixed 0.82 glazing transmittance, and
up to five surface bounces. Surface reflectance attenuates each bounce in linear
RGB. Solar next-event estimation adds reflected sunlight; the existing shadowed
directional light provides the direct solar beam separately, avoiding duplication.
See [PBRT's light transport equation](https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/The_Light_Transport_Equation)
and [Lambertian reflection](https://www.pbr-book.org/4ed/Reflection_Models/Diffuse_Reflection).

The room samples 192 rays at each of 196 spatial probes. Four first-order spherical
harmonic coefficients are interpolated in the material shader, so illumination
varies with position and surface orientation. Probe calculations use the six room
surfaces and per-mesh furniture bounding boxes; direct sunlight shadows retain
actual triangle geometry. Mesh textures, curved details, transmission through
furniture, specular bounces, and very fine indirect shadowing are approximated or
not modeled. This is a physically based diffuse transport approximation, not a
photometric or architectural daylight certification tool.

The sky is a bright uniform upper hemisphere preset with diffuse horizontal
irradiance around 65% of direct-normal sunlight (3.25× the previous diffuse
source), keeping shaded windows bright at 13:30; the lower hemisphere represents
20% ground reflection. Sun/sky intensity uses normalized radiometric units, not
calibrated lux. Indoor camera exposure adapts to computed daylight irradiance for legibility
(up to 32×). Lamp switches never affect that exposure, so lamps remain additive
and cannot dim the daylight. At night or with no daylight, exposure uses a fixed
32× low-light preset independent of lamp switches; an unlit room stays black.
Exposure does not inject light energy. Fixture lumens use one common illustrative appearance scale:
`lumens / (4π) × 0.01` for isotropic point emission, preserving relative bulb
outputs and inverse-square falloff. A standard 470 lm bulb has intensity about
0.374, making its light visible on nearby surfaces during daylight and at night.
Neither the fixture scale nor the sky preset is a calibrated lux measurement. Room orientation/time still uses the existing
illustrative solar path, without latitude/date input. Lamps retain their preview
point lights and do not participate in the bounce solver.

Geometry, window, and time edits recalculate probes off the UI thread. Only the
latest pending calculation is retained; old responses cannot overwrite newer
settings. Night or closing/removing every daylight opening immediately clears outdoor lighting.
The UI displays **Updating daylight…** during calculation. Frame-on-demand, DPR
1.5, and the single 2048-square direct shadow map are preserved.

Run the transport regressions with Node 22+:

```sh
node --experimental-strip-types --test frontend/src/daylightTransport.test.ts
```

They cover source-free darkness, diffuse sky without direct sun, bounce energy,
black surfaces, linear source scaling, window occlusion, deterministic coefficients,
and probes embedded in furniture. Browser QA also checks daylight without lamps,
night, window removal, preserved directional shadows, and material shader errors.

### Gravity and supporting surfaces

Dropping ordinary furniture settles its base onto the floor. Surface-compatible
products (currently table lamps, or imported products with `placement.mode` set
to `surface`) may land on a table, desk, cabinet, or shelf top when the full
footprint fits. A green landing preview shows the destination during dragging.
Unsupported overhangs, occupied landing areas, blocked fall paths, and room bounds
reject the drop and retain the prior arrangement.

Items falling to a lower surface animate with acceleration 9.81 m/s² and stop
without bouncing at their validated landing height. This is controlled gravity
placement using exterior bounds; it does not simulate tipping, rolling, breaking,
or detailed rigid-body contact. Surface metadata is conservative and does not
currently describe interior shelf compartments or product load ratings.

The **Resting on** selector can place small objects onto a suitable support.
Moving/rotating a support carries its resting objects; deleting it makes them
settle onto the next valid surface or floor. The entire edit is rejected if a
locked dependent would move or no safe landing exists. A completed drag is one
undo step. Escape and pointer cancellation abandon the drag. Ceiling fixtures
remain mounted; locking is separate from physical attachment. Saved support links
are restored, and legacy elevated objects are normalized when a safe placement
exists.

Imported product metadata may declare:

```json
{"placement":{"mode":"floor","canSupport":true}}
```

Modes currently supported: `floor`, `surface`, `ceiling`, and `wall` (doors). `canSupport` explicitly
marks a flat exterior support; otherwise common furniture types use conservative
name/type matching. Wall-mounted art/lights are planned as explicit wall anchors
with wall selection, flush orientation, height/offset controls, and window/fixture
collision validation. They are not implemented by disabling gravity.

Run placement and daylight regression checks:

```sh
node --experimental-strip-types --test frontend/src/placement.test.ts frontend/src/daylightTransport.test.ts
```

### IKEA mattresses and bed decks

The collection includes three complete downloadable mattress models: VITMÅSEN
120×200 cm, VESTERÖY 150×200 cm, and VALEVÅG 150×200 cm. IKEA's published
**Thickness** supplies mattress height. Other discovered variants without models
stay in review. A matching MALM 150×200 frame was also ingested.

Select a bed frame and use **Attach mattress** to choose a mattress from the
collection or one already loose in the room. It automatically centres, aligns,
and attaches to the bed's deck. The frame stays selected, with its attached
mattress shown in the controls. Adding a mattress from the collection while a
bed is selected uses the same pairing behavior. An incompatible or occupied
bed reports the problem instead of silently placing the mattress on the floor.

Alternatively, drag a mattress over a bed and release. When at least half its
aligned footprint overlaps a usable deck, it snaps into place, lifts, and falls
onto it. Exact-sized beds take preference over larger nearby decks. The full
footprint must fit: a smaller mattress centres with a visible gap/size warning,
while larger mattresses that overhang are rejected. Dimensions never stretch.
Tables, unverified beds, and occupied decks are rejected. Move or
rotate the bed to carry the mattress; drag it away or delete the unlocked bed
to settle it onto the floor. Locks, undo, and saved attachments are preserved.

`data/ikea-placement.json` stores explicit local deck dimensions, height, centre,
and provenance, retained across ingestion refreshes. BRUKSVARA, VEVELSTAD, and
MALM/LURÖY heights were estimated from model triangles. Bare MALM frames omit
slats, so their 26.5 cm deck assumes a LURÖY base at the lower rail setting,
referenced to the measured MALM/LURÖY model. The UI labels that assumption;
confirm the purchased base and assembly setting. Already dressed sample beds
and unverified daybeds do not accept another mattress.

Placement metadata supports `surfaceKind: "mattress"` for mattresses and
`support: { kind: "mattress", width, depth, height, center: [x,z], evidence }`
for beds. All coordinates are local meters; height excludes the headboard.

Run all frontend geometry/lighting checks:

```sh
node --experimental-strip-types --test frontend/src/*.test.ts
.venv/bin/python -m pytest scripts/tests backend/tests -q
```

### Try similar pieces

Select a sofa or another room item to see **Similar pieces** in the right panel.
On tablet/mobile widths, the choices appear as a horizontal strip directly below
the selection controls. Suggestions match the furniture type (sofas, desks,
office chairs, mattresses, or the same lamp mounting type), independent of the
collection's current search and filters. Ready IKEA products appear first, sorted
by footprint similarity and then price difference; samples/custom products are
clearly labeled. Cards show photos, width/depth, price, and price difference.

**Try in room** replaces the selected item in place, retaining its position,
rotation, support attachments, and applicable light settings. The room item
count stays the same and the budget updates immediately. **Undo** restores the
previous piece and keeps it selected for further comparison. Replacements are
saved locally using the existing scene persistence.

Options that collide, cross room boundaries, or lose a supporting surface are
disabled with a reason. Move the selected piece into clear space to try a larger
option. Locked pieces must be unlocked first; a locked supported object also
blocks replacements that would move it.

### Doors and daylight

Choose **Room elements → Classic door**, or **Add door** above the sunlight
controls. This built-in solid door is 90 × 210 cm and has no purchase price;
it is excluded from the budget. It is a room element, not an IKEA product.

Select a door to choose its compass wall, slide its position, and **Open door**
or **Close door**. The wall contains a real doorway; the opaque leaf swings
90° inward. Doors stay attached to the wall as the room resizes. Placement
rejects overlaps with windows/other doors and reserves a width × width square
inside the room for the swing. This is conservative clearance rather than a
hinge collision simulation. Locked doors cannot move or be deleted but still
open/close. Undo and browser-local saving include wall position and open state.

Open doors are treated as exterior openings: diffuse sky and bounced sunlight
enter with full transmission, while windows retain their 0.82 glazing factor.
The existing single shadowed direct beam retains its common 0.82 display gain.
Closed doors and their shadows block sunlight; nighttime supplies no daylight.
Connected interior rooms, glass door styles, and partial opening angles are not
modeled. Door items store `door: { wall, offset, open }`; products declare
`door: { kind: "solid" }` and `placement: { mode: "wall" }`.
