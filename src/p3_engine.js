<script>
'use strict';
// ================= State =================
let state = newState();
function newState(){
  return {
    version:1, build:BUILD_ID,
    objects:[],
    layers:Object.fromEntries(LAYERS.map(l=>[l.id,{visible:true,locked:false}])),
    supply:{gpm:6, psi:50},
    units:'ftin',                // 'ftin' -> 30'-2"   'decft' -> 30.17 ft (engineer's tape)
    prices:Object.assign({}, DEFAULT_PRICES),
    nextId:1,
    nextLabel:0,                 // survey label counter; never reused, so labels stay stable across deletes
    slope:{a:null, b:null},      // the two survey point ids picked in the Survey tab slope tool
  };
}
const view = {scale:2, ox:60, oy:60};   // px per inch, screen offset
const ui = {
  tool:'select', lib:null,            // lib = library entry when drawing/placing
  drawPts:[], mouse:null, mouseW:null,
  selId:null, drag:null, hover:null,
  showGrid:true, snap:true, showDims:true, showArcs:true,
  measure:null, panning:null, space:false,
  areaShape:'poly',                   // Draw-areas shape switch: poly | rect | circle
  hist:[], redo:[],
};
const $ = s=>document.querySelector(s);
const canvas = $('#c'); const ctx = canvas.getContext('2d');

// ================= Helpers =================
const uid = ()=> 'o'+(state.nextId++);
const snap = v => ui.snap ? Math.round(v/GRID)*GRID : Math.round(v*2)/2;
const r2 = v => Math.round(v*100)/100;   // 1/100 inch: enough to hold 30.17 ft exactly, kills float noise
const fmtLen = inches => {
  if(state.units==='decft'){ const v=r2(inches/12); return (v<0?'-':'')+Math.abs(v).toFixed(2)+' ft'; }
  const neg = inches<0; inches=Math.abs(inches);
  let ft=Math.floor(inches/12), rem=inches-ft*12;
  rem = Math.round(rem*4)/4;
  if(rem>=12){ft++;rem=0;}
  const inStr = rem? (Number.isInteger(rem)?rem:rem.toFixed(2).replace(/0+$/,'').replace(/\.$/,''))+'"' : '';
  let s = ft? ft+"'"+(inStr?'-'+inStr:'') : (inStr||'0"');
  return (neg&&s!=='0"'?'-':'')+s;   // never print -0"
};
const fmtFt = inches => (inches/12).toFixed(1)+' ft';
const fmtArea = sqin => (sqin/144).toFixed(1)+' sq ft';
function parseLen(s){
  if(typeof s==='number') return s;
  s=String(s).trim().toLowerCase().replace(/feet|foot/g,"'").replace(/inches|inch/g,'"');
  if(!s) return NaN;
  let m;
  if((m=s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/))) return parseFloat(m[1])*12+(m[2]?parseFloat(m[2]):0);
  if((m=s.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in)$/))) return parseFloat(m[1]);
  if((m=s.match(/^(-?\d+(?:\.\d+)?)$/))) return parseFloat(m[1])*12;
  if((m=s.match(/^(-?\d+)\s+(\d+(?:\.\d+)?)$/))) return parseFloat(m[1])*12+parseFloat(m[2]);
  return NaN;
}
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const pathLen = pts => pts.reduce((s,p,i)=> i? s+dist(pts[i-1],p):0,0);
// Next drawing vertex for a cursor position. With ortho (Shift) the direction from the last
// vertex is locked to the nearest 45 degrees and the distance snaps instead of the coordinates.
function candidatePoint(pw, ortho){
  if(!ortho||!ui.drawPts.length) return [snap(pw[0]),snap(pw[1])];
  const last=ui.drawPts[ui.drawPts.length-1]; const dx=pw[0]-last[0], dy=pw[1]-last[1];
  const a=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4); const d=snap(Math.hypot(dx,dy));
  return [r2(last[0]+Math.cos(a)*d), r2(last[1]+Math.sin(a)*d)];
}
// Direction (radians) a typed length is laid out along: from the last vertex toward the cursor;
// falls back to the previous segment's direction, then +x. Ortho locks it to 45-degree steps.
function drawDirection(ortho){
  const pts=ui.drawPts, last=pts[pts.length-1]; let dx=0, dy=0;
  const m=ui.mouseW||ui.dirW; if(m){ dx=m[0]-last[0]; dy=m[1]-last[1]; }
  if(Math.hypot(dx,dy)<1){ if(pts.length>=2){ const q=pts[pts.length-2]; dx=last[0]-q[0]; dy=last[1]-q[1]; } else { dx=1; dy=0; } }
  // Polar tracking: within 5 degrees of a 45-degree multiple the direction locks to it (a hand-pointed
  // 'east' is never exactly 0 degrees, and 2 degrees off is a foot of drift over 30 ft). Otherwise 1-degree steps.
  let a=Math.atan2(dy,dx); const q=Math.PI/4, near=Math.round(a/q)*q;
  if(ortho||Math.abs(a-near)<5*Math.PI/180) a=near; else a=Math.round(a*180/Math.PI)*Math.PI/180;
  return a;
}
function polyArea(pts){let a=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p[0]*q[1]-q[0]*p[1];}return Math.abs(a)/2;}
function polyCentroid(pts){let x=0,y=0;pts.forEach(p=>{x+=p[0];y+=p[1];});return [x/pts.length,y/pts.length];}
function pointInPoly(pt,pts){let ins=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1];if(((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi))ins=!ins;}return ins;}
function distToSeg(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];const l2=dx*dx+dy*dy;let t=l2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2:0;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));}
const w2s = p => [p[0]*view.scale+view.ox, p[1]*view.scale+view.oy];
const s2w = p => [(p[0]-view.ox)/view.scale, (p[1]-view.oy)/view.scale];
const layerOf = id => LAYERS.find(l=>l.id===id);
const libById = id => Object.values(LIB).flat().find(e=>e.id===id);
const headSpec = o => HEADS.find(h=>h.id===o.props.model) || HEADS[0];
// Zone -> color, tolerant of missing/0/out-of-range zone values (never returns undefined).
const zoneColor = z => { const i=Math.round(Number(z)||1)-1; const L=ZONE_COLORS.length; return ZONE_COLORS[((i%L)+L)%L]; };
const plantSpec = o => PLANTS.find(p=>p.id===o.props.plant) || PLANTS[0];
const headGpm = o => { const h=headSpec(o); const r=o.props.radius/12; return +(h.gpm360*(o.props.arc/360)*(h.strip?1:Math.pow(r/h.radius,2))).toFixed(2); };
// Note: GPM scales ~ with area for matched-precip rotators; that is also a fair approximation for radius-reduced sprays.

// ---- Survey / grade helpers. Readings live in mm; plan geometry stays in inches. ----
// Bijective base-26: 0->A, 25->Z, 26->AA, 27->AB, 701->ZZ, 702->AAA (spreadsheet column order).
function alphaLabel(n){ let s=''; n=n+1; while(n>0){ n--; s=String.fromCharCode(65+n%26)+s; n=Math.floor(n/26); } return s; }
function labelIndex(s){ let n=0; for(const ch of String(s).toUpperCase()) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
const mmToIn = mm => mm/25.4;
const fmtReading    = mm => (mm/10).toFixed(1)+' cm';   // rod readings are entered and shown in cm
const fmtReadingNum = mm => (mm/10).toFixed(1);
const fmtCm  = (mm, sign=true) => { const v=mm/10; return (sign&&v>0?'+':'')+v.toFixed(1)+' cm'; };
// Accepts 123.5, 123.5cm, 1.235m, 1235mm (unit defaults to cm). Returns integer mm, or NaN.
function parseMetric(s){ const m=String(s).trim().toLowerCase().match(/^(-?\d+(?:\.\d+)?)\s*(m|cm|mm)?$/); if(!m) return NaN; const v=parseFloat(m[1]); return Math.round(m[2]==='m'? v*1000 : m[2]==='mm'? v : v*10); }
const benchPoint = () => state.objects.find(o=>o.kind==='spoint'&&o.props.bench);
// Elevation relative to the benchmark. A higher rod reading means lower ground, so delta = bench - reading.
function deltaMm(o){ const bm=benchPoint(); if(!bm||bm.props.reading==null||o.props.reading==null) return null; return bm.props.reading-o.props.reading; }
// Slope needs no benchmark: rise between two points is just the difference of their readings.
function slopeBetween(A,B){ if(A.props.reading==null||B.props.reading==null) return null; const run=dist([A.x,A.y],[B.x,B.y]); if(!run) return null; const riseMm=A.props.reading-B.props.reading; const riseIn=mmToIn(riseMm); return {run, riseMm, riseIn, pct:riseIn/run*100, inPerFt:riseIn/(run/12)}; }
function surveyLabel(o){ const L=o.props.label; if(o.props.bench) return L+' BM'; if(o.props.reading==null) return L; const d=deltaMm(o); return L+' '+(d==null? fmtReading(o.props.reading) : fmtCm(d)); }

// ================= History / persistence =================
// Snapshots carry the survey label counter alongside objects so undoing a placement rolls it back.
const histSnap = () => JSON.stringify({o:state.objects, n:state.nextLabel});
const histRestore = s => { const j=JSON.parse(s); state.objects=j.o; state.nextLabel=j.n; };
function pushHist(){ ui.hist.push(histSnap()); if(ui.hist.length>100) ui.hist.shift(); ui.redo.length=0; }
// Describe what a history step changed so undo/redo can say it out loud (nothing should vanish silently).
function histDiff(before, after, isUndo){
  const K = isUndo? ['Ctrl+Y brings it back','Ctrl+Y removes it again','Ctrl+Y redoes'] : ['Ctrl+Z brings it back','Ctrl+Z removes it again','Ctrl+Z undoes'];
  const bId=new Set(before.map(o=>o.id)), aId=new Set(after.map(o=>o.id));
  const gone=before.filter(o=>!aId.has(o.id)).map(o=>o.name), came=after.filter(o=>!bId.has(o.id)).map(o=>o.name);
  const list=a=>a.length>3? a.slice(0,3).join(', ')+' +'+(a.length-3)+' more' : a.join(', ');
  if(gone.length&&!came.length) return 'Removed '+list(gone)+' — '+K[0];
  if(came.length&&!gone.length) return 'Restored '+list(came)+' — '+K[1];
  if(gone.length||came.length) return 'Replaced '+list(gone)+' with '+list(came)+' — '+K[2];
  return (isUndo?'Undid':'Redid')+' last edit — '+K[2];
}
function undo(){ if(!ui.hist.length) return; const before=state.objects; ui.redo.push(histSnap()); histRestore(ui.hist.pop()); ui.selId=null; refresh(); notice(histDiff(before, state.objects, true)); }
function redo(){ if(!ui.redo.length) return; const before=state.objects; ui.hist.push(histSnap()); histRestore(ui.redo.pop()); ui.selId=null; refresh(); notice(histDiff(before, state.objects, false)); }
let saveTimer=null;
function autosave(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ try{ localStorage.setItem('byd.state', JSON.stringify(state)); $('#stSave').textContent='autosaved '+new Date().toLocaleTimeString(); }catch(e){} },400); }
function loadAutosave(){ try{ const s=localStorage.getItem('byd.state'); if(s){ const st=JSON.parse(s); migrate(st); state=st; return true; } }catch(e){} return false; }
function migrate(st){
  st.layers = Object.assign(Object.fromEntries(LAYERS.map(l=>[l.id,{visible:true,locked:false}])), st.layers||{});
  st.prices = Object.assign({}, DEFAULT_PRICES, st.prices||{});
  st.supply = st.supply||{gpm:6,psi:50};
  st.units = st.units==='decft'?'decft':'ftin';
  st.objects = st.objects||[]; st.nextId = st.nextId||(st.objects.length+1);
  st.slope = st.slope||{a:null,b:null};
  if(st.nextLabel==null){ const idx=st.objects.filter(o=>o.kind==='spoint'&&o.props&&o.props.label).map(o=>labelIndex(o.props.label)); st.nextLabel = idx.length? Math.max(...idx)+1 : 0; }
  st.objects.forEach(o=>{ o.props=o.props||{}; if(o.rot==null) o.rot=0; });
}

// ================= Object creation =================
function makePoly(lib, pts, extra){ return {id:uid(), type:'poly', kind:lib.kind, layer:lib.layer, name:lib.name, pts, rot:0, props: Object.assign({}, lib.props||{}, lib.kind==='rock'?{depth:2}: lib.kind==='paver'?{paver:'12x12'}: {}, extra||{})}; }
function makePath(lib, pts){ return {id:uid(), type:'path', kind:lib.kind, layer:lib.layer, name:lib.name, pts, rot:0, props: Object.assign({}, lib.props||{}, lib.kind==='trench'?{width:6,depth:18}:{})}; }
// Shape builders for the Draw-areas shape switch. A circle is 8 control points + smooth. Catmull-Rom through
// points ON a circle runs ~0.5% inside it (1.1% low on area), so the control points are pushed out by
// CIRCLE_K, computed once from the curve itself, and the drawn curve has the true radius to within 0.05%.
function circlePts(cx, cy, r, n=8){ const k=n===8? CIRCLE_K : 1; const out=[]; for(let i=0;i<n;i++){ const a=i/n*2*Math.PI; out.push([r2(cx+Math.cos(a)*r*k), r2(cy+Math.sin(a)*r*k)]); } return out; }
function rectPts(a, b){ return [[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]]; }

// ---- Smooth curves. Control points stay in o.pts; everything geometric reads geomPts(o). ----
const CURVE_SEG = 8;   // samples per span
// Catmull-Rom through pts. Closed shapes wrap; open ones clamp the ends. Returns the dense polyline.
function curvePts(pts, closed, seg=CURVE_SEG){
  const N=pts.length; if(N<(closed?3:2)) return pts.slice();
  const P=i=> closed? pts[((i%N)+N)%N] : pts[Math.max(0,Math.min(N-1,i))];
  const out=[]; const spans= closed? N : N-1;
  for(let i=0;i<spans;i++){ const p0=P(i-1),p1=P(i),p2=P(i+1),p3=P(i+2);
    for(let k=0;k<seg;k++){ const t=k/seg, t2=t*t, t3=t2*t;
      out.push([ 0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
                 0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3) ]); } }
  if(!closed) out.push(pts[N-1].slice());
  return out;
}
const CIRCLE_K = (()=>{ const raw=[]; for(let i=0;i<8;i++){ const a=i/8*2*Math.PI; raw.push([Math.cos(a),Math.sin(a)]); } return Math.sqrt(Math.PI/polyArea(curvePts(raw,true))); })();
const isSmooth = o => !!(o.props&&o.props.smooth) && o.kind!=='conduit' && o.pts.length>=(o.type==='poly'?3:2);
const geomPts  = o => isSmooth(o)? curvePts(o.pts, o.type==='poly') : o.pts;
const objArea  = o => polyArea(geomPts(o));
const objLen   = o => pathLen(geomPts(o));                                   // open length
const objPerim = o => { const g=geomPts(o); return pathLen(g.concat([g[0]])); };
// Per-span lengths and label anchors for dimension labels on a smooth shape.
function curveSpans(o){ const g=curvePts(o.pts, o.type==='poly'), closed=o.type==='poly', spans=closed? o.pts.length : o.pts.length-1, out=[];
  for(let i=0;i<spans;i++){ const seg=g.slice(i*CURVE_SEG, i*CURVE_SEG+CURVE_SEG+1); if(closed&&i===spans-1) seg.push(g[0]); const m=seg[Math.floor(seg.length/2)]; const a=seg[0], b=seg[seg.length-1]; out.push({len:pathLen(seg), mid:m, dx:b[0]-a[0], dy:b[1]-a[1]}); }
  return out; }
// ghost=true is the cursor preview: it shows the next label without consuming it.
function makeItem(lib, x, y, ghost){
  const o={id:uid(), type:'item', kind:lib.kind, layer:lib.layer, name:lib.name, x, y, w:lib.w, h:lib.h, rot:0, shape:lib.shape, color:lib.color, props:Object.assign({}, lib.props||{})};
  if(lib.kind==='spoint'){ const L=alphaLabel(ghost? state.nextLabel : state.nextLabel++); o.props={label:L, reading:null, bench:false, note:''}; o.name='Point '+L; }
  if(lib.kind==='head'){ const h=HEADS[0]; o.props={model:h.id, radius:h.radius*12, arc:180, start:0, zone:1}; o.name=h.brand+' '+h.name; }
  if(lib.kind==='plant'){ const p=PLANTS.find(p=>p.id===lib.props.plant); o.name=p.name.split(' (')[0].split(' —')[0]; }
  return o;
}
function itemBox(o){ // local unrotated box centered at x,y
  return {x:o.x-o.w/2, y:o.y-o.h/2, w:o.w, h:o.h};
}
function toLocal(o,p){ const a=-o.rot*Math.PI/180, dx=p[0]-o.x, dy=p[1]-o.y; return [o.x+dx*Math.cos(a)-dy*Math.sin(a), o.y+dx*Math.sin(a)+dy*Math.cos(a)]; }
function objBounds(o){
  if(o.type==='item'){ const r=Math.max(o.w,o.h)/2*(o.kind==='head'?0:1); let rr=r; if(o.kind==='head') rr=Math.max(4,ui.showArcs?o.props.radius:4); if(o.kind==='fountain'&&o.props.pad) rr=Math.max(rr,o.props.padSize/2); return {x0:o.x-rr,y0:o.y-rr,x1:o.x+rr,y1:o.y+rr}; }
  const g=geomPts(o), xs=g.map(p=>p[0]), ys=g.map(p=>p[1]); const pad=(o.props&&o.props.width)? o.props.width/2 : 0;
  return {x0:Math.min(...xs)-pad,y0:Math.min(...ys)-pad,x1:Math.max(...xs)+pad,y1:Math.max(...ys)+pad};
}
function allBounds(){ if(!state.objects.length) return null; let b={x0:1e9,y0:1e9,x1:-1e9,y1:-1e9}; state.objects.forEach(o=>{const q=objBounds(o); b.x0=Math.min(b.x0,q.x0);b.y0=Math.min(b.y0,q.y0);b.x1=Math.max(b.x1,q.x1);b.y1=Math.max(b.y1,q.y1);}); return b; }
function objLayerVisible(o){ return state.layers[o.layer]?.visible!==false; }
function objLocked(o){ return state.layers[o.layer]?.locked; }

// ================= Hit testing =================
function hitTest(pw){
  const tol = 6/view.scale;
  const objs = state.objects.filter(o=>objLayerVisible(o)&&!objLocked(o));
  // items first (topmost last drawn)
  for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(o.type!=='item') continue;
    const lp=toLocal(o,pw); const b=itemBox(o); const pad = o.shape==='text'? 6/view.scale : Math.max(0, (8/view.scale)-Math.min(o.w,o.h)/2);
    if(o.shape==='text'){ const tw=(o.props.text||'').length*o.props.size*0.6/view.scale*1; if(lp[0]>=o.x-pad&&lp[0]<=o.x+tw+pad&&lp[1]>=o.y-o.props.size/view.scale-pad&&lp[1]<=o.y+pad) return o; continue; }
    if(lp[0]>=b.x-pad&&lp[0]<=b.x+b.w+pad&&lp[1]>=b.y-pad&&lp[1]<=b.y+b.h+pad) return o; }
  for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(o.type!=='path') continue;
    const g=geomPts(o), half=(o.props&&o.props.width)? o.props.width/2 : (KIND_STYLE[o.kind]?.width||2)/2/view.scale;   // wide runs hit across their real width
    for(let k=1;k<g.length;k++) if(distToSeg(pw,g[k-1],g[k])<=tol+half) return o; }
  // polygons: smallest area containing point wins; yard last
  let best=null, bestA=Infinity;
  for(const o of objs){ if(o.type!=='poly') continue;
    const g=geomPts(o); let hit=pointInPoly(pw,g); if(!hit){ for(let k=0;k<g.length;k++) if(distToSeg(pw,g[k],g[(k+1)%g.length])<=tol){hit=true;break;} }
    if(hit){ const a=polyArea(g)*(o.kind==='yard'?1e6:1); if(a<bestA){bestA=a;best=o;} } }
  return best;
}
function handleHit(o, pw){ // returns {type:'vertex',i} | {type:'mid',i} | {type:'resize'} | null
  const tol=8/view.scale;
  if(o.type==='item'){
    if(o.shape==='text'||o.shape==='spoint') return null;
    const lp=toLocal(o,pw); const b=itemBox(o);
    if(Math.hypot(lp[0]-(b.x+b.w), lp[1]-(b.y+b.h))<=tol) return {type:'resize'};
    if(o.kind==='head' && ui.showArcs){ // radius handle at end of arc bisector
      const a=(o.props.start+o.props.arc/2)*Math.PI/180; const hx=o.x+Math.cos(a)*o.props.radius, hy=o.y+Math.sin(a)*o.props.radius;
      if(Math.hypot(pw[0]-hx,pw[1]-hy)<=tol) return {type:'radius'};
      const a0=o.props.start*Math.PI/180; const sx=o.x+Math.cos(a0)*o.props.radius*0.6, sy=o.y+Math.sin(a0)*o.props.radius*0.6;
      if(Math.hypot(pw[0]-sx,pw[1]-sy)<=tol) return {type:'arcstart'};
      const a1=(o.props.start+o.props.arc)*Math.PI/180; const ex=o.x+Math.cos(a1)*o.props.radius*0.6, ey=o.y+Math.sin(a1)*o.props.radius*0.6;
      if(Math.hypot(pw[0]-ex,pw[1]-ey)<=tol) return {type:'arcend'};
    }
    return null;
  }
  for(let i=0;i<o.pts.length;i++) if(dist(o.pts[i],pw)<=tol) return {type:'vertex',i};
  const n = o.type==='poly'? o.pts.length : o.pts.length-1;
  for(let i=0;i<n;i++){ const a=o.pts[i], b=o.pts[(i+1)%o.pts.length]; const m=[(a[0]+b[0])/2,(a[1]+b[1])/2]; if(dist(m,pw)<=tol) return {type:'mid',i}; }
  return null;
}

// ================= Rendering =================
function resize(){ const r=canvas.parentElement.getBoundingClientRect(); canvas.width=r.width*devicePixelRatio; canvas.height=r.height*devicePixelRatio; canvas.style.width=r.width+'px'; canvas.style.height=r.height+'px'; draw(); }
window.addEventListener('resize', resize);

function draw(){
  const W=canvas.width/devicePixelRatio, H=canvas.height/devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  ctx.clearRect(0,0,W,H); ctx.fillStyle='#fafaf7'; ctx.fillRect(0,0,W,H);
  if(ui.showGrid) drawGrid(W,H);
  const order = ['base','hardscape','trench','plants','irrigation','conduit','lighting','notes','survey'];
  const sel = state.objects.find(o=>o.id===ui.selId);
  for(const lid of order){ if(!state.layers[lid]?.visible) continue;
    for(const o of state.objects){ if(o.layer!==lid) continue; drawObj(o, o===sel); } }
  // arcs on top of everything for irrigation clarity
  if(ui.showArcs && state.layers.irrigation?.visible) for(const o of state.objects) if(o.kind==='head') drawHeadArc(o, o===sel);
  if(sel && objLayerVisible(sel)) drawHandles(sel);
  drawDrawing();
  if(ui.measure) drawMeasure();
  updateHud();
}
function drawGrid(W,H){
  const s=view.scale; const minor=GRID*s;
  const x0=Math.floor((0-view.ox)/s/GRID)*GRID, x1=Math.ceil((W-view.ox)/s/GRID)*GRID;
  const y0=Math.floor((0-view.oy)/s/GRID)*GRID, y1=Math.ceil((H-view.oy)/s/GRID)*GRID;
  ctx.lineWidth=1;
  for(let x=x0;x<=x1;x+=GRID){ const major5=x%60===0, major1=x%12===0; if(!major1 && minor<5) continue; ctx.strokeStyle= major5?'#b9c2cc': major1?'#dde3e8':'#eef1f4'; const sx=Math.round(x*s+view.ox)+.5; ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,H); ctx.stroke(); }
  for(let y=y0;y<=y1;y+=GRID){ const major5=y%60===0, major1=y%12===0; if(!major1 && minor<5) continue; ctx.strokeStyle= major5?'#b9c2cc': major1?'#dde3e8':'#eef1f4'; const sy=Math.round(y*s+view.oy)+.5; ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(W,sy); ctx.stroke(); }
  // grid dots at 6" when zoomed in
  if(minor>=14){ ctx.fillStyle='#c5ccd3'; for(let x=x0;x<=x1;x+=GRID) for(let y=y0;y<=y1;y+=GRID){ ctx.fillRect(x*s+view.ox-1, y*s+view.oy-1, 2, 2);} }
  // labels every 5 ft
  ctx.fillStyle='#7d8790'; ctx.font='10px system-ui';
  const step = (60*s<36)? 120 : 60;
  for(let x=Math.ceil(x0/step)*step;x<=x1;x+=step){ ctx.fillText((x/12)+"'", x*s+view.ox+2, 10); }
  for(let y=Math.ceil(y0/step)*step;y<=y1;y+=step){ ctx.fillText((y/12)+"'", 2, y*s+view.oy-2); }
}
function label(text, sp, opts={}){ // screen point
  ctx.font=(opts.bold?'600 ':'')+(opts.size||11)+'px system-ui'; ctx.textAlign=opts.align||'center'; ctx.textBaseline=opts.base||'middle';
  ctx.lineWidth=3; ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineJoin='round'; ctx.strokeText(text, sp[0], sp[1]);
  ctx.fillStyle=opts.color||'#222'; ctx.fillText(text, sp[0], sp[1]);
}
function drawObj(o, selected){
  const st = KIND_STYLE[o.kind]||{stroke:'#333',width:1,fill:'rgba(0,0,0,.05)'};
  if(o.type==='poly'){
    const sp=geomPts(o).map(w2s); ctx.beginPath(); sp.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
    ctx.fillStyle= st.fill||'transparent'; ctx.fill();
    if(st.hatch){ ctx.save(); ctx.clip(); ctx.strokeStyle=st.hatch; ctx.lineWidth=1; const b=objBounds(o); const step=(o.kind==='paver'?(PAVER_SIZES.find(p=>p.id===o.props.paver)||PAVER_SIZES[0]).w:12)*view.scale; if(step>4){ const s0=w2s([b.x0,b.y0]), s1=w2s([b.x1,b.y1]); for(let x=s0[0];x<=s1[0];x+=step){ctx.beginPath();ctx.moveTo(x,s0[1]);ctx.lineTo(x,s1[1]);ctx.stroke();} if(o.kind==='paver'){const ph=(PAVER_SIZES.find(p=>p.id===o.props.paver)||PAVER_SIZES[0]).h*view.scale; for(let y=s0[1];y<=s1[1];y+=ph){ctx.beginPath();ctx.moveTo(s0[0],y);ctx.lineTo(s1[0],y);ctx.stroke();}} } ctx.restore(); }
    if(st.dots){ ctx.save(); ctx.clip(); ctx.fillStyle=st.dots; const b=objBounds(o); const step=8*view.scale; if(step>5){ const s0=w2s([b.x0,b.y0]), s1=w2s([b.x1,b.y1]); let r=0; for(let y=s0[1];y<=s1[1];y+=step,r++) for(let x=s0[0]+(r%2)*step/2;x<=s1[0];x+=step){ ctx.beginPath(); ctx.arc(x,y,1.5,0,7); ctx.fill(); } } ctx.restore(); }
    ctx.setLineDash(st.dash||[]); ctx.strokeStyle= selected?'#4fa3ff':st.stroke; ctx.lineWidth=(st.width||1)+(selected?1:0); ctx.stroke(); ctx.setLineDash([]);
    if(ui.showDims){ dimEdges(o.pts, true, o.kind==='yard'||selected, o); const c=w2s(polyCentroid(geomPts(o))); const nm=o.name.replace(' outline',''); label(nm, [c[0],c[1]-7], {bold:true, size:12}); label(fmtArea(objArea(o))+(o.kind==='rock'?' · '+o.props.depth+'" deep':''), [c[0],c[1]+7], {color:'#444'}); if(o.kind==='yard') label('perimeter '+fmtLen(objPerim(o)), [c[0],c[1]+20], {color:'#666'}); }
  } else if(o.type==='path'){
    const sp=geomPts(o).map(w2s); ctx.beginPath(); sp.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.setLineDash(st.dash||[]); ctx.lineCap='round'; ctx.lineJoin='round';
    if(WALK_KINDS.has(o.kind)){ drawWalkPath(o, sp, selected, st); }
    else { ctx.strokeStyle= selected?'#4fa3ff':st.stroke; ctx.lineWidth= o.kind==='trench'? Math.max(4,o.props.width*view.scale) : (st.width||2)+(selected?1:0); ctx.stroke(); } ctx.setLineDash([]);
    if(o.kind==='fence'){ ctx.fillStyle=st.stroke; sp.forEach(p=>{ctx.beginPath();ctx.arc(p[0],p[1],3,0,7);ctx.fill();}); }
    if(o.kind==='conduit'){ // mark fittings at bends
      const f=conduitFittings(o); ctx.fillStyle='#e65100'; f.bends.forEach(b=>{ const p=w2s(o.pts[b.i]); ctx.beginPath(); ctx.arc(p[0],p[1],4,0,7); ctx.fill(); label(b.label, [p[0]+6,p[1]-6], {align:'left', size:10, color:'#e65100'}); }); }
    if(ui.showDims){ if(selected) dimEdges(o.pts,false,true,o); const e=sp[sp.length-1]; label(o.name.split(' (')[0]+' '+fmtLen(objLen(o))+(WALK_KINDS.has(o.kind)?' × '+fmtLen(o.props.width):''), [e[0]+8,e[1]-8], {align:'left', color:st.stroke}); }
  } else drawItem(o, selected, st);
}
// ---- Walking paths: a wide stroke textured with a screen-space pattern, an edge line, and for stepping
// stones a paver every props.spacing inches along the curve, rotated to the tangent. ----
const WALK_KINDS = new Set(['walkrock','walkpaver','walkstep']);
const _pat = {};
function walkPattern(kind){
  if(_pat[kind]) return _pat[kind];
  const c=document.createElement('canvas'); c.width=c.height=16; const g=c.getContext('2d');
  if(kind==='walkpaver'){ g.fillStyle='#c9a27a'; g.fillRect(0,0,16,16); g.strokeStyle='#a1887f'; g.lineWidth=1; g.beginPath(); g.moveTo(0,8.5); g.lineTo(16,8.5); g.moveTo(8.5,0); g.lineTo(8.5,8); g.moveTo(0.5,8); g.lineTo(0.5,16); g.stroke(); }
  else { g.fillStyle='#d9d2c6'; g.fillRect(0,0,16,16); g.fillStyle='#9e968c'; [[3,3,2],[11,5,2.5],[6,11,2],[13,13,1.5],[1,12,1.5]].forEach(([x,y,r])=>{ g.beginPath(); g.arc(x,y,r,0,7); g.fill(); }); }
  return _pat[kind]=ctx.createPattern(c,'repeat');
}
function drawWalkPath(o, sp, selected, st){
  const w=Math.max(3, o.props.width*view.scale);
  ctx.strokeStyle= selected? '#4fa3ff' : st.edge; ctx.lineWidth=w+2; ctx.stroke();          // edge line
  ctx.strokeStyle= walkPattern(o.kind==='walkpaver'?'walkpaver':'walkrock'); ctx.lineWidth=w; ctx.stroke();
  if(o.kind==='walkstep'){ const pv=PAVER_SIZES.find(p=>p.id===o.props.paver)||PAVER_SIZES[1]; const g=geomPts(o); const sp2=o.props.spacing||24;
    let acc=0, next=sp2/2; const s=view.scale;
    for(let k=1;k<g.length;k++){ const a=g[k-1], b=g[k], L=dist(a,b); if(!L) continue;
      while(next<=acc+L){ const t=(next-acc)/L; const x=a[0]+(b[0]-a[0])*t, y=a[1]+(b[1]-a[1])*t; const ang=Math.atan2(b[1]-a[1],b[0]-a[0]);
        const c=w2s([x,y]); ctx.save(); ctx.translate(c[0],c[1]); ctx.rotate(ang); ctx.fillStyle='#c9a27a'; ctx.strokeStyle='#6d4c41'; ctx.lineWidth=1; ctx.fillRect(-pv.w*s/2,-pv.h*s/2,pv.w*s,pv.h*s); ctx.strokeRect(-pv.w*s/2,-pv.h*s/2,pv.w*s,pv.h*s); ctx.restore(); next+=sp2; }
      acc+=L; } }
}
// Stepping stone count along a path: one every spacing, first at half a spacing in.
function stoneCount(o){ const L=objLen(o), s=o.props.spacing||24; return L<=0? 0 : Math.floor((L - s/2)/s)+1; }
function dimEdges(pts, closed, strong, o){
  if(o && isSmooth(o)){ // label each span with its curved length at the curve's midpoint
    curveSpans(o).forEach(s=>{ if(s.len*view.scale<24) return; const m=w2s(s.mid); const len=Math.hypot(s.dx,s.dy)||1; const nx=-s.dy/len, ny=s.dx/len; label(fmtLen(s.len), [m[0]+nx*10, m[1]+ny*10], {size:strong?11:10, color:strong?'#1a3d6b':'#555'}); }); return; }
  const n = closed? pts.length : pts.length-1;
  for(let i=0;i<n;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; const L=dist(a,b); if(L*view.scale<24) continue;
    const m=w2s([(a[0]+b[0])/2,(a[1]+b[1])/2]); const dx=b[0]-a[0], dy=b[1]-a[1]; const len=Math.hypot(dx,dy)||1; const nx=-dy/len, ny=dx/len;
    label(fmtLen(L), [m[0]+nx*10, m[1]+ny*10], {size:strong?11:10, color:strong?'#1a3d6b':'#555'}); }
}
function drawItem(o, selected, st){
  const c=w2s([o.x,o.y]); const s=view.scale;
  ctx.save(); ctx.translate(c[0],c[1]); ctx.rotate(o.rot*Math.PI/180);
  const w=o.w*s, h=o.h*s;
  if(o.kind==='fountain' && o.props.pad){ const p=o.props.padSize*s; ctx.fillStyle='rgba(189,189,189,.6)'; ctx.strokeStyle='#8a8a8a'; ctx.lineWidth=1; ctx.fillRect(-p/2,-p/2,p,p); ctx.strokeRect(-p/2,-p/2,p,p); }
  ctx.lineWidth= selected?2.5:1.5; ctx.strokeStyle= selected?'#4fa3ff':'#222';
  if(o.shape==='text'){ ctx.rotate(0); ctx.font=(o.props.size||12)*Math.max(.6,Math.min(3,s/2))+'px system-ui'; ctx.textAlign='left'; ctx.textBaseline='bottom'; ctx.fillStyle=o.color||'#333'; ctx.fillText(o.props.text||'', 0, 0); if(selected){ctx.strokeStyle='#4fa3ff';ctx.strokeRect(-2,-(o.props.size||12)*Math.max(.6,Math.min(3,s/2))-2, ctx.measureText(o.props.text||'').width+4,(o.props.size||12)*Math.max(.6,Math.min(3,s/2))+4);} ctx.restore(); return; }
  if(o.shape==='plant'){ const p=plantSpec(o); ctx.fillStyle=hexA(p?p.color:'#8bc34a',.5); ctx.beginPath(); ctx.ellipse(0,0,w/2,h/2,0,0,7); ctx.fill(); ctx.strokeStyle=selected?'#4fa3ff':'#2e7d32'; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle='#2e7d32'; ctx.beginPath(); ctx.arc(0,0,3,0,7); ctx.fill(); }
  else if(o.shape==='spoint'){ // fixed screen size so it stays readable at any zoom
    const bm=!!o.props.bench; ctx.lineWidth=selected?2.5:2; ctx.strokeStyle=selected?'#4fa3ff':'#880e4f'; ctx.fillStyle=bm?'#fff':'#d81b60';
    ctx.beginPath(); ctx.arc(0,0,5,0,7); ctx.fill(); ctx.stroke(); if(bm){ ctx.fillStyle='#d81b60'; ctx.beginPath(); ctx.arc(0,0,2.5,0,7); ctx.fill(); } }
  else if(o.shape==='head'){ const zc=zoneColor(o.props.zone); ctx.fillStyle=zc; ctx.beginPath(); ctx.arc(0,0,Math.max(5,w/2),0,7); ctx.fill(); ctx.stroke(); }
  else if(o.shape==='circle'){ ctx.fillStyle=hexA(o.color,.55); ctx.beginPath(); ctx.ellipse(0,0,w/2,h/2,0,0,7); ctx.fill(); ctx.stroke(); if(o.kind==='fountain'){ ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=1; for(let r=w/2*.75;r>3;r*=.6){ctx.beginPath();ctx.arc(0,0,r,0,7);ctx.stroke();} } if(o.kind==='tree'){ ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(0,0,w/2*.5,0,7); ctx.stroke(); } }
  else { ctx.fillStyle=hexA(o.color,.6); ctx.fillRect(-w/2,-h/2,w,h); ctx.strokeRect(-w/2,-h/2,w,h);
    if(o.kind==='gfci'||o.kind==='panel'){ ctx.fillStyle='#000'; ctx.font='bold '+Math.max(8,Math.min(14,h*.6))+'px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(o.kind==='gfci'?'⏚':'P',0,0); } }
  ctx.restore();
  // Survey labels are the data, not decoration: always drawn, independent of the Dims toggle.
  if(o.kind==='spoint'){ label(surveyLabel(o), [c[0], c[1]-11], {bold:true, size:11, color:'#880e4f'}); return; }
  if(ui.showDims){ const off=Math.max(o.h*s/2, 8)+9; const nm = o.kind==='head'? (headSpec(o).name.replace('MP Rotator ','').replace(' rotary nozzle','').replace(' spray nozzle','')+' Z'+o.props.zone+' '+(o.props.radius/12)+"' "+o.props.arc+'°') : o.name; label(nm, [c[0], c[1]+off], {size:10, color:'#333'}); if(selected && o.kind!=='head') label(fmtLen(o.w)+' × '+fmtLen(o.h), [c[0], c[1]+off+12], {size:10, color:'#1a3d6b'}); }
}
function drawHeadArc(o, selected){
  const c=w2s([o.x,o.y]); const r=o.props.radius*view.scale; const a0=o.props.start*Math.PI/180, a1=(o.props.start+o.props.arc)*Math.PI/180;
  const zc=zoneColor(o.props.zone);
  ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.arc(c[0],c[1],r,a0,a1); ctx.closePath();
  ctx.fillStyle=hexA(zc, selected?.28:.14); ctx.fill(); ctx.strokeStyle=hexA(zc,.7); ctx.lineWidth=1; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
}
function hexA(hex,a){ if(!hex||hex[0]!=='#') return hex; const n=parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
function drawHandles(o){
  ctx.fillStyle='#fff'; ctx.strokeStyle='#4fa3ff'; ctx.lineWidth=1.5;
  if(o.type==='item'){
    if(o.shape==='text'||o.shape==='spoint') return;
    const c=w2s([o.x,o.y]); ctx.save(); ctx.translate(c[0],c[1]); ctx.rotate(o.rot*Math.PI/180); const w=o.w*view.scale,h=o.h*view.scale; ctx.fillRect(w/2-4,h/2-4,8,8); ctx.strokeRect(w/2-4,h/2-4,8,8); ctx.restore();
    if(o.kind==='head'&&ui.showArcs){ const draw=(ang,rad,fill)=>{const x=c[0]+Math.cos(ang)*rad,y=c[1]+Math.sin(ang)*rad; ctx.fillStyle=fill; ctx.beginPath(); ctx.arc(x,y,5,0,7); ctx.fill(); ctx.stroke();};
      draw((o.props.start+o.props.arc/2)*Math.PI/180, o.props.radius*view.scale, '#fff'); draw(o.props.start*Math.PI/180, o.props.radius*view.scale*.6, '#ffb347'); draw((o.props.start+o.props.arc)*Math.PI/180, o.props.radius*view.scale*.6, '#ffb347'); }
    return;
  }
  const sp=o.pts.map(w2s);
  const n = o.type==='poly'? o.pts.length : o.pts.length-1;
  for(let i=0;i<n;i++){ const a=sp[i], b=sp[(i+1)%sp.length]; const m=[(a[0]+b[0])/2,(a[1]+b[1])/2]; ctx.fillStyle='rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(m[0],m[1],4,0,7); ctx.fill(); ctx.stroke(); label('+', m, {size:10,color:'#4fa3ff'}); }
  sp.forEach(p=>{ ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(p[0],p[1],5,0,7); ctx.fill(); ctx.stroke(); });
}
function drawDrawing(){
  if(!ui.lib || !ui.drawPts.length) { if(ui.lib&&ui.lib.tool==='item'&&ui.mouseW){ const g=makeItem(ui.lib, snap(ui.mouseW[0]), snap(ui.mouseW[1]), true); ctx.globalAlpha=.5; drawItem(g,false,{}); ctx.globalAlpha=1; } return; }
  const st=KIND_STYLE[ui.lib.kind]||{stroke:'#333'};
  const mode = ui.lib.tool==='poly'? ui.areaShape : 'poly';
  const cur = ui.mouseW? candidatePoint(ui.mouseW, ui.ortho) : null;
  // Rectangle / circle modes: one anchor point placed, the shape follows the cursor.
  if(mode!=='poly' && ui.drawPts.length===1){
    const a=ui.drawPts[0]; if(!cur) return;
    const shape = mode==='rect'? rectPts(a,cur) : circlePts(a[0],a[1],snap(dist(a,cur)));
    const g = mode==='circle'? curvePts(shape,true) : shape; const sp=g.map(w2s);
    ctx.beginPath(); sp.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.fillStyle=st.fill||'rgba(0,0,0,.05)'; ctx.fill();
    ctx.strokeStyle=st.stroke; ctx.lineWidth=2; ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
    const c0=w2s(a); ctx.fillStyle='#fff'; ctx.strokeStyle='#4fa3ff'; ctx.beginPath(); ctx.arc(c0[0],c0[1],6,0,7); ctx.fill(); ctx.stroke();
    const c=w2s(polyCentroid(g));
    if(mode==='rect'){ label(fmtLen(Math.abs(cur[0]-a[0]))+' × '+fmtLen(Math.abs(cur[1]-a[1]))+' · '+fmtArea(polyArea(g)), c, {bold:true}); }
    else { const r=snap(dist(a,cur)); label('r '+fmtLen(r)+' · '+fmtArea(polyArea(g)), c, {bold:true}); }
    return;
  }
  const pts = ui.drawPts.concat(cur? [cur] : []);
  const smooth = !!(ui.lib.props&&ui.lib.props.smooth) && pts.length>=2;
  const g = smooth? curvePts(pts, false) : pts; const sp=g.map(w2s);
  ctx.beginPath(); sp.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  if(ui.lib.tool==='poly' && pts.length>2){ ctx.closePath(); ctx.fillStyle=st.fill||'rgba(0,0,0,.05)'; ctx.fill(); }
  ctx.strokeStyle=st.stroke; ctx.lineWidth= (ui.lib.props&&ui.lib.props.width)? Math.max(2, ui.lib.props.width*view.scale) : 2; ctx.globalAlpha=(ui.lib.props&&ui.lib.props.width)?.5:1; ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1;
  ctx.fillStyle='#fff'; ctx.strokeStyle='#4fa3ff'; pts.map(w2s).forEach((p,i)=>{ ctx.beginPath(); ctx.arc(p[0],p[1],i===0?6:4,0,7); ctx.fill(); ctx.stroke(); });
  dimEdges(pts, ui.lib.tool==='poly'&&pts.length>2, true);
  if(ui.lib.tool==='poly'&&pts.length>2){ const c=w2s(polyCentroid(pts)); label(fmtArea(polyArea(pts)), c, {bold:true}); }
}
function drawMeasure(){ const m=ui.measure; const b = m.b || (ui.mouseW?[snap(ui.mouseW[0]),snap(ui.mouseW[1])]:null); if(!b) return; const a=w2s(m.a), bb=w2s(b); ctx.strokeStyle='#d32f2f'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(bb[0],bb[1]); ctx.stroke(); ctx.setLineDash([]); const dx=b[0]-m.a[0], dy=b[1]-m.a[1]; label(fmtLen(Math.hypot(dx,dy))+'  (Δx '+fmtLen(Math.abs(dx))+', Δy '+fmtLen(Math.abs(dy))+')', [(a[0]+bb[0])/2,(a[1]+bb[1])/2-12], {color:'#b71c1c', bold:true}); }
function updateHud(){
  const p=ui.mouseW; $('#hud').textContent = p? `x ${fmtLen(snap(p[0]))}   y ${fmtLen(snap(p[1]))}` : '';
  $('#stScale').textContent = `zoom ${view.scale.toFixed(2)} px/in · grid 6" · 1 ft = ${(view.scale*12).toFixed(0)} px`;
  const sel=state.objects.find(o=>o.id===ui.selId); $('#stSel').textContent = sel? 'selected: '+sel.name : '';
}

// ================= Conduit / pipe analysis =================
function bendAngles(pts){ const out=[]; for(let i=1;i<pts.length-1;i++){ const a=pts[i-1],b=pts[i],c=pts[i+1]; const v1=[b[0]-a[0],b[1]-a[1]], v2=[c[0]-b[0],c[1]-b[1]]; const ang=Math.abs(Math.atan2(v1[0]*v2[1]-v1[1]*v2[0], v1[0]*v2[0]+v1[1]*v2[1]))*180/Math.PI; out.push({i, deg:Math.round(ang)}); } return out; }
function conduitFittings(o){
  const bends=bendAngles(o.pts).filter(b=>b.deg>2).map(b=>{ let label,type; if(Math.abs(b.deg-90)<=12){type='90';label='90° sweep';} else if(Math.abs(b.deg-45)<=12){type='45';label='45° elbow';} else if(Math.abs(b.deg-22.5)<=8){type='22';label='22.5° elbow';} else {type='other';label=b.deg+'° (heat-bend)';} return Object.assign(b,{type,label}); });
  const totalDeg=bends.reduce((s,b)=>s+b.deg,0); const len=pathLen(o.pts); const sticks=Math.ceil(len*1.05/120);
  return {bends, totalDeg, len, sticks, couplings:Math.max(0,sticks-1), c90:bends.filter(b=>b.type==='90').length, c45:bends.filter(b=>b.type==='45').length, c22:bends.filter(b=>b.type==='22').length, other:bends.filter(b=>b.type==='other').length};
}
</script>
