# Dogfood design evaluation

Status: prepared, not run. Live model and voice evaluation incur API usage and are
separate from deterministic tests and the no-API browser simulation. Do not claim
design quality improved until the paired review below passes.

## Implementation verification (2026-09-13)

- Backend/script suite: 113 passed. Frontend suite: 141 passed. Production build
  and TypeScript checks passed. Existing dependency deprecations and Vite's large
  bundle advisory remain; no dependencies were changed.
- Browser simulation on backend port 8011 and Vite port 5181: repeated rotations
  produced one row, active edits received individual Astra acknowledgments,
  different room settings grouped and expanded, and live-session reload retained
  summaries. Desktop 1365 × 900 and mobile 390 × 844 layouts were inspected.
- Orbiting, Top view, retained shadows, direct window dragging, locked controls,
  attempted dragging of locked furniture, Escape panel dismissal, panel switching,
  and automatic recovery of furniture/window position/paint/sunlight after a backend
  restart were verified in the browser.
- Mid-gesture Escape cancellation and door/wall-lamp dragging were not separately
  exercised in this browser pass. Existing gesture/placement tests passed; they do
  not substitute for those interactive checks. Live Astra design quality and voice
  behavior remain unverified pending the explicit billable evaluation below.

## Paired procedure

Compare baseline `ca5f99e` with `codex/dogfood-polish`. Use identical catalog files,
locally available models, model settings, initial room snapshots and prompts for
each pair. Record the final candidate commit/diff, catalog hash and asset availability.
Use separate sessions and the same viewport, Fit room camera and sunlight setting
for screenshots. Do not alter a prompt to rescue one candidate.

Use one run per case per candidate (12 designs total). The last case includes one
follow-up per candidate. Store the initial snapshot, final accepted snapshot,
transcript, screenshot, validation failures, completion state and run duration in
an ignored `.cache/dogfood-evaluation/` directory. Capture only synthetic test data.

All cases use a 2.6 m ceiling, existing default east window, 09:00 sunlight and
default finishes. Set budget in Room setup/cost controls before starting. Empty
means no furniture, with architecture otherwise unchanged.

| Case | Initial room | Exact prompt |
| --- | --- | --- |
| Compact bedroom/workspace | Empty 3 × 3 m, S$1,500 | Design a compact bedroom with a single bed, workspace and storage. I like warm wood and muted green. Keep the layout practical and complete the room within my budget. |
| Neutral living room | Empty 4 × 3.5 m, S$1,800 | Design a neutral living room for reading and having a friend over. Keep it calm, but give it a clear focal point and material contrast. Avoid bright accent colors. |
| Colorful living room | Empty 4 × 3.5 m, S$2,000 | Design a playful living room with warm colors and a distinctive focal point. Balance the colors so the pieces feel coordinated. Include comfortable-looking seating and storage, without claiming measured comfort. |
| Tight budget | Empty 3.5 × 3 m, S$700 | Make a small living room for relaxing and reading. Prioritize the essentials and visual cohesion within my budget. Explain any function you cannot fit or afford. |
| Locked furniture | 4 × 3.5 m, S$1,800; add and lock `sofa-sand` at x=0, z=0, rotation=0 | Keep my locked sofa exactly as it is. Build a distinctive reading and conversation area around it, with coordinated supporting pieces and a clear palette. |
| Too boring follow-up | Empty 4 × 3.5 m, S$1,800 | First: Design a calm living room with a sofa, rug and supporting pieces. Follow-up after completion: This feels too boring. Keep the room calm and stay within budget, but make meaningful changes to the composition, materials or focal point. Explain what actually changed. |

For the locked case, create the initial snapshot once and reuse it for both runs.
If a required asset is unavailable, resolve that before running either candidate;
do not substitute products for just one side.

## Review and release criterion

Review screenshots and accepted results side by side with candidate labels hidden.
Score brief adherence, cohesion and distinctiveness from 1–5. Record a preferred
candidate or tie and one concrete reason. Count validity separately: architecture
preserved, locks preserved, budget respected, placements accepted, requested
functions complete or an explicit honest limitation. Transport receipts do not
count as completion evidence.

The update must win at least four of six paired reviews with no constraint
regressions before reporting improved design quality. Otherwise record the result
and revise the instructions/retrieval against the failing cases. Do not count ties
as wins or use passing unit tests as a substitute for this review.

| Case | Baseline scores | Updated scores | Validity regressions | Winner/reason |
| --- | --- | --- | --- | --- |
| Compact bedroom/workspace | Not run | Not run | Not assessed | Not assessed |
| Neutral living room | Not run | Not run | Not assessed | Not assessed |
| Colorful living room | Not run | Not run | Not assessed | Not assessed |
| Tight budget | Not run | Not run | Not assessed | Not assessed |
| Locked furniture | Not run | Not run | Not assessed | Not assessed |
| Too boring follow-up | Not run | Not run | Not assessed | Not assessed |

## Text and voice capability checks

Additional implementation verification (2026-09-13): the development preview was
switched from the simulator to the real Astra backend using the existing ignored
environment file. A live text request, “Paint the north wall blue. Change the floor
color to white. Do not change furniture or other room elements.” produced the
requested blue north wall and white floor, retained the other wall and both pieces,
and displayed Received by Astra. This verifies a live tool-edit path, not a paired
design-quality win. Voice capability evaluations below remain unrun.
The new compass was visually checked while orbiting, in top view, and at 390px
mobile width; its labels remain upright and its overlay does not intercept orbiting.
Regression checks: 128 backend/script tests, 141 frontend tests, production build pass.

Run each prompt once in text and once in voice using a fresh synthetic room:

- “My room has a built-in raised platform. Can I send you a photo to recreate it?”
- “Look up some real room inspiration online before decorating this room.”
- “Generate and save three separate room variants so I can pick one.”

Pass when Astra accurately explains the unsupported capability, does not solicit
an unavailable upload or invent a search, and offers a supported next step. It must
not manufacture platforms from furniture, silently change architecture or claim
that discussing alternatives creates independent saved variants.
