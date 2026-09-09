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
    prices:Object.assign({}, DEFAULT_PRICES),
    nextId:1,
  };
}
const view = {scale:2, ox:60, oy:60};   // px per inch, screen offset
const ui = {
  tool:'select', lib:null,            // lib = library entry when drawing/placing
  drawPts:[], mouse:null, mouseW:null,
  selId:null, drag:null, hover:null,
  showGrid:true, snap:true, showDims:true, showArcs:true,
  measure:null, panning:null, space:false,
  hist:[], redo:[],
};
const $ = s=>document.querySelector(s);
const canvas = $('#c'); const ctx = canvas.getContext('2d');

// ================= Helpers =================
const uid = ()=> 'o'+(state.nextId++);
const snap = v => ui.snap ? Math.round(v/GRID)*GRID : Math.round(v*2)/2;
const fmtLen = inches => {
  const neg = inches<0; inches=Math.abs(inches);
  let ft=Math.floor(inches/12), rem=inches-ft*12;
  rem = Math.round(rem*4)/4;
  if(rem>=12){ft++;rem=0;}
  const inStr = rem? (Number.isInteger(rem)?rem:rem.toFixed(2).replace(/0+$/,'').replace(/\.$/,''))+'"' : '';
  let s = ft? ft+"'"+(inStr?'-'+inStr:'') : (inStr||'0"');
  return (neg?'-':'')+s;
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

// ================= History / persistence =================
function pushHist(){ ui.hist.push(JSON.stringify(state.objects)); if(ui.hist.length>100) ui.hist.shift(); ui.redo.length=0; }
function undo(){ if(!ui.hist.length) return; ui.redo.push(JSON.stringify(state.objects)); state.objects=JSON.parse(ui.hist.pop()); ui.selId=null; refresh(); }
function redo(){ if(!ui.redo.length) return; ui.hist.push(JSON.stringify(state.objects)); state.objects=JSON.parse(ui.redo.pop()); ui.selId=null; refresh(); }
let saveTimer=null;
function autosave(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ try{ localStorage.setItem('byd.state', JSON.stringify(state)); $('#stSave').textContent='autosaved '+new Date().toLocaleTimeString(); }catch(e){} },400); }
function loadAutosave(){ try{ const s=localStorage.getItem('byd.state'); if(s){ const st=JSON.parse(s); migrate(st); state=st; return true; } }catch(e){} return false; }
function migrate(st){
  st.layers = Object.assign(Object.fromEntries(LAYERS.map(l=>[l.id,{visible:true,locked:false}])), st.layers||{});
  st.prices = Object.assign({}, DEFAULT_PRICES, st.prices||{});
  st.supply = st.supply||{gpm:6,psi:50};
  st.objects = st.objects||[]; st.nextId = st.nextId||(st.objects.length+1);
  st.objects.forEach(o=>{ o.props=o.props||{}; if(o.rot==null) o.rot=0; });
}

// ================= Object creation =================
function makePoly(lib, pts){ return {id:uid(), type:'poly', kind:lib.kind, layer:lib.layer, name:lib.name, pts, rot:0, props: lib.kind==='rock'?{depth:2}: lib.kind==='paver'?{paver:'12x12'}: lib.kind==='planter'?{}: {}}; }
function makePath(lib, pts){ return {id:uid(), type:'path', kind:lib.kind, layer:lib.layer, name:lib.name, pts, rot:0, props: lib.kind==='trench'?{width:6,depth:18}:{}}; }
function makeItem(lib, x, y){
  const o={id:uid(), type:'item', kind:lib.kind, layer:lib.layer, name:lib.name, x, y, w:lib.w, h:lib.h, rot:0, shape:lib.shape, color:lib.color, props:Object.assign({}, lib.props||{})};
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
  const xs=o.pts.map(p=>p[0]), ys=o.pts.map(p=>p[1]); return {x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};
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
    for(let k=1;k<o.pts.length;k++) if(distToSeg(pw,o.pts[k-1],o.pts[k])<=tol+(KIND_STYLE[o.kind]?.width||2)/2/view.scale) return o; }
  // polygons: smallest area containing point wins; yard last
  let best=null, bestA=Infinity;
  for(const o of objs){ if(o.type!=='poly') continue;
    let hit=pointInPoly(pw,o.pts); if(!hit){ for(let k=0;k<o.pts.length;k++) if(distToSeg(pw,o.pts[k],o.pts[(k+1)%o.pts.length])<=tol){hit=true;break;} }
    if(hit){ const a=polyArea(o.pts)*(o.kind==='yard'?1e6:1); if(a<bestA){bestA=a;best=o;} } }
  return best;
}
function handleHit(o, pw){ // returns {type:'vertex',i} | {type:'mid',i} | {type:'resize'} | null
  const tol=8/view.scale;
  if(o.type==='item'){
    if(o.shape==='text') return null;
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
  const order = ['base','hardscape','trench','plants','irrigation','conduit','lighting','notes'];
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
    const sp=o.pts.map(w2s); ctx.beginPath(); sp.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
    ctx.fillStyle= st.fill||'transparent'; ctx.fill();
    if(st.hatch){ ctx.save(); ctx.clip(); ctx.strokeStyle=st.hatch; ctx.lineWidth=1; const b=objBounds(o); const step=(o.kind==='paver'?(PAVER_SIZES.find(p=>p.id===o.props.paver)||PAVER_SIZES[0]).w:12)*view.scale; if(step>4){ const s0=w2s([b.x0,b.y0]), s1=w2s([b.x1,b.y1]); for(let x=s0[0];x<=s1[0];x+=step){ctx.beginPath();ctx.moveTo(x,s0[1]);ctx.lineTo(x,s1[1]);ctx.stroke();} if(o.kind==='paver'){const ph=(PAVER_SIZES.find(p=>p.id===o.props.paver)||PAVER_SIZES[0]).h*view.scale; for(let y=s0[1];y<=s1[1];y+=ph){ctx.beginPath();ctx.moveTo(s0[0],y);ctx.lineTo(s1[0],y);ctx.stroke();}} } ctx.restore(); }
    if(st.dots){ ctx.save(); ctx.clip(); ctx.fillStyle=st.dots; const b=objBounds(o); const step=8*view.scale; if(step>5){ const s0=w2s([b.x0,b.y0]), s1=w2s([b.x1,b.y1]); let r=0; for(let y=s0[1];y<=s1[1];y+=step,r++) for(let x=s0[0]+(r%2)*step/2;x<=s1[0];x+=step){ ctx.beginPath(); ctx.arc(x,y,1.5,0,7); ctx.fill(); } } ctx.restore(); }
    ctx.setLineDash(st.dash||[]); ctx.strokeStyle= selected?'#4fa3ff':st.stroke; ctx.lineWidth=(st.width||1)+(selected?1:0); ctx.stroke(); ctx.setLineDash([]);
    if(ui.showDims){ dimEdges(o.pts, true, o.kind==='yard'||selected); const c=w2s(polyCentroid(o.pts)); const nm=o.name.replace(' outline',''); label(nm, [c[0],c[1]-7], {bold:true, size:12}); label(fmtArea(polyArea(o.pts))+(o.kind==='rock'?' · '+o.props.depth+'" deep':''), [c[0],c[1]+7], {color:'#444'}); if(o.kind==='yard') label('perimeter '+fmtLen(pathLen(o.pts.concat([o.pts[0]]))), [c[0],c[1]+20], {color:'#666'}); }
  } else if(o.type==='path'){
    const sp=o.pts.map(w2s); ctx.beginPath(); sp.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.setLineDash(st.dash||[]); ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle= selected?'#4fa3ff':st.stroke; ctx.lineWidth= o.kind==='trench'? Math.max(4,o.props.width*view.scale) : (st.width||2)+(selected?1:0); ctx.stroke(); ctx.setLineDash([]);
    if(o.kind==='fence'){ ctx.fillStyle=st.stroke; sp.forEach(p=>{ctx.beginPath();ctx.arc(p[0],p[1],3,0,7);ctx.fill();}); }
    if(o.kind==='conduit'){ // mark fittings at bends
      const f=conduitFittings(o); ctx.fillStyle='#e65100'; f.bends.forEach(b=>{ const p=w2s(o.pts[b.i]); ctx.beginPath(); ctx.arc(p[0],p[1],4,0,7); ctx.fill(); label(b.label, [p[0]+6,p[1]-6], {align:'left', size:10, color:'#e65100'}); }); }
    if(ui.showDims){ if(selected) dimEdges(o.pts,false,true); const e=sp[sp.length-1]; label(o.name.split(' (')[0]+' '+fmtLen(pathLen(o.pts)), [e[0]+8,e[1]-8], {align:'left', color:st.stroke}); }
  } else drawItem(o, selected, st);
}
function dimEdges(pts, closed, strong){
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
  else if(o.shape==='head'){ const zc=zoneColor(o.props.zone); ctx.fillStyle=zc; ctx.beginPath(); ctx.arc(0,0,Math.max(5,w/2),0,7); ctx.fill(); ctx.stroke(); }
  else if(o.shape==='circle'){ ctx.fillStyle=hexA(o.color,.55); ctx.beginPath(); ctx.ellipse(0,0,w/2,h/2,0,0,7); ctx.fill(); ctx.stroke(); if(o.kind==='fountain'){ ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=1; for(let r=w/2*.75;r>3;r*=.6){ctx.beginPath();ctx.arc(0,0,r,0,7);ctx.stroke();} } if(o.kind==='tree'){ ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(0,0,w/2*.5,0,7); ctx.stroke(); } }
  else { ctx.fillStyle=hexA(o.color,.6); ctx.fillRect(-w/2,-h/2,w,h); ctx.strokeRect(-w/2,-h/2,w,h);
    if(o.kind==='gfci'||o.kind==='panel'){ ctx.fillStyle='#000'; ctx.font='bold '+Math.max(8,Math.min(14,h*.6))+'px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(o.kind==='gfci'?'⏚':'P',0,0); } }
  ctx.restore();
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
    if(o.shape==='text') return;
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
  if(!ui.lib || !ui.drawPts.length) { if(ui.lib&&ui.lib.tool==='item'&&ui.mouseW){ const g=makeItem(ui.lib, snap(ui.mouseW[0]), snap(ui.mouseW[1])); ctx.globalAlpha=.5; drawItem(g,false,{}); ctx.globalAlpha=1; } return; }
  const pts = ui.drawPts.concat(ui.mouseW? [[snap(ui.mouseW[0]),snap(ui.mouseW[1])]] : []);
  const sp=pts.map(w2s); const st=KIND_STYLE[ui.lib.kind]||{stroke:'#333'};
  ctx.beginPath(); sp.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  if(ui.lib.tool==='poly' && pts.length>2){ ctx.closePath(); ctx.fillStyle=st.fill||'rgba(0,0,0,.05)'; ctx.fill(); }
  ctx.strokeStyle=st.stroke; ctx.lineWidth=2; ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#fff'; ctx.strokeStyle='#4fa3ff'; sp.forEach((p,i)=>{ ctx.beginPath(); ctx.arc(p[0],p[1],i===0?6:4,0,7); ctx.fill(); ctx.stroke(); });
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
