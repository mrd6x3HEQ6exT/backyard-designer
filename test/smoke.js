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
    P('A').props.reading = parseMetric('100'); P('A').props.bench = true;   // cm is the default unit
    P('C').props.reading = parseMetric('112.4');   // 12.4 cm lower than A
    P('D').props.reading = parseMetric('0.95m');   // 5 cm higher than A
    refresh();
    return {
      parsed: [parseMetric('123.5'), parseMetric('1.235m'), parseMetric('123.5cm'), parseMetric('1235mm'), parseMetric('abc')],
      deltas: [deltaMm(P('A')), deltaMm(P('C')), deltaMm(P('D'))],
      cm: fmtCm(deltaMm(P('C'))), inch: fmtLen(mmToIn(deltaMm(P('C')))), up: fmtCm(deltaMm(P('D'))),
      canvasLabel: surveyLabel(P('C')), bmLabel: surveyLabel(P('A')),
      tab: document.querySelector('#tab-survey').innerText,
      layers: document.querySelector('#tab-layers').innerText,
    };
  });
  eq(sv.parsed.slice(0, 4), [1235, 1235, 1235, 1235], 'parseMetric: bare number is cm; m, cm, mm suffixes work');
  assert(Number.isNaN(sv.parsed[4]), 'parseMetric rejects garbage');
  eq(sv.deltas, [0, -124, 50], 'delta from benchmark: bench = 0, higher rod reading = lower ground');
  eq(sv.cm, '-12.4 cm', 'delta in cm');
  eq(sv.inch, '-5"', 'delta in inches (quarter-inch rounding)');
  eq(sv.up, '+5.0 cm', 'positive delta carries a + sign');
  eq(sv.canvasLabel, 'C -12.4 cm', 'canvas label shows point + delta');
  eq(sv.bmLabel, 'A BM', 'benchmark canvas label');
  assert(/Benchmark A · reading 100\.0 cm/.test(sv.tab) && /-12\.4 cm/.test(sv.tab) && /-5"/.test(sv.tab) && /\+5\.0 cm/.test(sv.tab), 'survey tab shows the reading in cm and deltas in both metric and inches');
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
  assert(/^Point,Reading_cm,Delta_cm,Delta_in/.test(csv) && csv.trim().split('\n').length === 4, 'survey CSV has header + one row per point');
  assert(/^Point,Reading_cm/.test(csv) && /"A","100\.0"/.test(csv) && /"C","112\.4","0\.0","0\.00"/.test(csv), 'CSV rows carry reading (cm) and delta');
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

  console.log('\n--- undo while drawing, and undo that says what it did ---');
  await click('fence'); await cw(5 * 12, 44 * 12); await cw(15 * 12, 44 * 12); await cw(25 * 12, 44 * 12);
  const objsBefore = await page.evaluate(() => state.objects.length);
  await page.keyboard.press('Control+z');
  eq(await page.evaluate(() => [ui.drawPts.length, state.objects.length]), [2, objsBefore], 'Ctrl+Z mid-draw removes the last point, not an object');
  await page.keyboard.press('Backspace');
  eq(await page.evaluate(() => ui.drawPts.length), 1, 'Backspace mid-draw removes another point');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await click('gfci'); await cw(38 * 12, 5 * 12); await page.keyboard.press('Escape');
  const nG = await page.evaluate(() => state.objects.filter(o => o.kind === 'gfci').length);
  await page.keyboard.press('Control+z');
  const un = await page.evaluate(() => ({ hint: document.querySelector('#hint').textContent, n: state.objects.filter(o => o.kind === 'gfci').length }));
  eq(un.n, nG - 1, 'Ctrl+Z removed the just-placed GFCI');
  assert(/^Removed In-use GFCI.*Ctrl\+Y brings it back$/.test(un.hint), 'undo says what it removed and how to get it back: ' + JSON.stringify(un.hint));
  await page.keyboard.press('Control+y');
  const re = await page.evaluate(() => ({ hint: document.querySelector('#hint').textContent, n: state.objects.filter(o => o.kind === 'gfci').length }));
  eq(re.n, nG, 'Ctrl+Y brought it back');
  assert(/^Restored In-use GFCI.*Ctrl\+Z removes it again$/.test(re.hint), 'redo notice is contextual: ' + JSON.stringify(re.hint));
  eq(await page.evaluate(() => fmtLen(-0.04)), '0"', 'fmtLen never prints -0"');

  console.log('\n--- shapes: smooth curves, circle, rectangle ---');
  const cmath = await page.evaluate(() => { const c = circlePts(0, 0, 120); const g = curvePts(c, true); return { n: c.length, area: polyArea(g), perim: pathLen(g.concat([g[0]])), samples: g.length }; });
  eq([cmath.n, cmath.samples], [8, 64], 'circle = 8 control points, 64 curve samples');
  assert(Math.abs(cmath.area / (Math.PI * 120 * 120) - 1) < 0.002, 'corrected 8-point circle area within 0.2% of πr² (' + cmath.area.toFixed(0) + ' vs ' + (Math.PI * 14400).toFixed(0) + ')');
  assert(Math.abs(cmath.perim / (2 * Math.PI * 120) - 1) < 0.005, 'and perimeter within 0.5% of 2πr (' + cmath.perim.toFixed(1) + ' vs ' + (2 * Math.PI * 120).toFixed(1) + ')');
  await page.click('#areaShape button[data-shape="circle"]');
  await click('area'); await cw(30 * 12, 45 * 12); await cw(35 * 12, 45 * 12);
  const circ = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'area' && x.props.smooth); return o && { n: o.pts.length, smooth: o.props.smooth, area: objArea(o), drawing: ui.drawPts.length }; });
  assert(circ && circ.n === 8 && circ.smooth === true && circ.drawing === 0, 'circle mode: centre click + radius click makes an 8-point smooth area');
  assert(circ && Math.abs(circ.area / (Math.PI * 60 * 60) - 1) < 0.002, 'its area is that of a 5 ft radius circle (' + (circ && circ.area / 144).toFixed(1) + ' sq ft)');
  const bulge = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'area' && x.props.smooth); const a = Math.PI / 8; const p = [30 * 12 + Math.cos(a) * 58, 45 * 12 + Math.sin(a) * 58]; return { hit: hitTest(p) === o, insideChords: pointInPoly(p, o.pts) }; });
  eq([bulge.hit, bulge.insideChords], [true, false], 'hit-test follows the curve: a point outside the 8-gon but inside the circle selects it');
  await page.click('#areaShape button[data-shape="rect"]');
  await click('area'); await cw(38 * 12, 40 * 12); await page.keyboard.type('6x4'); await page.keyboard.press('Enter');
  const rc = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'area' && x.pts.length === 4 && x.pts[0][0] === 456); return o && { pts: o.pts, drawing: ui.drawPts.length, smooth: !!o.props.smooth }; });
  eq(rc && [rc.pts, rc.drawing, rc.smooth], [[[456, 480], [528, 480], [528, 528], [456, 528]], 0, false], 'rectangle mode: one corner + typed 6x4 makes a 6 ft × 4 ft rectangle, not smooth');
  await page.click('#areaShape button[data-shape="poly"]'); await page.keyboard.press('Escape');
  await click('fence'); await cw(30 * 12, 55 * 12); await cw(40 * 12, 55 * 12); await cw(40 * 12, 60 * 12); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  const sm = await page.evaluate(() => { const o = state.objects.filter(x => x.kind === 'fence').pop(); ui.selId = o.id; refresh(); const L0 = objLen(o); const cb = document.querySelector('[data-allsmooth]'); cb.checked = true; cb.dispatchEvent(new Event('change')); return { smooth: o.props.smooth, n: geomPts(o).length, L0, L1: objLen(o), edgesHidden: !document.querySelector('[data-edge]') }; });
  eq([sm.smooth, sm.n, sm.edgesHidden], [true, 17, true], 'Smooth tick: a 3-point fence becomes a 17-sample curve and the Edges table hides');
  assert(sm.L1 !== sm.L0 && sm.L1 > 0.9 * sm.L0 && sm.L1 < 1.3 * sm.L0, 'curved length differs sensibly from the polyline (' + sm.L0 + ' → ' + sm.L1.toFixed(1) + ')');
  eq(await page.evaluate(() => { ui.selId = state.objects.find(x => x.kind === 'conduit').id; refresh(); return [!!document.querySelector('[data-allsmooth]'), !!document.querySelector('[data-vt]')]; }), [false, false], 'conduit has no Smooth option and no anchor toggles');
  await page.evaluate(() => { ui.selId = null; refresh(); });

  console.log('\n--- anchors: corner/smooth, handles, mirror, reset, insert-on-curve, migration ---');
  const eqv = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'area' && allSmooth(x)); const a = geomPts(o), b = curvePts(o.pts, true); let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])); return { n: a.length, maxDiff: m }; });
  assert(eqv.maxDiff < 1e-6, 'automatic handles reproduce the previous Catmull-Rom curve exactly (max diff ' + eqv.maxDiff.toExponential(1) + ' in over ' + eqv.n + ' samples)');
  const st1 = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'area' && allSmooth(x)); ui.selId = o.id; setNodeType(o, 0, 'c'); setNodeType(o, 1, 'c'); refresh(); const s = spanPts(o, 0); const a = o.pts[0], b = o.pts[1]; const cross = Math.max(...s.map(p => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])))); const spans = curveSpans(o); const c = document.querySelector('[data-allsmooth]'); return { cross, straight: spans[0].straight, len0: spans[0].len, chord: dist(a, b), curvedNext: !spans[1].straight, cb: [c.checked, c.indeterminate], edgeInputs: document.querySelectorAll('[data-edge]').length }; });
  eq([st1.straight, st1.curvedNext, st1.edgeInputs], [true, true, 1], 'two corner anchors make a straight span between curved ones; only that edge gets a typed-length input');
  assert(st1.cross < 1e-9 && Math.abs(st1.len0 - st1.chord) < 1e-9, 'the straight span is exactly the chord');
  eq(st1.cb, [false, true], 'Smooth checkbox goes indeterminate on a mixed shape');
  await page.evaluate(() => { view.scale = 1; view.ox = 40; view.oy = 40; draw(); });
  const v0 = await page.evaluate(() => state.objects.find(x => x.id === ui.selId).pts[0]);
  const q0 = await pt(v0[0], v0[1]); await page.mouse.dblclick(q0[0], q0[1]);
  eq(await page.evaluate(() => nodeT(state.objects.find(x => x.id === ui.selId), 0)), 's', 'double-clicking a corner anchor makes it smooth');
  const hd = await page.evaluate(() => { const o = state.objects.find(x => x.id === ui.selId); const p = o.pts[0], ho = handleOut(o, 0); return { from: [p[0] + ho[0], p[1] + ho[1]], p, hi: handleIn(o, 0) }; });
  const hFrom = await pt(hd.from[0], hd.from[1]), hTo = await pt(hd.p[0] + 40, hd.p[1] - 25);
  await page.mouse.move(hFrom[0], hFrom[1]); await page.mouse.down(); await page.mouse.move(hTo[0], hTo[1], { steps: 4 }); await page.mouse.up();
  const mir = await page.evaluate(() => { const o = state.objects.find(x => x.id === ui.selId); const h = o.hnd[0]; return { o: h.o, i: h.i, dot: h.o[0] * h.i[0] + h.o[1] * h.i[1], cross: h.o[0] * h.i[1] - h.o[1] * h.i[0], Li: Math.hypot(h.i[0], h.i[1]) }; });
  assert(Math.abs(mir.o[0] - 40) < 0.6 && Math.abs(mir.o[1] + 25) < 0.6, 'dragging the outgoing handle puts it where the mouse went, not on the grid (' + JSON.stringify(mir.o) + ')');
  const sinA = Math.abs(mir.cross) / (Math.hypot(mir.o[0], mir.o[1]) * mir.Li); assert(mir.dot < 0 && sinA < 0.001, 'the incoming handle mirrored to stay collinear (opposite direction, ' + (Math.asin(sinA) * 180 / Math.PI).toFixed(3) + '° off — 1/100 in rounding)');
  const prevLi = Math.hypot(hd.hi[0], hd.hi[1]);
  assert(Math.abs(mir.Li - prevLi) < 0.05, 'mirroring keeps the opposite handle\'s own length (' + prevLi.toFixed(2) + ' → ' + mir.Li.toFixed(2) + ')');
  const hFrom2 = await pt(hd.p[0] + mir.o[0], hd.p[1] + mir.o[1]), hTo2 = await pt(hd.p[0] + 10, hd.p[1] + 50);
  await page.keyboard.down('Alt'); await page.mouse.move(hFrom2[0], hFrom2[1]); await page.mouse.down(); await page.mouse.move(hTo2[0], hTo2[1], { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const cusp = await page.evaluate(() => { const o = state.objects.find(x => x.id === ui.selId); return { o: o.hnd[0].o, i: o.hnd[0].i }; });
  assert(Math.abs(cusp.o[0] - 10) < 0.6 && Math.abs(cusp.o[1] - 50) < 0.6, 'Alt-drag moved the outgoing handle (' + JSON.stringify(cusp.o) + ')');
  eq(cusp.i, mir.i, 'and left the incoming handle alone — a cusp');
  const hAt = await pt(hd.p[0] + cusp.o[0], hd.p[1] + cusp.o[1]); await page.mouse.dblclick(hAt[0], hAt[1]);
  eq(await page.evaluate(() => state.objects.find(x => x.id === ui.selId).hnd[0].o), null, 'double-clicking a handle resets it to automatic');
  const ins = await page.evaluate(() => { const o = state.objects.find(x => x.id === ui.selId); const before = geomPts(o).map(p => p.slice()); const m = spanMid(o, 3); const n0 = o.pts.length; insertVertex(o, 4, [r2(m[0]), r2(m[1])]); const near = Math.min(...before.map(p => dist(p, o.pts[4]))); refresh(); return { n: o.pts.length, n0, t: nodeT(o, 4), near, hndLen: o.hnd.length }; });
  eq([ins.n, ins.n0, ins.t, ins.hndLen], [9, 8, 's', 9], 'inserting on a curved span adds a smooth anchor and keeps hnd parallel to pts');
  assert(ins.near < 0.01, 'the inserted anchor lies on the existing curve (' + ins.near.toFixed(4) + ' in off)');
  await page.evaluate(() => { document.querySelector('[data-vt="2"]').click(); });
  eq(await page.evaluate(() => nodeT(state.objects.find(x => x.id === ui.selId), 2)), 'c', 'the ○/□ button in the Vertices table flips an anchor');
  const mg = await page.evaluate(() => { const st = { objects: [{ id: 'z', type: 'path', kind: 'fence', layer: 'base', name: 'f', pts: [[0, 0], [10, 0], [10, 10]], rot: 0, props: { smooth: true } }, { id: 'y', type: 'poly', kind: 'area', layer: 'notes', name: 'a', pts: [[0, 0], [10, 0], [10, 10]], rot: 0, props: {} }] }; migrate(st); return st.objects.map(o => o.hnd.map(h => h.t).join('')); });
  eq(mg, ['sss', 'ccc'], 'migrate: props.smooth:true becomes all-smooth anchors, absent becomes all-corner');
  const cc = await page.evaluate(() => { const o = makePoly(libById('area'), circlePts(0, 0, 120), { smooth: true }); return objArea(o) / (Math.PI * 14400); });
  assert(Math.abs(cc - 1) < 0.002, 'circle area still within 0.2% of πr² under the anchor model (' + ((cc - 1) * 100).toFixed(3) + '%)');
  await page.evaluate(() => { ui.selId = null; refresh(); });

  console.log('\n--- walking paths ---');
  await click('walkrock'); await cw(5 * 12, 55 * 12); await cw(25 * 12, 55 * 12); await page.keyboard.press('Enter');
  const wr = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'walkrock'); const rows = computeBom().filter(r => /River rock path|Landscape edging/.test(r.item)); return { smooth: o.props.smooth, width: o.props.width, len: objLen(o), rows: rows.map(r => [r.key, r.qty, r.unit]) }; });
  eq([wr.smooth, wr.width, wr.len], [null, 36, 240], 'river rock path: square corners by default, 3 ft wide; a straight 2-point run is 20 ft');
  eq(wr.rows, [['rock-ton', 0.75, 'ton'], ['edging-ft', 40, 'ft']], 'BOM: 0.75 ton of rock (20 × 3 ft at 3"), 40 ft of edging');
  await click('walkstep'); await cw(5 * 12, 62 * 12); await cw(25 * 12, 62 * 12); await page.keyboard.press('Enter');   // 7 ft below the rock path: two 3 ft wide runs must not overlap for the hit-test below
  const ws = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'walkstep'); return { stones: stoneCount(o), row: computeBom().find(r => /Stepping stones/.test(r.item)).qty, rock: computeBom().find(r => /rock between stones/.test(r.item)).qty }; });
  eq([ws.stones, ws.row], [10, 10], 'stepping stones: 20 ft at 24" o.c., first at 12" in → 10 stones');
  assert(ws.rock > 0 && ws.rock < 0.75, 'rock between stones is less than a solid rock path of the same size (' + ws.rock + ' ton)');
  await click('walkpaver'); await cw(30 * 12, 62 * 12); await cw(40 * 12, 62 * 12); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  const wp = await page.evaluate(() => computeBom().filter(r => /Paver path|Paver base gravel 4" — Paver path|Bedding sand 1" — Paver path|Paver edging/.test(r.item)).map(r => [r.key, r.qty]));
  eq(wp, [['paver-unit', 32], ['paver-base-gravel', 0.37], ['paver-sand', 0.09], ['edging-ft', 20]], 'paver path 10 × 3 ft: 32 pavers (12x12, +5%), 4" gravel + 1" sand base, 20 ft edging');
  const hitWide = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'walkrock'); return hitTest([15 * 12, 55 * 12 + 15]) === o; });
  assert(hitWide, 'a wide path is selectable 15" off its centreline (inside its 36" width)');
  await page.evaluate(() => { ui.selId = null; refresh(); });

  console.log('\n--- corner radius (fillets), bulk radius, simplify ---');
  const fl = await page.evaluate(() => { const o = makePoly(libById('area'), rectPts([0, 0], [240, 120])); o.pts.forEach((_, k) => o.hnd[k].r = 24); return { A: objArea(o), P: objPerim(o), r: fillets(o).map(f => f && f.r), expA: 240 * 120 - (4 - Math.PI) * 576, expP: 2 * (240 + 120) - 8 * 24 + 2 * Math.PI * 24 }; });
  assert(Math.abs(fl.A / fl.expA - 1) < 0.003, '20×10 ft rectangle with 2 ft fillets: area = 20·10 − (4−π)r²  (' + fl.A.toFixed(0) + ' vs ' + fl.expA.toFixed(0) + ' sq in)');
  assert(Math.abs(fl.P / fl.expP - 1) < 0.003, 'and perimeter = 2(20+10) − 8r + 2πr  (' + fl.P.toFixed(1) + ' vs ' + fl.expP.toFixed(1) + ' in)');
  eq(fl.r, [24, 24, 24, 24], 'all four corners took the full 2 ft radius');
  const cl = await page.evaluate(() => { const o = makePoly(libById('area'), rectPts([0, 0], [240, 48])); o.hnd[0].r = 60; return { r: filletAt(o, 0).r, rMax: cornerGeom(o, 0).rMax }; });
  eq([cl.r, cl.rMax], [24, 24], 'a 5 ft radius on a 4 ft leg clamps to 2 ft — half the short edge');
  eq(await page.evaluate(() => { const o = makePoly(libById('area'), rectPts([0, 0], [240, 120])); o.hnd[0].r = 24; setNodeType(o, 1, 's'); return filletAt(o, 0); }), null, 'a corner next to a smooth anchor cannot be rounded');
  await page.click('#areaShape button[data-shape="rect"]');
  await click('area'); await cw(60 * 12, 5 * 12); await page.keyboard.type('10x8'); await page.keyboard.press('Enter');
  await page.click('#areaShape button[data-shape="poly"]'); await page.keyboard.press('Escape');
  const rc2 = await page.evaluate(() => { const o = state.objects.find(x => x.kind === 'area' && x.pts[0][0] === 720); ui.selId = o.id; refresh(); const g = cornerGeom(o, 0); return { P: g.P, bis: g.bis }; });
  const d0 = await pt(rc2.P[0] + rc2.bis[0] * 11, rc2.P[1] + rc2.bis[1] * 11), d1 = await pt(rc2.P[0] + rc2.bis[0] * 40, rc2.P[1] + rc2.bis[1] * 40);
  await page.mouse.move(d0[0], d0[1]); await page.mouse.down(); await page.mouse.move(d1[0], d1[1], { steps: 4 }); await page.mouse.up();
  const rd = await page.evaluate(() => { const o = state.objects.find(x => x.id === ui.selId); return { r: o.hnd[0].r, others: [1, 2, 3].map(k => o.hnd[k].r || 0) }; });
  assert(rd.r > 0 && rd.r % 6 === 0, 'dragging the ◆ inward rounds that corner, radius snapped to 6" (r = ' + rd.r + ')');
  eq(rd.others, [0, 0, 0], 'only the dragged corner changed');
  await page.evaluate(() => { const i = document.querySelector('[data-vr="2"]'); i.value = "3'"; i.dispatchEvent(new Event('change')); });
  eq(await page.evaluate(() => state.objects.find(x => x.id === ui.selId).hnd[2].r), 36, 'typing r in the Vertices table sets that corner');
  await page.evaluate(() => { const i = document.querySelector('[data-rall]'); i.value = '2'; i.dispatchEvent(new Event('change')); });
  eq(await page.evaluate(() => state.objects.find(x => x.id === ui.selId).hnd.map(h => h.r)), [24, 24, 24, 24], 'Corner radius field rounds every corner at once');
  await click('walkrock'); await cw(50 * 12, 60 * 12); await cw(60 * 12, 60 * 12); await cw(60 * 12, 66 * 12); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  eq(await page.evaluate(() => state.objects.filter(x => x.kind === 'walkrock').pop().hnd.map(h => h.t).join('')), 'ccc', 'walking paths now draw with square corners');
  const sim = await page.evaluate(() => {
    // the user's actual river rock path from backyard-design (3).json: 17 points, four collinear, drag wobbles
    const pts = [[468, 408], [468, 318], [468, 264], [468, 228], [462, 222], [417.1, 221.73], [366, 222], [310.34, 220.37], [264, 222], [240, 222], [240, 208.88], [234, 204], [228, 192], [144, 192], [42, 192], [30, 192], [30, 348]];
    const o = makePath(libById('walkrock'), pts.map(p => p.slice())); const L0 = objLen(o); const n = simplifyObj(o, 3); return { n, left: o.pts.length, L0, L1: objLen(o) };
  });
  assert(sim.n >= 7 && sim.left <= 10, 'Simplify strips the redundant points from the real rock path: 17 → ' + sim.left + ' (removed ' + sim.n + ')');
  assert(Math.abs(sim.L1 / sim.L0 - 1) < 0.01, 'without changing its length (' + sim.L0.toFixed(1) + ' → ' + sim.L1.toFixed(1) + ' in)');
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
