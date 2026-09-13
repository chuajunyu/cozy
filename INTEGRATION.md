# Full studio integration

Worktree: `.worktrees/full-studio`, branch `integration/full-studio`.

## Sources preserved

- Local agentic main snapshot: `fc3cd6f` (based on `c1a38cd`).
- Shelia frontend: `fa807267ad2b58f24115449781d6346e0c95cc3c`.
- Later local-main fixes: upstream request acknowledgement waits for
  `response.created`; a product replacement clears its old like; feedback records
  the product IDs it refers to; corresponding regression test and README wording.
- Final fetch on September 13, 2026: remote main remains `c1a38cd`.
  The original main checkout and its uncommitted work are preserved.

## Model loading and integration decisions

Shelia's ingestion scripts discover IKEA product pages, extract metadata and retain
model URLs in `data/ikea-ready.json`. The 94 ready records reference local GLBs;
the other 82 records stay in review. Asset preparation downloads the recorded GLBs
and local Draco decoders. Backend startup checks each asset before enabling it.

The unified catalog retains real IKEA provenance and the existing demo IDs.
Explicit table-category overrides prevent desk/coffee/side-table mismatches.
Generated samples/custom products use separate prefixes and validated geometry.
The renderer uses named backend dimensions converted to [width, height, depth],
clones the cached GLB scene, centers its bounds and places its base at y=0.
Draco-compressed files and repeated instances use the same rendering path.

All room mutations now pass through backend validation. Frontend dragging is a
preview until accepted, and commands carry the visible revision and product ID.
Agent groups and manual edits share constraints and history. Undo cancels and
fences the current run before restoration; ordinary edits steer an active run.
Browser backup migration is explicit and rejects invalid restores atomically.

## Verification completed

- 39 backend tests and 9 frontend tests; no live API usage.
- Production build including strict TypeScript. Vite reports the expected large
  Three.js bundle warning (about 1.35 MB minified / 382 KB gzip).
- All 94 cached IKEA GLBs validated by the asset preparation script.
- Browser: compressed/uncompressed and repeated models, dragging, rotation,
  locking, deletion, room clear, shared undo, fixture on/off/color, day/night,
  generated JSON preview/approval/placement, refresh and reconnect.
- Simulated browser designer: streamed Markdown, coordinated placement, live
  lock/group feedback, targeted replacement, and undo pausing the active run.
- Backend restart followed by validated restore of custom furniture and fixtures.
- Missing GLB fallback remained selectable/deletable; other items stayed rendered.
  The temporarily moved cache file was restored.
- Desktop 1440px and mobile 390px layouts; no mobile horizontal overflow.

The real Astra adapter has deterministic transport/steering tests. A new live model
run was not performed. The browser simulation is opt-in via a separate test entry
point; normal startup continues to use Astra.

## Bringing this into main

This branch contains a local integration merge. Nothing has been pushed or applied
to the original main working directory. First commit/reconcile the original main
edits, then merge this branch and resolve any overlapping baseline commits by
content. Fetch main again immediately before doing so if work continues elsewhere.
Use the README setup and verification commands after merging; cached models and
secrets are intentionally absent from Git.
