// Browserless checks: no Playwright, no Chrome. Runs anywhere node runs.
//  1. index.html is exactly the concatenation of the four src files.
//  2. every <script> body in index.html parses.
// Exits non-zero on failure so CI can gate on it.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const SRC = ['src/p1_head.html', 'src/p2_data.js', 'src/p3_engine.js', 'src/p4_ui.js'];
let failed = 0;
const fail = m => { console.error('FAIL ' + m); failed++; };
const pass = m => console.log('pass ' + m);

const norm = s => s.replace(/\r\n/g, '\n');
const built = norm(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
const concat = SRC.map(f => norm(fs.readFileSync(path.join(root, f), 'utf8'))).join('');
built === concat
  ? pass('index.html matches concatenation of src/')
  : fail('index.html is stale — rebuild with: cat ' + SRC.join(' ') + ' > index.html');

const blocks = [...built.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m => m[1]);
blocks.length
  ? pass(`found ${blocks.length} <script> blocks`)
  : fail('no <script> blocks found in index.html');
blocks.forEach((body, i) => {
  try { new Function(body); pass(`script block ${i + 1} parses`); }
  catch (e) { fail(`script block ${i + 1} syntax error: ${e.message}`); }
});

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll syntax checks passed.');
process.exit(failed ? 1 : 0);
