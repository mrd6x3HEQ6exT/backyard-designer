// End-to-end smoke test. Builds a scene, exercises editing, and ASSERTS.
// Exits non-zero on any failed assertion or page error, so CI can gate on it.
//   CHROME_PATH=<chromium> node test/smoke.js
const { chromium } = require('playwright');

let failed = 0;
const ok = m => console.log('  pass  ' + m);
const bad = m => { console.error('  FAIL  ' + m); failed++; };
const assert = (cond, m) => cond ? ok(m) : bad(m);
const eq = (got, want, m) => JSON.stringify(got) === JSON.stringify(want)
  ? ok(m + ' (' + JSON.stringify(got) + ')')
  : bad(m + ': expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept('48'));
  await page.goto('file://' + require('path').resolve(__dirname, '../index.html'));
  await page.waitForTimeout(300);

  // mistake.md playwright-canvas-coords: open collapsed sections and fit the scene before clicking.
  await page.evaluate(() => { document.querySelectorAll('.sec.closed').forEach(s => s.classList.remove('closed')); view.scale = 1; view.ox = 40; view.oy = 40; draw(); });
  const click = async id => page.click('.libitem[data-id="' + id + '"]');
  const pt = async (x, y) => page.evaluate(([x, y]) => { const r = canvas.getBoundingClientRect(); const s = w2s([x, y]); return [s[0] + r.left, s[1] + r.top]; }, [x, y]);
  const cw = async (x, y) => { const p = await pt(x, y); await page.mouse.click(p[0], p[1]); };

  console.log('\n--- build scene ---');
  await click('yard');     await cw(0, 0); await cw(45 * 12, 0); await cw(45 * 12, 30 * 12); await cw(0, 30 * 12); await page.keyboard.press('Enter');
  await click('patio');    await cw(0, 0); await cw(9 * 12, 0); await cw(9 * 12, 15 * 12); await cw(0, 15 * 12); await page.keyboard.press('Enter');
  await click('lawn');     await cw(9 * 12, 0); await cw(45 * 12, 0); await cw(45 * 12, 22 * 12); await cw(9 * 12, 22 * 12); await page.keyboard.press('Enter');
  await click('conduit');  await cw(0, 20 * 12); await cw(20 * 12, 20 * 12); await cw(20 * 12, 28 * 12); await cw(30 * 12, 28 * 12); await page.keyboard.press('Enter');
  await click('head');     await cw(9 * 12, 0); await cw(45 * 12, 0); await cw(9 * 12, 22 * 12); await cw(45 * 12, 22 * 12); await page.keyboard.press('Escape');
  await click('fountain'); await cw(30 * 12, 28 * 12); await page.keyboard.press('Escape');
  await click('gfci');     await cw(33 * 12, 28 * 12); await page.keyboard.press('Escape');
  await click('plant-gaillardia'); await cw(5 * 12, 25 * 12); await cw(8 * 12, 25 * 12); await page.keyboard.press('Escape');
  await click('rock');     await cw(0, 22 * 12); await cw(9 * 12, 22 * 12); await cw(9 * 12, 30 * 12); await cw(0, 30 * 12); await page.keyboard.press('Enter');
  await page.evaluate(() => { view.scale = 1; view.ox = 40; view.oy = 40; draw(); });
  await page.waitForTimeout(200);

  const kinds = await page.evaluate(() => state.objects.map(o => o.kind).sort());
  eq(kinds, ['conduit', 'fountain', 'gfci', 'head', 'head', 'head', 'head', 'lawn', 'patio', 'plant', 'plant', 'rock', 'yard'], 'scene objects created');

  console.log('\n--- hit-test precedence ---');
  await page.keyboard.press('v');
  await cw(22 * 12, 15 * 12);
  eq(await page.evaluate(() => state.objects.find(o => o.id === ui.selId) && state.objects.find(o => o.id === ui.selId).kind), 'lawn', 'click inside lawn selects lawn, not yard');
  await cw(22 * 12, 26 * 12);
  eq(await page.evaluate(() => state.objects.find(o => o.id === ui.selId) && state.objects.find(o => o.id === ui.selId).kind), 'yard', 'click in yard-only area selects yard');

  console.log('\n--- selection does not pollute undo history ---');
  const histBefore = await page.evaluate(() => ui.hist.length);
  await cw(22 * 12, 15 * 12);
  await cw(22 * 12, 26 * 12);
  eq(await page.evaluate(() => ui.hist.length), histBefore, 'two selection clicks push no history entries');

  console.log('\n--- vertex drag + undo ---');
  const before = await page.evaluate(() => JSON.stringify(state.objects.find(o => o.kind === 'yard').pts));
  const v = await pt(45 * 12, 30 * 12), v2 = await pt(50 * 12, 30 * 12);
  await page.mouse.move(v[0], v[1]); await page.mouse.down(); await page.mouse.move(v2[0], v2[1], { steps: 5 }); await page.mouse.up();
  const after = await page.evaluate(() => JSON.stringify(state.objects.find(o => o.kind === 'yard').pts));
  assert(before !== after, 'dragging a vertex changes the polygon');
  assert(await page.evaluate(() => state.objects.find(o => o.kind === 'yard').pts.some(p => p[0] === 600)), 'dragged vertex landed on the snapped 50 ft point');
  await page.keyboard.press('Control+z');
  eq(await page.evaluate(() => JSON.stringify(state.objects.find(o => o.kind === 'yard').pts)), before, 'Ctrl+Z restores the pre-drag polygon');

  console.log('\n--- conduit fittings ---');
  const cf = await page.evaluate(() => conduitFittings(state.objects.find(o => o.kind === 'conduit')));
  eq(cf.c90, 2, 'two 90-degree sweeps detected');
  eq(cf.totalDeg, 180, 'total bend degrees');
  assert(cf.totalDeg <= 360, 'run is within the NEC 360-degree pull-point limit');

  console.log('\n--- parseLen ---');
  eq(await page.evaluate(() => ['12\'6"', '12\' 6', '12.5', '150in', '12ft 6in', '7\''].map(parseLen)), [150, 150, 150, 150, 150, 84], 'length parsing');

  console.log('\n--- zone clamp (rejects 0) ---');
  const zone = await page.evaluate(() => {
    ui.selId = state.objects.find(o => o.kind === 'head').id; refresh();
    const i = document.querySelector('[data-numprop="zone"]');
    i.value = '0'; i.dispatchEvent(new Event('change'));
    return state.objects.find(o => o.id === ui.selId).props.zone;
  });
  eq(zone, 1, 'zone 0 clamps to the input minimum');
  assert(await page.evaluate(() => typeof zoneColor(0) === 'string' && typeof zoneColor(99) === 'string'), 'zoneColor never returns undefined');

  console.log('\n--- PSI warning covers every model, not just Orbit ---');
  const psiWarn = await page.evaluate(() => { state.supply.psi = 30; renderZones(); return document.querySelector('#tab-zones').innerText; });
  assert(/below rated pressure/i.test(psiWarn) && /Hunter/.test(psiWarn), 'low supply PSI warns about Hunter MP heads');
  await page.evaluate(() => { state.supply.psi = 50; renderZones(); });

  console.log('\n--- BOM escapes names (mistake.md html-attr-quotes, content sink) ---');
  const bomHtml = await page.evaluate(() => {
    state.objects.find(o => o.kind === 'rock').name = '<img src=x onerror=alert(1)>';
    renderBom(); return document.querySelector('#tab-bom').innerHTML;
  });
  assert(!/<img/i.test(bomHtml), 'injected tag is not live in the BOM');
  assert(/&lt;img/i.test(bomHtml), 'injected tag is present but escaped');
  assert(await page.evaluate(() => document.querySelectorAll('#tab-bom img').length === 0), 'no img element materialised in the BOM');
  await page.evaluate(() => { state.objects.find(o => o.kind === 'rock').name = 'Decorative rock'; renderBom(); });

  console.log('\n--- BOM contents ---');
  const bom = await page.evaluate(() => computeBom());
  const keys = bom.map(r => r.key);
  assert(keys.includes('conduit-stick'), 'conduit sticks in BOM');
  assert(keys.includes('head-mp1000'), 'sprinkler heads in BOM');
  assert(keys.includes('rock-ton'), 'decorative rock in BOM');
  assert(keys.includes('fountain'), 'fountain in BOM');
  assert(!keys.includes(undefined), 'every BOM row has a price key');
  assert(bom.every(r => r.qty > 0), 'no zero-quantity rows');

  console.log('\n--- survey: labels ---');
  eq(await page.evaluate(() => [0, 1, 25, 26, 27, 51, 52, 701, 702].map(alphaLabel)), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'], 'alphaLabel is spreadsheet-column order');
  eq(await page.evaluate(() => ['A', 'Z', 'AA', 'ZZ', 'AAA'].map(labelIndex)), [0, 25, 26, 701, 702], 'labelIndex inverts alphaLabel');
  const labels =() => page.evaluate(() => state.objects.filter(o => o.kind === 'spoint').map(o => o.props.label));
  await click('spoint'); await cw(10 * 12, 10 * 12); await cw(20 * 12, 10 * 12); await cw(30 * 12, 10 * 12); await page.keyboard.press('Escape');
  eq(await labels(), ['A', 'B', 'C'], 'three placed points are A, B, C');
  await page.evaluate(() => { const b = state.objects.find(o => o.kind === 'spoint' && o.props.label === 'B'); pushHist(); state.objects = state.objects.filter(o => o !== b); refresh(); });
  await click('spoint'); await cw(40 * 12, 10 * 12); await page.keyboard.press('Escape');
  eq(await labels(), ['A', 'C', 'D'], 'labels are stable: after deleting B the next point is D, not B');
  await click('spoint'); await cw(10 * 12, 20 * 12); await page.keyboard.press('Escape');
  eq((await labels()).pop(), 'E', 'placed E');
  await page.keyboard.press('Control+z');
  await click('spoint'); await cw(10 * 12, 20 * 12); await page.keyboard.press('Escape');
  eq((await labels()).pop(), 'E', 'undo rolls the label counter back: E again, not F');
  await page.evaluate(() => { ui.selId = state.objects.find(o => o.kind === 'spoint' && o.props.label === 'E').id; duplicateSel(); });
  eq((await labels()).pop(), 'F', 'Ctrl+D gives the copy a fresh label');
  await page.evaluate(() => { pushHist(); state.objects = state.objects.filter(o => !(o.kind === 'spoint' && (o.props.label === 'E' || o.props.label === 'F'))); refresh(); });

  console.log('\n--- survey: readings, benchmark, both units ---');
  const sv = await page.evaluate(() => {
    const P = l => state.objects.find(o => o.kind === 'spoint' && o.props.label === l);
    P('A').props.reading = parseMetric('1.000'); P('A').props.bench = true;
    P('C').props.reading = parseMetric('1.124');   // 12.4 cm lower than A
    P('D').props.reading = parseMetric('95cm');    // 5 cm higher than A
    refresh();
    return {
      parsed: [parseMetric('1.235'), parseMetric('1.235m'), parseMetric('123.5cm'), parseMetric('1235mm'), parseMetric('abc')],
      deltas: [deltaMm(P('A')), deltaMm(P('C')), deltaMm(P('D'))],
      cm: fmtCm(deltaMm(P('C'))), inch: fmtLen(mmToIn(deltaMm(P('C')))), up: fmtCm(deltaMm(P('D'))),
      canvasLabel: surveyLabel(P('C')), bmLabel: surveyLabel(P('A')),
      tab: document.querySelector('#tab-survey').innerText,
      layers: document.querySelector('#tab-layers').innerText,
    };
  });
  eq(sv.parsed.slice(0, 4), [1235, 1235, 1235, 1235], 'parseMetric accepts m, cm, mm');
  assert(Number.isNaN(sv.parsed[4]), 'parseMetric rejects garbage');
  eq(sv.deltas, [0, -124, 50], 'delta from benchmark: bench = 0, higher rod reading = lower ground');
  eq(sv.cm, '-12.4 cm', 'delta in cm');
  eq(sv.inch, '-5"', 'delta in inches (quarter-inch rounding)');
  eq(sv.up, '+5.0 cm', 'positive delta carries a + sign');
  eq(sv.canvasLabel, 'C -12.4 cm', 'canvas label shows point + delta');
  eq(sv.bmLabel, 'A BM', 'benchmark canvas label');
  assert(/Benchmark A/.test(sv.tab) && /-12\.4 cm/.test(sv.tab) && /-5"/.test(sv.tab) && /\+5\.0 cm/.test(sv.tab), 'survey tab lists deltas in both metric and inches');
  assert(/Highest D/.test(sv.tab) && /lowest C/.test(sv.tab) && /total fall 17\.4 cm/.test(sv.tab), 'survey tab finds high, low and total fall');
  assert(/Survey \/ grade/.test(sv.layers), 'survey layer appears in Layers tab');

  console.log('\n--- survey: slope ---');
  const sl = await page.evaluate(() => {
    const P = l => state.objects.find(o => o.kind === 'spoint' && o.props.label === l);
    const s = slopeBetween(P('A'), P('C'));
    state.slope = { a: P('A').id, b: P('C').id }; renderSurvey();
    return { run: s.run, riseMm: s.riseMm, pct: +s.pct.toFixed(2), ipf: +s.inPerFt.toFixed(2), tab: document.querySelector('#tab-survey').innerText };
  });
  eq([sl.run, sl.riseMm], [240, -124], 'slope A→C: run 20 ft, rise −124 mm');
  eq(sl.pct, -2.03, 'slope percent');
  eq(sl.ipf, -0.24, 'slope in/ft');
  assert(/-2\.03%/.test(sl.tab) && /-0\.24 in\/ft/.test(sl.tab) && /falls from A to C/.test(sl.tab), 'slope shown in the Survey tab in both units with direction');

  console.log('\n--- survey: benchmark exclusivity, CSV, migrate ---');
  await page.evaluate(() => { ui.selId = state.objects.find(o => o.kind === 'spoint' && o.props.label === 'C').id; refresh(); const i = document.querySelector('[data-bench]'); i.checked = true; i.dispatchEvent(new Event('change')); });
  eq(await page.evaluate(() => state.objects.filter(o => o.kind === 'spoint' && o.props.bench).map(o => o.props.label)), ['C'], 'ticking Benchmark on C clears it on A');
  const csv = await page.evaluate(() => surveyCsvText());
  assert(/^Point,Reading_m,Delta_cm,Delta_in/.test(csv) && csv.trim().split('\n').length === 4, 'survey CSV has header + one row per point');
  assert(/"A","1\.000"/.test(csv) && /"C","1\.124","0\.0","0\.00"/.test(csv), 'CSV rows carry reading and delta');
  const mig = await page.evaluate(() => { const st = JSON.parse(JSON.stringify(state)); delete st.nextLabel; delete st.slope; migrate(st); return [st.nextLabel, JSON.stringify(st.slope)]; });
  eq(mig, [4, '{"a":null,"b":null}'], 'migrate derives nextLabel = max surviving label + 1 (A,C,D → 4) and defaults slope');
  await page.evaluate(() => { ui.selId = null; refresh(); });

  console.log('\n--- measured layout: typed lengths, ortho, closing gap ---');
  const pl = await page.evaluate(() => ['30.17ft', '30.17 ft', '30.17', "30.17'"].map(parseLen).map(v => Math.round(v * 100) / 100));
  eq(pl, [362.04, 362.04, 362.04, 362.04], 'parseLen reads 30.17ft (and variants) as 362.04 in');
  const mv = async (x, y) => { const q = await pt(x, y); await page.mouse.move(q[0], q[1]); };
  // Generic area below the yard so nothing else is under the cursor. Sides: 30.17 E, 20 S (ortho), 30.17 W, 19.5 N -> 6" short of start.
  await click('area'); await cw(5 * 12, 32 * 12);
  await mv(40 * 12, 32 * 12); await page.keyboard.type('30.17'); await page.keyboard.press('Enter');
  await mv(30 * 12, 60 * 12); await page.keyboard.type('20'); await page.keyboard.press('Shift+Enter');   // cursor ~10 deg off vertical (outside the 5 deg gravity); Shift forces 90
  await mv(0, 52 * 12);       await page.keyboard.type('30.17'); await page.keyboard.press('Enter');
  eq(await page.evaluate(() => ui.drawPts), [[60, 384], [422.04, 384], [422.04, 624], [60, 624]], 'typed sides land exactly (362.04 in, not snapped to 6"); ortho straightened the off-axis side');
  await mv(5 * 12, 20 * 12);  await page.keyboard.type('19.5'); await page.keyboard.press('Enter');
  const area = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'area'); return { n: o && o.pts.length, hint: document.querySelector('#hint').textContent, drawing: ui.drawPts.length }; });
  eq([area.n, area.drawing], [4, 0], 'a typed closing side within 12" of the start closes the polygon without adding a 5th vertex');
  assert(/Closing gap 6"/.test(area.hint), 'closing gap of 6" is reported: ' + JSON.stringify(area.hint));
  await page.keyboard.press('Escape');
  eq(await page.evaluate(() => ui.tool), 'select', 'Escape after closing returns to select');
  const badLen = await page.evaluate(() => { const lb = document.querySelector('#lenBox'); return lb.hidden; });
  assert(badLen === true, 'length box is hidden when not drawing');
  // Regression: focusing the length box near the right edge used to scroll #canvasWrap (overflow:hidden is still
  // a scroll container), shifting the canvas under the cursor and firing mouseleave -> direction lost.
  await click('fence'); await cw(70 * 12, 40 * 12); await mv(74 * 12, 40 * 12);   // cursor ~20 px from the canvas' right edge at this zoom
  await page.keyboard.press('1');
  const edge = await page.evaluate(() => { const w = document.querySelector('#canvasWrap'), lb = document.querySelector('#lenBox'), r = lb.getBoundingClientRect(), c = canvas.getBoundingClientRect(); return { scroll: [w.scrollLeft, w.scrollTop], inside: r.right <= c.right + 1 && r.bottom <= c.bottom + 1, mouseW: ui.mouseW !== null, open: !lb.hidden }; });
  eq([edge.scroll, edge.inside, edge.mouseW, edge.open], [[0, 0], true, true, true], 'length box at the canvas edge: clamped inside, no scroll, cursor still tracked');
  await page.keyboard.type('0'); await page.keyboard.press('Enter');
  eq(await page.evaluate(() => ui.drawPts[1]), [960, 480], 'typed 10 ft at the edge lands due east of the first point');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // Gravity must not over-reach: a deliberate 30-degree side stays at 30, it is not pulled to 45.
  await click('fence'); await cw(5 * 12, 40 * 12); await mv(5 * 12 + 200, 40 * 12 + 115.47); await page.keyboard.type('10'); await page.keyboard.press('Enter');
  eq(await page.evaluate(() => ui.drawPts[1]), [163.92, 540], 'a 30-degree cursor direction gives a 30-degree side (1-degree steps, no 45-degree pull)');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  eq(await page.evaluate(() => [ui.drawPts.length, ui.tool]), [0, 'select'], 'Escape twice cancels the path and returns to select');

  console.log('\n--- measured layout: edge edit + units toggle ---');
  await page.evaluate(() => { ui.selId = state.objects.find(x => x.kind === 'area').id; refresh(); const i = document.querySelector('[data-edge="0"]'); i.value = '40'; i.dispatchEvent(new Event('change')); });
  eq(await page.evaluate(() => state.objects.find(x => x.kind === 'area').pts[1]), [540, 384], 'editing edge 1 to 40 ft slides vertex 2 along the edge to exactly 480 in from vertex 1');
  await page.evaluate(() => { const i = document.querySelector('[data-edge="0"]'); i.value = 'garbage'; i.dispatchEvent(new Event('change')); });
  eq(await page.evaluate(() => [state.objects.find(x => x.kind === 'area').pts[1], document.querySelector('[data-edge="0"]').value]), [[540, 384], "40'"], 'garbage edge input is rejected and the field restored');
  await page.click('#btnUnits');
  const u = await page.evaluate(() => ({ units: state.units, s: fmtLen(362.04), neg: fmtLen(-124 / 25.4), back: parseLen(fmtLen(362.04)), btn: document.querySelector('#btnUnits').textContent, edge: document.querySelector('[data-edge="2"]').value, lib: document.querySelector('.libitem[data-id="paver16"] .dim').textContent }));
  eq([u.units, u.s, u.btn], ['decft', '30.17 ft', 'ft.dec'], 'units toggle switches display to decimal feet');
  eq(u.neg, '-0.41 ft', 'negative lengths keep their sign in decimal feet');
  assert(Math.abs(u.back - 362.04) < 1e-6, 'decimal-feet display round-trips through parseLen');
  eq([u.edge, u.lib], ['30.17 ft', '1.33 ft×1.33 ft'], 'Edges table and library badges follow the units toggle');
  await page.click('#btnUnits');
  eq(await page.evaluate(() => [state.units, fmtLen(362.04)]), ['ftin', '30\'-2"'], 'toggle back to feet-inches');
  eq(await page.evaluate(() => { const st = JSON.parse(JSON.stringify(state)); delete st.units; migrate(st); return st.units; }), 'ftin', 'migrate defaults units for older files');
  await page.evaluate(() => { ui.selId = null; refresh(); });

  console.log('\n--- JSON round-trip ---');
  const n1 = await page.evaluate(() => state.objects.length);
  const json = await page.evaluate(() => JSON.stringify(state));
  await page.evaluate(j => { const st = JSON.parse(j); migrate(st); state = st; refresh(); }, json);
  eq(await page.evaluate(() => state.objects.length), n1, 'object count survives export/import');

  console.log('\n--- PNG export ---');
  await page.evaluate(() => { window.__png = null; const t = canvas.toBlob.bind(canvas); canvas.toBlob = cb => t(b => { window.__png = b ? b.size : 0; cb(b); }); });
  const viewBefore = await page.evaluate(() => JSON.stringify(view));
  await page.click('#btnPng');
  await page.waitForTimeout(1000);
  assert(await page.evaluate(() => window.__png > 0), 'PNG export produced a non-empty blob');
  eq(await page.evaluate(() => JSON.stringify(view)), viewBefore, 'PNG export restores the view');

  await page.click('#tabs button[data-tab="bom"]');   await page.screenshot({ path: __dirname + '/shot1.png' });
  await page.click('#tabs button[data-tab="zones"]'); await page.screenshot({ path: __dirname + '/shot2.png' });

  console.log('\n--- page errors ---');
  errs.length ? bad('page errors: ' + JSON.stringify(errs, null, 1)) : ok('no page or console errors');

  await browser.close();
  console.log(failed ? '\n' + failed + ' assertion(s) FAILED.' : '\nAll smoke assertions passed.');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\nTest harness crashed:', e); process.exit(1); });
