MISTAKE LOG — self-check file, not for human reading. Newest first.
Standing rule: before any build/code change, grep this file (tags below) as a
visible tool call. Grep again before shipping. No visible tool call = not done.

TAGS (newest first): focus-scrolls-overflow-hidden > mouse-direction-is-never-exact > trailing-comment-swallows-line > weak-negative-test > tests-that-cannot-fail > escape-at-the-sink > playwright-canvas-coords > path-doubleclick-finish > html-attr-quotes

---
TAG: focus-scrolls-overflow-hidden
IF: calling focus() on an element positioned inside an overflow:hidden container (#canvasWrap), or any element that may extend past its container's edge
WHAT: the direct-distance box opened near the right edge, focus() scrolled #canvasWrap by 59-98 px to bring it into view, the canvas shifted under the stationary cursor, canvas fired mouseleave, ui.mouseW went null, the typed side went east instead of south
WHY: overflow:hidden is still a scroll container; focus() scrolls ancestors by default. Nothing in the smoke test exercised the canvas edge. Found only because a demo screenshot script pointed near the edge.
RESULT: silent wrong geometry with no error; would have shipped
FIX: focus({preventScroll:true}); clamp the box inside the canvas; keep ui.dirW (last on-canvas cursor) so a stray mouseleave cannot blank the direction. Regression test opens the box at the edge and asserts scrollLeft===0. Any new overlay positioned over the canvas gets the same treatment.
---
TAG: mouse-direction-is-never-exact
IF: deriving an angle from a hand-positioned cursor and then laying out a length along it
WHAT: first pass used the raw atan2 of cursor minus last vertex. A cursor 0.07 deg off horizontal put a typed 30 ft side 0.47" off; a human 2 deg off would be a foot off. Sides were not orthogonal, the closing gap read 5.5" instead of 6", and edge edits inherited the skew.
WHY: assumed "point roughly east" was good enough. It is not: float angle from integer mouse pixels is never 0.000.
RESULT: test failed on exact coordinates (good), but the design was wrong, not just the test
FIX: polar tracking — lock to the nearest 45 deg multiple when within 5 deg, else round to 1 deg; Shift forces the lock. Test both: a 10-deg-off cursor + Shift lands at 90, a deliberate 30-deg cursor stays at 30.
---
TAG: trailing-comment-swallows-line
IF: doing scripted string replacement on a PREFIX of a line (anchor shorter than the line)
WHAT: replacement text ended with a // comment; the untouched remainder of the original line was appended after it and silently commented out. duplicateSel() lost its closing brace; script block failed to parse.
WHY: replaced a line prefix, not a whole line, and put a line comment at the end of the inserted text
RESULT: one build cycle lost to a syntax error that looked like it came from somewhere else ("unexpected end of input" at EOF)
FIX: when the anchor is a prefix, end the replacement with a newline before any // comment, or use a /* */ comment, or anchor on the whole line. syntax.js caught it — keep running it before smoke.js.
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
