MISTAKE LOG — self-check file, not for human reading. Newest first.
Standing rule: before any build/code change, grep this file (tags below) as a
visible tool call. Grep again before shipping. No visible tool call = not done.

TAGS (newest first): weak-negative-test > tests-that-cannot-fail > escape-at-the-sink > playwright-canvas-coords > path-doubleclick-finish > html-attr-quotes

---
TAG: weak-negative-test
IF: proving a regression test actually catches the bug it was written for
WHAT: "verified" the BOM escaping test by weakening esc() — but left .replace(/</g,'&lt;') in place, which is the part that actually blocks the tag; the test passed and I nearly called that confirmation
WHY: reverted a cosmetic part of the change instead of the load-bearing part (the esc() CALL SITE in renderBom, not esc() itself)
RESULT: a negative test that proved nothing; caught only because the "expect exit 1" line printed exit 0
FIX: to prove a test works, revert the exact line the fix added and confirm the suite exits non-zero. Always print the expected exit code next to the actual one so a silent pass is visible.
---
TAG: tests-that-cannot-fail
IF: writing or reviewing anything under test/
WHAT: smoke.js drove the whole app, then console.log'd its results and exited 0 unconditionally — no assertions, no process.exit(code)
WHY: written as an exploratory script and never promoted to a gate; the screenshots it wrote are gitignored, so nothing was compared either
RESULT: every bug fixed in 2026.09.08.2 could have regressed silently; a green CI check would have meant nothing
FIX: every test asserts and exits non-zero on failure. When fixing a bug, add the assertion that would have caught it and verify it fails against the unfixed code (see weak-negative-test).
---
TAG: escape-at-the-sink
IF: fixing an escaping/injection bug anywhere
WHAT: html-attr-quotes was fixed for HTML attributes only; computeBom() put the same user-controlled names into element CONTENT via innerHTML, still unescaped. An imported .json could execute script.
WHY: the fix was scoped to the one reported symptom (a broken title attribute) instead of to the sink class (untrusted string -> innerHTML, attribute or content)
RESULT: the same root cause shipped twice; the second instance was reachable by anyone sharing a design file
FIX: when escaping, enumerate every sink the value can reach and fix them together. esc() now covers & " ' < > so it is safe in both positions.
---
TAG: playwright-canvas-coords
IF: writing browser tests that click the canvas
WHAT: test clicks landed off-canvas / off-screen; objects silently not created
WHY: w2s() returns canvas-relative px; page.mouse needs page coords; default zoom (2 px/in) put a 45-ft yard outside a 940-px canvas
RESULT: two wasted test runs chasing a non-existent app bug
FIX: in tests add canvas.getBoundingClientRect() offset and set view.scale so the scene fits before clicking
---
TAG: path-doubleclick-finish
IF: adding any "double-click to finish" gesture on a click-to-add-points tool
WHAT: fast consecutive clicks on different points finished the path after 2 points
WHY: finish condition was time-only (<350 ms), not "same point twice"
RESULT: conduit run never got created in smoke test; real users clicking quickly would lose points
FIX: require same snapped point as last vertex AND short interval; Enter remains the explicit finish
---
TAG: html-attr-quotes
IF: injecting library/object names into HTML attributes (title, value)
WHAT: names containing " (e.g. 29") broke the attribute and produced a stray "="" attr
WHY: template literal without escaping
RESULT: malformed DOM; Playwright locator still matched but tooltips wrong
FIX: always pass names through esc() when placed in attributes. SUPERSEDED by escape-at-the-sink — esc() everywhere the value reaches HTML, content included.
---
