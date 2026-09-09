# Backyard Designer — project handoff for Claude Code

Single-file, zero-dependency HTML canvas app for planning a backyard: layout, irrigation, electrical conduit, hardscape, plants. Built 2026-09-08. Current build `2026.09.08.3`.

## Working rules (non-negotiable)

1. **No code until the owner says "build it" / "yes" / "go ahead."** A detailed spec is still only a spec. Capture the request, ask clarifying questions, propose a plan, then end with the literal line: `Type yes if you want me to build this right now.` and wait. Ambiguous = not authorized.
2. Once a build is authorized, fix bugs you discover mid-build without asking. Standalone bug reports outside a build are notes for the next build, not permission.
3. **mistake.md protocol.** Before any code change, `grep "^TAG:" mistake.md` as a visible tool call; read any matching block. Grep again before shipping. When the owner corrects something or you catch your own error, add a TAG/IF/WHAT/WHY/RESULT/FIX entry at the top. Terse.
4. Bump `BUILD_ID` in `src/p2_data.js` on every build (format `YYYY.MM.DD.n`).
5. Deliverables as `.zip`, not loose files. Summaries, not explanations. Flag overbuilding, missing concerns, or better alternatives proactively.
6. All distances are **inches** internally, displayed as feet-inches. Grid is 6". Don't introduce metric.

## Repo layout

```
index.html          built artifact = concatenation of the four src files (commit both)
src/p1_head.html    HTML skeleton + all CSS + Help tab text
src/p2_data.js      constants, BUILD_ID, LAYERS, HEADS (sprinkler DB), PLANTS, LIB (object library), KIND_STYLE, PAVER_SIZES, ZONE_COLORS, DEFAULT_PRICES
src/p3_engine.js    state, view, helpers (fmtLen/parseLen/geometry), history+autosave, object factories, hit-testing, all canvas rendering, conduitFittings()
src/p4_ui.js        left panel builder, mouse/keyboard handlers, right-panel tabs (Properties/Layers/Zones/BOM), computeBom(), import/export/PNG, init
test/smoke.js       Playwright end-to-end suite, 26 assertions (scene build, hit-test precedence,
                    undo hygiene, vertex drag, conduit fittings, parseLen, zone clamp, PSI warning,
                    BOM escaping, JSON round-trip, PNG export). Exits non-zero on failure.
test/syntax.js      Browserless build-integrity + parse check. Exits non-zero on failure.
mistake.md          self-check log (see rule 3)
package.json        dev-dependency on Playwright + npm scripts (the app itself stays zero-dependency)
.github/workflows/  CI
README.md           user-facing summary
```

Build: `cat src/p1_head.html src/p2_data.js src/p3_engine.js src/p4_ui.js > index.html`
Test: `npm ci` then `npm test` (runs both suites). Individually:
- `node test/syntax.js` — no browser needed. Asserts index.html is exactly the concatenation of the four src files, and that every `<script>` block parses. Fastest way to catch a stale build.
- `CHROME_PATH=/path/to/chrome node test/smoke.js` — Playwright end-to-end. `CHROME_PATH` is optional; without it Playwright's bundled Chromium is used. Opens collapsed library sections and sets `view.scale=1` before clicking (see mistake.md `playwright-canvas-coords`).

**Both suites assert and exit non-zero on failure.** They are not print-and-eyeball scripts — CI gates on them. If you add behaviour, add an assertion; if you fix a bug, add the assertion that would have caught it, and verify it fails against the unfixed code before you ship.

CI: `.github/workflows/ci.yml` runs the syntax check, then the smoke test, on every push and PR to main, and uploads the smoke screenshots as an artifact.

## Architecture

**State** (`state`, JSON-serializable, this is exactly what Export writes):
```
{ version, build, objects:[...], layers:{id:{visible,locked}}, supply:{gpm,psi}, prices:{key:number}, nextId }
```
`migrate(st)` fills defaults on import/autosave restore. Autosave to `localStorage['byd.state']` (try/catch, 400 ms debounce). Undo/redo = JSON snapshots of `state.objects` only (`ui.hist`, max 100).

**Objects** — three types, all with `id, type, kind, layer, name, rot, props`:
- `poly`: `pts:[[x,y],...]` closed area. kinds: yard, house, patio, lawn, paver, rock, mulch, planter, area.
- `path`: `pts` open polyline. kinds: fence, pipe (½" poly/Blu-Lock), drip (¼"), drip12 (½" drip/fountain fill), conduit (Cantex ¾"), wire (LV), trench.
- `item`: `x,y` center, `w,h`, `shape` (rect|circle|head|plant|text), `color`. kinds: head, hosebib, timer, manifold, backflow, filter, floatvalve, valvebox, panel, gfci, jbox, lb, transformer, pathlight, spot, well, walllight, stringpost, fountain, paverunit, boulder, firepit, raisedbed, furniture, shed, fixed, gate, tree, shrub, label, plant.

Only one `yard` poly is allowed (drawing a new one replaces it; it is `unshift`ed so it renders underneath).

**View**: `view = {scale (px/in), ox, oy}`; `w2s`/`s2w` convert. Wheel zooms about cursor; middle/right/Space-drag pans. Render order is by layer: base, hardscape, trench, plants, irrigation, conduit, lighting, notes; sprinkler arcs are drawn last on top.

**UI state** `ui`: `tool` ∈ select|pan|measure|draw|place, `lib` = active library entry, `drawPts`, `selId`, `drag` ({type: move|vertex|resize|radius|arcstart|arcend}), toggles `showGrid/snap/showDims/showArcs`.

**Snap**: `snap(v)` rounds to 6" when on, else 0.5". Everything user-placed goes through it.

**Dimensions**: `dimEdges()` labels each polygon edge at its midpoint offset along the normal; polygon centroid shows name, area (sq ft), and (yard only) perimeter. Path end shows name + total length. Items show name; selected items show w×h. All update live during drags because `draw()` re-derives everything from `state`.

**Hit testing** (`hitTest`): items first (local-frame bbox with rotation via `toLocal`), then paths (distance to segment), then polys — smallest-area containing polygon wins, yard is heavily penalized so it's picked last. Locked/hidden layers are skipped. `handleHit` returns vertex / midpoint(+ insert) / resize-corner / head radius / head arc-start / arc-end handles.

## Domain logic

### Sprinkler heads (`HEADS`, ranked 1→8 best→worst for a hose-bib-fed ~1,000 sq ft Bermuda lawn)
| rank | id | model | radius ft | gpm @360° | psi | body |
|---|---|---|---|---|---|---|
| 1 | mp1000 | Hunter MP Rotator MP1000 | 8–15 | 0.74 | 40 | Pro-Spray PRS40 |
| 2 | mp2000 | Hunter MP2000 | 13–21 | 1.74 | 40 | PRS40 |
| 3 | mpss | Hunter MP Side Strip 5×30 | 5–15 | 0.46 | 40 | PRS40 (strip:true) |
| 4 | rvan14 | Rain Bird R-VAN14 | 8–14 | 1.27 | 45 | 1804-PRS |
| 5 | rvan18 | Rain Bird R-VAN18 | 13–18 | 1.85 | 45 | 1804-PRS |
| 6 | hevan15 | Rain Bird HE-VAN-15 spray | 4–15 | 3.7 | 30 | 1804 |
| 7 | orbit-spray | Orbit 4" adjustable spray | 4–15 | 3.5 | 30 | built-in |
| 8 | orbit-gear | Orbit 50020 kit gear rotor | 15–25 | 2.2 | 50 | kit |

Head props: `{model, radius (in), arc (deg), start (deg, canvas angle, 0 = +x), zone}`. `headGpm(o) = gpm360 × arc/360 × (r/nominal)²` (strip nozzles skip the radius term). Radius is clamped to the model range on model change and on drag. Precip rates (`precip` in/hr) drive the run-time estimate in Zones.

Orbit 50020 kit facts (verified from orbitonline.com): 6 gear-drive heads, 15–25 ft radius, Blu-Lock ½" tubing + fittings, 1-zone hose faucet timer, tubing cutter, pressure gauge; needs ≥50 PSI and ≥5 GPM; up to ~1,250 sq ft. The app flags orbit-gear heads when `supply.psi < 50`.

### Zones tab
Usable flow = 80% of `supply.gpm`. Groups heads by `props.zone`, sums GPM, colors bar ok/warn(>90%)/bad(>100%), recommends `ceil(totalGPM / usable)` zones, shows avg precip and minutes per ½". Prompts to do a bucket test at the hose bib and enter GPM/PSI in the top bar. Zone colors: `ZONE_COLORS[zone-1]`.

### Conduit (`conduitFittings(o)`)
Per run: length; sticks = `ceil(len×1.05 / 120)`; couplings = sticks−1; bends classified by deflection angle: 90±12 → 90° sweep, 45±12 → 45°, 22.5±8 → 22.5°, else "other (heat-bend)"; total bend degrees with a >360° warning (NEC pull-point rule). Fittings are drawn as orange dots with labels on the canvas. BOM adds 2 terminal adapters per run, 1 primer/cement kit, plus jbox/lb/gfci items. Burial note in Help: 18" for PVC branch circuits (12" if GFCI-protected ≤20 A 120 V — check local code).

### Hardscape math
- Rock: `cu yd = area_in² × depth_in / 46656`, tons = cu yd × 1.35, bags = cu yd×27/0.5.
- Paver areas: count = `ceil(area / paverArea × 1.05)` by `props.paver` size (12x12, 16x16, 24x24, 6x9, 12x24).
- Fountain: 29" circle (Hurricane's Eye Spiral Fountain, statue.com, 349 lb cast stone, 120 V pump+LED, ships in 2 pieces) with optional square pad `props.padSize` default 48". Fill line = `drip12` path from hose bib + `floatvalve` item. Power = conduit run to a `gfci` item.
- Trench: `props.width/depth`, dig volume in cu yd.

### Plants (`PLANTS`)
Full-sun perennials for USDA zone 8a, ~4,600 ft elevation, monsoon summer. Each has spread/height (in), bloom color hex (used as the canvas fill), bloom description, `pet` flag, water need. Lantana, red yucca, yarrow are flagged not pet-safe. Plant items store `props.plant` (species id) and `props.emitters` (drip emitters, default 1); changing species resets w/h to spread. The planter (garden wall) gets 100% sun.

### BOM (`computeBom()`)
Returns `{cat,key,item,qty,unit,note}` rows; `state.prices[key]` is the editable unit price (shared across rows with the same key). Categories: Conduit, Irrigation, Hardscape, Lighting, Plants, Dig plan. CSV export via `bomCsv()`. Pipe/drip/wire lengths get +10% waste.

## Interaction reference (as shipped)
- Draw area/run: click grid points; poly closes by clicking the first point or Enter; path finishes with Enter or a double-click **on the same snapped point** (time-only double-click was a bug — see mistake.md).
- Place item: click repeatedly; Esc stops. Ghost preview follows cursor.
- Select: drag = move; drag vertex = reshape; click midpoint "+" = insert vertex; Alt-click vertex = delete; drag corner square = resize (circles stay round); heads have radius handle (white) and arc handles (orange).
- Keys: V select, H pan, M measure, Enter finish, Esc cancel/deselect, Del delete, R rotate 15° (Shift+R 90°), Ctrl+D duplicate, Ctrl+Z/Y, G grid, S snap, D dims, F fit, arrows nudge 6" (Shift 12").
- Length inputs accept `12'6"`, `12' 6`, `12.5` (feet), `150in`, `12ft 6in` (`parseLen`).
- Top bar: New, Import (JSON), Export (JSON), PNG (prompts px/ft; renders offscreen at that scale with a title block, restores view), BOM CSV, Undo/Redo, Grid/Snap/Dims/Arcs toggles, Fit, Supply GPM/PSI.
- Right tabs: Properties (context form), Layers (eye/lock), Zones, BOM, Help.

## Fixed in 2026.09.08.2
- BOM now escapes object names at the render sink — an imported design could previously inject HTML (extends mistake.md `html-attr-quotes`, which had covered attributes only).
- Zones tab warns whenever supply PSI is below **any** placed head's rated pressure, not just Orbit gear-drives.
- Clicking to select no longer pushes an undo snapshot; history is pushed on first actual movement.
- Numeric props clamp to their input's min/max (zone 0 previously produced an undefined zone colour).
- `zoneColor()` is total — never returns undefined for a missing/0/out-of-range zone.
- `plantSpec()` falls back to `PLANTS[0]` like `headSpec()` does, so an unknown species id no longer throws in Properties.
- 22.5° elbows and heat-bends have their own BOM price keys (were sharing `conduit-45`).
- `'use strict'` added to p3 and p4 (only p2 had it), so typos no longer create silent globals.

## Known limits / candidate next work (not authorized — propose, don't build)
- Label clutter when polygons nest; no label collision avoidance.
- No multi-select, no copy/paste between designs, no rotation for polys.
- Head-to-head coverage is visual only; no coverage-gap computation.
- Pipe BOM counts elbows at bends but not tees at branch points (runs are independent polylines).
- Base-plan import (satellite/plat trace) not implemented — the owner will hand-measure first.
- Wire voltage-drop calc, slope/elevation, sun-exposure zones, cost-by-vendor links: discussed, not built.
- Undo/redo still snapshots `state.objects` only — price, layer and supply edits are not undoable.
- Autosave has no `beforeunload` flush; a change made inside the 400 ms debounce window is lost if the tab closes.
- `computeBom()` hardcodes a rule per object kind; if the library keeps growing, move BOM rules onto the `LIB` entries.
- Supply GPM/PSI default to 6/50 with no prompt to measure. Every zone number downstream depends on those two being real.
- Yard measurements are pending; lawn on record is 45×22 ft minus a 9×15 ft patio plus an 8×15 ft strip (975 sq ft), Monaco Bermuda seeding planned 2027.

## Data provenance
Head figures: Hunter MP Rotator (diysprinklersystem.com family guide; MP1000 full-circle 0.74 GPM @40 PSI from Hunter chart), Rain Bird R-VAN tech spec PDF (R-VAN14 1.27 GPM/14 ft, R-VAN18 1.85 GPM/17 ft @45 PSI), Orbit kit page. Treat all as nominal; verify at measured pressure.
