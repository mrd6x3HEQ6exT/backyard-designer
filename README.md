# Backyard Designer

Single-file backyard planning tool. Open `index.html` in Chrome/Edge/Firefox — no server, no install.

- 6" snap grid, feet-inch dimensions that update as you drag vertices
- Yard outline, patio, lawn, pavers, rock, planter wall, mulch beds
- Runs: ½" poly sprinkler pipe, ¼"/½" drip, Cantex ¾" conduit (fittings auto-counted at bends, 360° bend check), LV wire, fence, trench
- Sprinkler head database ranked best→worst for a hose-bib system, spray arcs to scale, per-zone GPM vs your supply
- Fountain (29" Hurricane's Eye) with base pad, float valve, GFCI, lighting, full-sun perennials with pet-safety flags
- Layers with visibility/lock, undo/redo, autosave to browser storage
- Export/import JSON, PNG at chosen scale, BOM as CSV with editable prices

Build: `npm run build` (plain `cat src/p1_head.html src/p2_data.js src/p3_engine.js src/p4_ui.js > index.html`)
Test: `npm ci && npm test` — a browserless build-integrity/syntax check plus a 26-assertion Playwright
end-to-end suite. Both exit non-zero on failure and run in CI on every push.

Data notes: head radius/GPM are manufacturer nominal values; verify against nozzle charts at your measured pressure. Do a bucket test at the hose bib and enter the GPM/PSI in the top bar.
