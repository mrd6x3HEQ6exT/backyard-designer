<script>
'use strict';
// ================= Tools & library UI =================
const TOOLS=[{id:'select',name:'Select (V)'},{id:'pan',name:'Pan (H)'},{id:'measure',name:'Measure (M)'}];
function setTool(id, lib){ ui.tool=id; ui.lib=lib||null; ui.drawPts=[]; ui.measure=null; ui.drag=null;
  document.querySelectorAll('#toolBtns button').forEach(b=>b.classList.toggle('active', b.dataset.id===id && !lib));
  document.querySelectorAll('.libitem').forEach(b=>b.classList.toggle('active', !!lib && b.dataset.id===lib.id));
  $('#canvasWrap').style.cursor = id==='pan'?'grab': id==='select'?'default':'crosshair';
  $('#hint').textContent = lib? (lib.tool==='poly'? `Drawing ${lib.name}: click grid points; click the first point or press Enter to close. Esc cancels.` : lib.tool==='path'? `Drawing ${lib.name}: click points; Enter or double-click to finish. Esc cancels.` : `Placing ${lib.name}: click to place (repeat). Esc to stop.`) : id==='measure'?'Measure: click two points.': id==='select'?'':'Pan: drag.';
  $('#hint').hidden = !$('#hint').textContent; draw(); }
function buildLeft(){
  $('#toolBtns').innerHTML = TOOLS.map(t=>`<button data-id="${t.id}">${t.name}</button>`).join('');
  $('#toolBtns').querySelectorAll('button').forEach(b=> b.onclick=()=>setTool(b.dataset.id));
  const groups={areas:'#libAreas',runs:'#libRuns',irrigation:'#libIrrigation',electrical:'#libElectrical',lighting:'#libLighting',hardscape:'#libHardscape',plants:'#libPlants'};
  for(const [g,sel] of Object.entries(groups)){
    $(sel).innerHTML = LIB[g].map(e=>`<div class="libitem" data-id="${e.id}" title="${esc(e.name)}"><span class="sw ${e.shape==='circle'||e.shape==='plant'?'circle':''}" style="background:${e.color}"></span><span>${e.name}</span>${e.w?`<span class="dim">${e.kind==='plant'?fmtLen(e.w)+' spread':fmtLen(e.w)+'×'+fmtLen(e.h)}</span>`:''}</div>`).join('');
    $(sel).querySelectorAll('.libitem').forEach(d=> d.onclick=()=>{ const e=libById(d.dataset.id); setTool(e.tool==='item'?'place':'draw', e); });
  }
  document.querySelectorAll('.sec h3').forEach(h=> h.onclick=()=>h.parentElement.classList.toggle('closed'));
  ['libHardscape','libPlants','libLighting'].forEach(id=>$('#'+id).parentElement.classList.add('closed'));
}

// ================= Mouse =================
let lastClickT=0;
canvas.addEventListener('contextmenu', e=>e.preventDefault());
canvas.addEventListener('wheel', e=>{ e.preventDefault(); const r=canvas.getBoundingClientRect(); const mx=e.clientX-r.left, my=e.clientY-r.top; const f=Math.exp(-e.deltaY*0.0015); const ns=Math.min(40,Math.max(0.15,view.scale*f)); const k=ns/view.scale; view.ox=mx-(mx-view.ox)*k; view.oy=my-(my-view.oy)*k; view.scale=ns; draw(); },{passive:false});
function evtPos(e){ const r=canvas.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
canvas.addEventListener('mousedown', e=>{
  const sp=evtPos(e), pw=s2w(sp);
  if(e.button===1||e.button===2||ui.space||ui.tool==='pan'){ ui.panning={sx:sp[0],sy:sp[1],ox:view.ox,oy:view.oy}; return; }
  if(e.button!==0) return;
  const gp=[snap(pw[0]),snap(pw[1])];
  if(ui.tool==='measure'){ if(!ui.measure||ui.measure.b){ ui.measure={a:gp}; } else { ui.measure.b=gp; } draw(); return; }
  if(ui.tool==='draw'){
    if(ui.lib.tool==='poly' && ui.drawPts.length>2 && dist(ui.drawPts[0],gp)<8/view.scale){ finishDraw(); return; }
    const now=Date.now(); if(ui.lib.tool==='path' && now-lastClickT<400 && ui.drawPts.length>=2 && dist(ui.drawPts[ui.drawPts.length-1],gp)===0){ lastClickT=0; finishDraw(); return; } lastClickT=now;
    if(!ui.drawPts.length || dist(ui.drawPts[ui.drawPts.length-1],gp)>0) ui.drawPts.push(gp); draw(); return;
  }
  if(ui.tool==='place'){ pushHist(); const o=makeItem(ui.lib, gp[0], gp[1]); state.objects.push(o); ui.selId=o.id; refresh(); return; }
  // select
  const sel=state.objects.find(o=>o.id===ui.selId);
  if(sel && objLayerVisible(sel) && !objLocked(sel)){ const h=handleHit(sel,pw); if(h){
      if(h.type==='vertex' && e.altKey){ if(sel.pts.length>(sel.type==='poly'?3:2)){ pushHist(); sel.pts.splice(h.i,1); refresh(); } return; }
      if(h.type==='mid'){ pushHist(); const a=sel.pts[h.i], b=sel.pts[(h.i+1)%sel.pts.length]; sel.pts.splice(h.i+1,0,[snap((a[0]+b[0])/2),snap((a[1]+b[1])/2)]); ui.drag={type:'vertex',i:h.i+1,o:sel}; refresh(); return; }
      ui.drag=Object.assign({o:sel, start:pw, orig:JSON.parse(JSON.stringify(sel)), pending:true}, h); return; } }
  const hit=hitTest(pw);
  ui.selId = hit? hit.id : null;
  if(hit){ ui.drag={type:'move', o:hit, start:pw, orig:JSON.parse(JSON.stringify(hit)), pending:true}; }
  refresh();
});
window.addEventListener('mousemove', e=>{
  const sp=evtPos(e); const pw=s2w(sp); ui.mouse=sp; ui.mouseW=pw;
  if(ui.panning){ view.ox=ui.panning.ox+sp[0]-ui.panning.sx; view.oy=ui.panning.oy+sp[1]-ui.panning.sy; draw(); return; }
  if(ui.drag){ const d=ui.drag, o=d.o;
    // Snapshot on the first real movement, not on mousedown: a plain click to select
    // used to push an identical state and make the next Ctrl+Z look broken.
    if(d.pending){ if(dist(pw,d.start)*view.scale<3) { draw(); return; } pushHist(); d.pending=false; }
    if(d.type==='move'){ const dx=snap(pw[0]-d.start[0]), dy=snap(pw[1]-d.start[1]);
      if(o.type==='item'){ o.x=d.orig.x+dx; o.y=d.orig.y+dy; } else o.pts=d.orig.pts.map(p=>[p[0]+dx,p[1]+dy]); }
    else if(d.type==='vertex'){ o.pts[d.i]=[snap(pw[0]),snap(pw[1])]; }
    else if(d.type==='resize'){ const lp=toLocal(o,pw); let w=Math.max(1,snap((lp[0]-o.x)*2)), h=Math.max(1,snap((lp[1]-o.y)*2)); if(o.shape==='circle'||o.shape==='plant'||o.shape==='head'){ const m=Math.max(w,h); w=h=m; } // keep center fixed
      o.w=w; o.h=h; }
    else if(d.type==='radius'){ const r=Math.hypot(pw[0]-o.x,pw[1]-o.y); const h=headSpec(o); o.props.radius=Math.min(h.rmax*12, Math.max(h.rmin*12, Math.round(r/6)*6)); }
    else if(d.type==='arcstart'||d.type==='arcend'){ let ang=Math.atan2(pw[1]-o.y,pw[0]-o.x)*180/Math.PI; ang=Math.round(ang/15)*15; if(d.type==='arcstart'){ const end=d.orig.props.start+d.orig.props.arc; o.props.start=ang; o.props.arc=((end-ang)%360+360)%360||360; } else { o.props.arc=((ang-o.props.start)%360+360)%360||360; } }
    draw(); renderProps(); return; }
  if(ui.tool==='select'){ const sel=state.objects.find(o=>o.id===ui.selId); let cur='default'; if(sel&&objLayerVisible(sel)&&!objLocked(sel)){ const h=handleHit(sel,pw); if(h) cur = h.type==='resize'?'nwse-resize': h.type==='mid'?'copy':'pointer'; } if(cur==='default'&&hitTest(pw)) cur='move'; canvas.style.cursor=cur; }
  draw();
});
window.addEventListener('mouseup', e=>{ if(ui.panning){ui.panning=null;} if(ui.drag){ ui.drag=null; refresh(); } });
canvas.addEventListener('mouseleave', ()=>{ ui.mouseW=null; draw(); });
function finishDraw(){
  const lib=ui.lib; const pts=ui.drawPts; ui.drawPts=[];
  if(lib.tool==='poly' && pts.length>=3){ pushHist(); if(lib.kind==='yard') state.objects=state.objects.filter(o=>o.kind!=='yard'); const o=makePoly(lib,pts); state.objects.unshift(o); ui.selId=o.id; }
  else if(lib.tool==='path' && pts.length>=2){ pushHist(); const o=makePath(lib,pts); state.objects.push(o); ui.selId=o.id; }
  if(lib.kind==='yard') setTool('select'); else draw();
  refresh();
}

// ================= Keyboard =================
window.addEventListener('keydown', e=>{
  const tag=e.target.tagName; if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA'){ if(e.key==='Escape') e.target.blur(); return; }
  const sel=state.objects.find(o=>o.id===ui.selId);
  if(e.code==='Space'){ ui.space=true; e.preventDefault(); return; }
  if(e.ctrlKey||e.metaKey){ if(e.key==='z'){undo();e.preventDefault();} else if(e.key==='y'){redo();e.preventDefault();} else if(e.key==='d'&&sel){ e.preventDefault(); duplicateSel(); } return; }
  switch(e.key){
    case 'Escape': if(ui.drawPts.length){ ui.drawPts=[]; draw(); } else if(ui.lib){ setTool('select'); } else { ui.selId=null; ui.measure=null; refresh(); } break;
    case 'Enter': if(ui.tool==='draw') finishDraw(); break;
    case 'Delete': case 'Backspace': if(sel){ pushHist(); state.objects=state.objects.filter(o=>o!==sel); ui.selId=null; refresh(); } break;
    case 'v': case 'V': setTool('select'); break;
    case 'h': case 'H': setTool('pan'); break;
    case 'm': case 'M': setTool('measure'); break;
    case 'g': case 'G': toggleBtn('btnGrid','showGrid'); break;
    case 's': case 'S': toggleBtn('btnSnap','snap'); break;
    case 'd': case 'D': toggleBtn('btnDims','showDims'); break;
    case 'f': case 'F': fitView(); break;
    case 'r': if(sel&&sel.type==='item'){ pushHist(); sel.rot=(sel.rot+15)%360; refresh(); } break;
    case 'R': if(sel&&sel.type==='item'){ pushHist(); sel.rot=(sel.rot+90)%360; refresh(); } break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': if(sel){ e.preventDefault(); pushHist(); const d=e.shiftKey?12:6; const dx=e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0, dy=e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0; moveObj(sel,dx,dy); refresh(); } break;
  }
});
window.addEventListener('keyup', e=>{ if(e.code==='Space') ui.space=false; });
function moveObj(o,dx,dy){ if(o.type==='item'){o.x+=dx;o.y+=dy;} else o.pts=o.pts.map(p=>[p[0]+dx,p[1]+dy]); }
function duplicateSel(){ const sel=state.objects.find(o=>o.id===ui.selId); if(!sel) return; pushHist(); const c=JSON.parse(JSON.stringify(sel)); c.id=uid(); moveObj(c,12,12); state.objects.push(c); ui.selId=c.id; refresh(); }
function toggleBtn(id,prop){ ui[prop]=!ui[prop]; $('#'+id).classList.toggle('active',ui[prop]); draw(); }
function fitView(){ const b=allBounds(); const W=canvas.width/devicePixelRatio, H=canvas.height/devicePixelRatio; if(!b){ view.scale=2; view.ox=60; view.oy=60; draw(); return; } const w=b.x1-b.x0+48, h=b.y1-b.y0+48; view.scale=Math.min(40,Math.max(0.15,Math.min(W/w,H/h))); view.ox=(W-(b.x0+b.x1)*view.scale)/2; view.oy=(H-(b.y0+b.y1)*view.scale)/2; draw(); }

// ================= Right panel =================
function refresh(){ draw(); renderProps(); renderLayers(); renderZones(); renderBom(); autosave(); }
document.querySelectorAll('#tabs button').forEach(b=> b.onclick=()=>{ document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x===b)); document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id==='tab-'+b.dataset.tab)); });
function field(label, inputHtml){ return `<div class="row"><label>${label}</label>${inputHtml}</div>`; }
function renderProps(){
  const el=$('#tab-props'); const o=state.objects.find(x=>x.id===ui.selId);
  if(!o){ el.innerHTML=`<div class="note">Nothing selected. Click an object, or pick a tool on the left.</div><h4>Design summary</h4>${summaryHtml()}`; return; }
  let h=`<h4>${o.type==='item'?'Item':o.type==='poly'?'Area':'Run'} · ${o.kind}</h4>`;
  h+=field('Name', `<input data-p="name" value="${esc(o.name)}">`);
  h+=field('Layer', `<select data-p="layer">${LAYERS.map(l=>`<option value="${l.id}" ${l.id===o.layer?'selected':''}>${l.name}</option>`).join('')}</select>`);
  if(o.type==='item'){
    h+=field('Center X', `<input data-len="x" value="${fmtLen(o.x)}">`)+field('Center Y', `<input data-len="y" value="${fmtLen(o.y)}">`);
    if(o.shape!=='text'&&o.kind!=='head'){ h+=field('Width', `<input data-len="w" value="${fmtLen(o.w)}">`); h+=field('Height/Depth', `<input data-len="h" value="${fmtLen(o.h)}">`); h+=field('Rotation °', `<input type="number" data-num="rot" value="${o.rot}" step="5">`); }
    if(o.kind==='head'){ const hs=headSpec(o);
      h+=field('Model', `<select data-prop="model">${HEADS.map(x=>`<option value="${x.id}" ${x.id===hs.id?'selected':''}>#${x.rank} ${x.brand} ${x.name}</option>`).join('')}</select>`);
      h+=field('Radius', `<input data-lenprop="radius" value="${fmtLen(o.props.radius)}"> <span class="muted" style="font-size:11px;white-space:nowrap">${hs.rmin}–${hs.rmax} ft</span>`);
      h+=field('Arc °', `<input type="number" data-numprop="arc" value="${o.props.arc}" min="40" max="360" step="5">`);
      h+=field('Start angle °', `<input type="number" data-numprop="start" value="${o.props.start}" step="15">`);
      h+=field('Zone', `<input type="number" data-numprop="zone" value="${o.props.zone}" min="1" max="8">`);
      h+=`<div class="note"><b>${headGpm(o)} GPM</b> at this radius/arc (nominal ${hs.gpm360} GPM full circle @ ${hs.psi} PSI). Body: ${hs.body}.</div><div class="note">${hs.why}</div>`;
      h+=`<div class="note">Presets: ${[90,180,270,360].map(a=>`<button class="small" data-arc="${a}">${a}°</button>`).join(' ')}</div>`;
    }
    if(o.kind==='fountain'){ h+=field('Base pad', `<input type="checkbox" data-boolprop="pad" ${o.props.pad?'checked':''}>`); h+=field('Pad size', `<input data-lenprop="padSize" value="${fmtLen(o.props.padSize)}">`); h+=`<div class="note">349 lb cast stone — needs a level compacted base/pad. 120V pump + LED: run conduit to a GFCI in-use outlet here. Autofill: ½" fill line from hose bib to a basin float valve.</div>`; }
    if(o.kind==='plant'){ const p=plantSpec(o); h+=field('Species', `<select data-prop="plant">${PLANTS.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${x.name}</option>`).join('')}</select>`); h+=field('Emitters', `<input type="number" data-numprop="emitters" value="${o.props.emitters}" min="0">`); h+=`<div class="note">${p.bloom}. Mature spread ${fmtLen(p.spread)}, height ${fmtLen(p.height)}. Water: ${p.water}. ${p.pet?'<span class="ok">Pet-safe</span>':'<span class="bad">Not pet-safe</span>'}.</div>`; }
    if(['pathlight','spot','well','walllight','stringpost'].includes(o.kind)) h+=field('Watts', `<input type="number" data-numprop="watts" value="${o.props.watts||0}">`);
    if(o.shape==='text'){ h+=field('Text', `<input data-prop="text" value="${esc(o.props.text||'')}">`); h+=field('Size', `<input type="number" data-numprop="size" value="${o.props.size||12}">`); }
  } else {
    if(o.type==='poly'){ h+=`<div class="note">Area <b>${fmtArea(polyArea(o.pts))}</b> · perimeter ${fmtLen(pathLen(o.pts.concat([o.pts[0]])))} · ${o.pts.length} vertices</div>`;
      if(o.kind==='rock') h+=field('Rock depth', `<input data-lenprop="depth" value="${fmtLen(o.props.depth)}">`)+`<div class="note">${rockCalc(o)}</div>`;
      if(o.kind==='paver') h+=field('Paver size', `<select data-prop="paver">${PAVER_SIZES.map(p=>`<option value="${p.id}" ${p.id===o.props.paver?'selected':''}>${p.id}</option>`).join('')}</select>`)+`<div class="note">≈ ${paverCount(o)} pavers (5% waste)</div>`;
      if(o.kind==='planter') h+=`<div class="note">Planter wall. Place plants inside it from the Plants library; drip line: draw ¼" tubing along it.</div>`;
    } else { h+=`<div class="note">Length <b>${fmtLen(pathLen(o.pts))}</b> · ${o.pts.length-1} segments</div>`;
      if(o.kind==='conduit'){ const f=conduitFittings(o); h+=`<div class="note">${f.sticks} × 10' sticks · ${f.couplings} couplings · ${f.c90} × 90° sweeps · ${f.c45} × 45° · ${f.c22} × 22.5° · ${f.other} other bends<br>Total bend ${f.totalDeg}° ${f.totalDeg>360?'<span class="bad">— exceeds 360° between pull points: add a junction box / LB</span>':'<span class="ok">— OK (≤360°)</span>'}</div>`; }
      if(o.kind==='trench') h+=field('Width', `<input data-lenprop="width" value="${fmtLen(o.props.width)}">`)+field('Depth', `<input data-lenprop="depth" value="${fmtLen(o.props.depth)}">`)+`<div class="note">Dig volume ≈ ${(pathLen(o.pts)*o.props.width*o.props.depth/46656).toFixed(2)} cu yd</div>`;
      if(o.kind==='wire') h+=`<div class="note">Low-voltage: keep total fixture watts under transformer rating; 12-ga wire for runs over ~100 ft.</div>`;
    }
    h+=`<div class="note">Vertices (ft-in):</div><table>${o.pts.map((p,i)=>`<tr><td class="muted">${i+1}</td><td><input data-vx="${i}" value="${fmtLen(p[0])}"></td><td><input data-vy="${i}" value="${fmtLen(p[1])}"></td></tr>`).join('')}</table>`;
  }
  h+=`<div class="btnrow"><button id="pDup">Duplicate</button><button id="pDel">Delete</button>${o.type==='item'?'<button id="pRot">Rotate 90°</button>':''}</div>`;
  el.innerHTML=h;
  const commit=()=>{ refresh(); };
  el.querySelectorAll('[data-p]').forEach(i=> i.onchange=()=>{ pushHist(); o[i.dataset.p]=i.value; commit(); });
  el.querySelectorAll('[data-len]').forEach(i=> i.onchange=()=>{ const v=parseLen(i.value); if(isNaN(v)) {i.value=fmtLen(o[i.dataset.len]);return;} pushHist(); o[i.dataset.len]=Math.max(i.dataset.len==='w'||i.dataset.len==='h'?1:-1e9, v); if((o.shape==='circle'||o.shape==='plant')&&(i.dataset.len==='w'||i.dataset.len==='h')){o.w=o.h=o[i.dataset.len];} commit(); });
  el.querySelectorAll('[data-num]').forEach(i=> i.onchange=()=>{ pushHist(); o[i.dataset.num]=parseFloat(i.value)||0; commit(); });
  el.querySelectorAll('[data-prop]').forEach(i=> i.onchange=()=>{ pushHist(); o.props[i.dataset.prop]=i.value; if(i.dataset.prop==='model'){ const hs=headSpec(o); o.props.radius=Math.min(hs.rmax*12,Math.max(hs.rmin*12,o.props.radius)); o.name=hs.brand+' '+hs.name; } if(i.dataset.prop==='plant'){ const p=plantSpec(o); o.w=o.h=p.spread; o.name=p.name.split(' (')[0].split(' —')[0]; } commit(); });
  el.querySelectorAll('[data-numprop]').forEach(i=> i.onchange=()=>{ pushHist(); let v=parseFloat(i.value)||0;
    const mn=i.min!==''?parseFloat(i.min):-Infinity, mx=i.max!==''?parseFloat(i.max):Infinity; // honour the min/max already on the input
    o.props[i.dataset.numprop]=Math.min(mx,Math.max(mn,v)); commit(); });
  el.querySelectorAll('[data-lenprop]').forEach(i=> i.onchange=()=>{ const v=parseLen(i.value); if(isNaN(v)) return; pushHist(); o.props[i.dataset.lenprop]=v; if(i.dataset.lenprop==='radius'){ const hs=headSpec(o); o.props.radius=Math.min(hs.rmax*12,Math.max(hs.rmin*12,v)); } commit(); });
  el.querySelectorAll('[data-boolprop]').forEach(i=> i.onchange=()=>{ pushHist(); o.props[i.dataset.boolprop]=i.checked; commit(); });
  el.querySelectorAll('[data-arc]').forEach(b=> b.onclick=()=>{ pushHist(); o.props.arc=+b.dataset.arc; commit(); });
  el.querySelectorAll('[data-vx],[data-vy]').forEach(i=> i.onchange=()=>{ const v=parseLen(i.value); if(isNaN(v)) return; pushHist(); const k=i.dataset.vx!=null?0:1; const idx=+(i.dataset.vx??i.dataset.vy); o.pts[idx][k]=v; commit(); });
  $('#pDup').onclick=duplicateSel; $('#pDel').onclick=()=>{ pushHist(); state.objects=state.objects.filter(x=>x!==o); ui.selId=null; refresh(); };
  const pr=$('#pRot'); if(pr) pr.onclick=()=>{ pushHist(); o.rot=(o.rot+90)%360; refresh(); };
}
// Escapes for BOTH attribute values and element text. mistake.md html-attr-quotes covered
// attributes only; BOM rows put user-controlled names into element content via innerHTML.
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function rockCalc(o){ const cuyd=polyArea(o.pts)*o.props.depth/46656; return `≈ ${cuyd.toFixed(2)} cu yd ≈ ${(cuyd*1.35).toFixed(2)} tons (≈ ${Math.ceil(cuyd*27/0.5)} × 0.5 cu ft bags)`; }
function paverCount(o){ const p=PAVER_SIZES.find(p=>p.id===o.props.paver)||PAVER_SIZES[0]; return Math.ceil(polyArea(o.pts)/(p.w*p.h)*1.05); }
function summaryHtml(){
  const yard=state.objects.find(o=>o.kind==='yard'); const lawn=state.objects.filter(o=>o.kind==='lawn'); const heads=state.objects.filter(o=>o.kind==='head');
  let h='<table>';
  h+=`<tr><td>Yard</td><td class="n">${yard?fmtArea(polyArea(yard.pts)):'<span class="warn">not drawn</span>'}</td></tr>`;
  h+=`<tr><td>Lawn</td><td class="n">${fmtArea(lawn.reduce((s,o)=>s+polyArea(o.pts),0))}</td></tr>`;
  h+=`<tr><td>Sprinkler heads</td><td class="n">${heads.length} · ${heads.reduce((s,o)=>s+headGpm(o),0).toFixed(1)} GPM total</td></tr>`;
  h+=`<tr><td>Objects</td><td class="n">${state.objects.length}</td></tr></table>`;
  return h;
}
function renderLayers(){
  $('#tab-layers').innerHTML = LAYERS.map(l=>{ const s=state.layers[l.id]; const n=state.objects.filter(o=>o.layer===l.id).length; return `<div class="layer"><span class="sw" style="background:${l.color}"></span><span class="nm">${l.name} <span class="muted">(${n})</span></span><button class="small ${s.visible?'active':''}" data-vis="${l.id}" title="visible">👁</button><button class="small ${s.locked?'active':''}" data-lock="${l.id}" title="locked">🔒</button></div>`; }).join('')+`<div class="note">Locked layers can't be selected or moved. Hidden layers are excluded from PNG export.</div>`;
  $('#tab-layers').querySelectorAll('[data-vis]').forEach(b=> b.onclick=()=>{ state.layers[b.dataset.vis].visible=!state.layers[b.dataset.vis].visible; refresh(); });
  $('#tab-layers').querySelectorAll('[data-lock]').forEach(b=> b.onclick=()=>{ state.layers[b.dataset.lock].locked=!state.layers[b.dataset.lock].locked; refresh(); });
}
function renderZones(){
  const heads=state.objects.filter(o=>o.kind==='head'); const sup=state.supply.gpm||0; const usable=sup*0.8;
  const zones={}; heads.forEach(o=>{ const z=o.props.zone||1; (zones[z]=zones[z]||{heads:[],gpm:0}); zones[z].heads.push(o); zones[z].gpm+=headGpm(o); });
  const total=heads.reduce((s,o)=>s+headGpm(o),0);
  let h=`<div class="note">Supply ${sup} GPM @ ${state.supply.psi} PSI (bucket test at the hose bib). Design limit = 80% of supply = <b>${usable.toFixed(1)} GPM</b> per zone.</div>`;
  if(heads.length){ const need=Math.max(1,Math.ceil(total/Math.max(usable,0.01))); h+=`<div class="note">Total demand ${total.toFixed(1)} GPM → minimum <b>${need} zone${need>1?'s':''}</b>${need>1?' (the Orbit 50020 timer is 1 zone: add a multi-outlet hose timer or manifold with valves)':' — a single hose-end timer works'}.</div>`; }
  const underPsi=[...new Map(heads.map(o=>headSpec(o)).filter(m=>state.supply.psi<m.psi).map(m=>[m.id,m])).values()];
  if(underPsi.length) h+=`<div class="note bad">Supply is ${state.supply.psi} PSI — below rated pressure for ${underPsi.map(m=>`${m.brand} ${m.name} (needs ≥${m.psi})`).join(', ')}. These heads will fall short of their rated radius and lose uniformity.</div>`;
  const lawnArea=state.objects.filter(o=>o.kind==='lawn').reduce((s,o)=>s+polyArea(o.pts),0)/144;
  Object.keys(zones).sort((a,b)=>a-b).forEach(z=>{ const Z=zones[z]; const pct=usable?Z.gpm/usable*100:0; const cls=pct>100?'bad':pct>90?'warn':'ok'; const zc=zoneColor(z);
    const precip = Z.heads.length? Z.heads.reduce((s,o)=>s+headSpec(o).precip,0)/Z.heads.length : 0;
    h+=`<div class="zone"><b style="color:${zc}">Zone ${z}</b> · ${Z.heads.length} head${Z.heads.length>1?'s':''} · <b class="${cls}">${Z.gpm.toFixed(2)} GPM</b> (${pct.toFixed(0)}% of limit)<div class="bar"><i style="width:${Math.min(100,pct)}%;background:var(--${cls==='ok'?'ok':cls==='warn'?'warn':'bad'})"></i></div>
      <div class="note">${Z.heads.map(o=>headSpec(o).name.replace('MP Rotator ','')+' '+(o.props.radius/12)+"'/"+o.props.arc+'°').join(', ')}</div>
      <div class="note">Avg precip ≈ ${precip.toFixed(2)} in/hr → ~${precip?Math.round(60/precip*0.5):0} min per ½" of water${pct>100?'<br><span class="bad">Over limit: heads will not reach rated radius. Move heads to another zone.</span>':''}</div></div>`; });
  if(!heads.length) h+=`<div class="note">No sprinkler heads placed yet. Irrigation → Sprinkler head, then set model/radius/arc/zone in Properties. Aim for head-to-head coverage: each head's arc should reach the next head.</div>`;
  if(lawnArea) h+=`<div class="note">Lawn area ${lawnArea.toFixed(0)} sq ft. Rule of thumb for Bermuda in a zone 8a summer: ~1–1.25 in/week, split into 2–3 deep waterings.</div>`;
  $('#tab-zones').innerHTML=h;
}

// ================= BOM =================
function computeBom(){
  const rows=[]; const add=(cat,key,item,qty,unit,note)=>{ if(qty>0) rows.push({cat,key,item,qty,unit,note:note||''}); };
  const O=state.objects; const byKind=k=>O.filter(o=>o.kind===k);
  // Conduit
  const cr=byKind('conduit'); if(cr.length){ let len=0,st=0,cp=0,c90=0,c45=0,c22=0,oth=0,over=0; cr.forEach(o=>{const f=conduitFittings(o); len+=f.len; st+=f.sticks; cp+=f.couplings; c90+=f.c90; c45+=f.c45; c22+=f.c22; oth+=f.other; if(f.totalDeg>360) over++;});
    add('Conduit','conduit-stick','Cantex ¾" Sch 40 PVC conduit, 10 ft stick',st,'ea',`${fmtLen(len)} of runs + 5% waste`); add('Conduit','conduit-coupling','Cantex ¾" PVC coupling',cp,'ea'); add('Conduit','conduit-90','Cantex ¾" 90° sweep elbow',c90,'ea'); add('Conduit','conduit-45','Cantex ¾" 45° elbow',c45,'ea'); add('Conduit','conduit-22','Cantex ¾" 22.5° elbow',c22,'ea'); if(oth) add('Conduit','conduit-other','Non-standard bends (heat-bend or use pull box)',oth,'ea','check angles'); add('Conduit','conduit-adapter','Cantex ¾" terminal/male adapter (2 per run)',cr.length*2,'ea'); add('Conduit','conduit-cement','PVC primer + cement',1,'kit'); if(over) add('Conduit','conduit-jbox','⚠ runs exceeding 360° of bends — add pull box',over,'run'); }
  add('Conduit','conduit-jbox','Cantex PVC junction box 4×4',byKind('jbox').length,'ea'); add('Conduit','conduit-lb','Cantex LB conduit body ¾"',byKind('lb').length,'ea'); add('Conduit','gfci-outlet','In-use GFCI outlet + weatherproof box/cover',byKind('gfci').length,'ea');
  // Irrigation pipe
  const pr=byKind('pipe'); if(pr.length){ const len=pr.reduce((s,o)=>s+pathLen(o.pts),0); const bends=pr.reduce((s,o)=>s+bendAngles(o.pts).filter(b=>b.deg>2).length,0); add('Irrigation','pipe-ft','½" poly / Blu-Lock tubing (ft)',Math.ceil(len/12*1.1),'ft',`${fmtLen(len)} + 10%`); add('Irrigation','pipe-elbow','½" elbow fittings',bends,'ea'); add('Irrigation','pipe-endcap','½" end caps / auto-drains',pr.length,'ea'); }
  const heads=byKind('head'); const byModel={}; heads.forEach(o=>{const m=headSpec(o); byModel[m.id]=(byModel[m.id]||0)+1;}); Object.entries(byModel).forEach(([id,n])=>{ const m=HEADS.find(h=>h.id===id); add('Irrigation','head-'+id,`#${m.rank} ${m.brand} ${m.name}`,n,'ea'); if(id!=='orbit-gear') add('Irrigation','body-'+id,m.body,n,'ea'); }); if(heads.length) add('Irrigation','pipe-tee','½" tee + swing pipe/riser per head',heads.length,'ea');
  add('Irrigation','timer','Hose-end timer',byKind('timer').length,'ea'); add('Irrigation','manifold','Multi-zone manifold / valves',byKind('manifold').length,'ea'); add('Irrigation','backflow','Vacuum breaker',byKind('backflow').length,'ea'); add('Irrigation','filter','Drip filter + 25 PSI regulator',byKind('filter').length,'ea'); add('Irrigation','valvebox','Valve box',byKind('valvebox').length,'ea'); add('Irrigation','floatvalve','Basin float valve (fountain autofill)',byKind('floatvalve').length,'ea');
  const dr=byKind('drip'); if(dr.length) add('Irrigation','drip-ft','¼" drip tubing (ft)',Math.ceil(dr.reduce((s,o)=>s+pathLen(o.pts),0)/12*1.1),'ft');
  const d12=byKind('drip12'); if(d12.length) add('Irrigation','drip12-ft','½" drip main / fill line (ft)',Math.ceil(d12.reduce((s,o)=>s+pathLen(o.pts),0)/12*1.1),'ft');
  const plants=byKind('plant'); const em=plants.reduce((s,o)=>s+(o.props.emitters||0),0); add('Irrigation','emitter','1 GPH drip emitters',em,'ea');
  // Hardscape
  byKind('rock').forEach(o=>{ const cuyd=polyArea(o.pts)*o.props.depth/46656; add('Hardscape','rock-ton',`Decorative rock — ${o.name} (${fmtArea(polyArea(o.pts))} × ${o.props.depth}")`,+(cuyd*1.35).toFixed(2),'ton',`${cuyd.toFixed(2)} cu yd`); });
  byKind('paver').forEach(o=>add('Hardscape','paver-unit',`Pavers ${o.props.paver} — ${o.name} (${fmtArea(polyArea(o.pts))})`,paverCount(o),'ea','5% waste'));
  const pu={}; byKind('paverunit').forEach(o=>{const k=fmtLen(o.w)+'×'+fmtLen(o.h); pu[k]=(pu[k]||0)+1;}); Object.entries(pu).forEach(([k,n])=>add('Hardscape','paver-unit','Paver '+k+' (placed singly)',n,'ea'));
  byKind('patio').forEach(o=>add('Hardscape','patio-sqft',`Patio/concrete — ${o.name}`,+(polyArea(o.pts)/144).toFixed(1),'sq ft'));
  byKind('planter').forEach(o=>add('Hardscape','fence-ft',`Garden wall — ${o.name}`,+(pathLen(o.pts.concat([o.pts[0]]))/12).toFixed(1),'ft perimeter',fmtArea(polyArea(o.pts))));
  byKind('fountain').forEach(o=>{ add('Hardscape','fountain',"Hurricane's Eye Spiral Fountain 29\" (349 lb)",1,'ea'); if(o.props.pad) add('Hardscape','fountain-pad',`Fountain base pad ${fmtLen(o.props.padSize)} sq`,1,'ea',`${(o.props.padSize*o.props.padSize/144).toFixed(1)} sq ft`); });
  ['boulder','firepit','raisedbed','furniture','shed','tree','shrub'].forEach(k=>{ const n={}; byKind(k).forEach(o=>{n[o.name]=(n[o.name]||0)+1;}); Object.entries(n).forEach(([nm,c])=>add('Hardscape',k,nm,c,'ea')); });
  const fe=byKind('fence'); if(fe.length) add('Hardscape','fence-ft','Fence / wall (ft)',+(fe.reduce((s,o)=>s+pathLen(o.pts),0)/12).toFixed(1),'ft');
  // Lighting
  ['pathlight','spot','well','walllight','stringpost'].forEach(k=>{ const n=byKind(k).length; if(n) add('Lighting',k,libById(k==='walllight'?'wall':k==='stringpost'?'string':k).name,n,'ea',`${byKind(k).reduce((s,o)=>s+(o.props.watts||0),0)} W`); });
  const wr=byKind('wire'); if(wr.length) add('Lighting','wire-ft','Low-voltage landscape wire (ft)',Math.ceil(wr.reduce((s,o)=>s+pathLen(o.pts),0)/12*1.1),'ft'); add('Lighting','transformer','LV transformer',byKind('transformer').length,'ea',`load ${O.filter(o=>['pathlight','spot','well','walllight','stringpost'].includes(o.kind)).reduce((s,o)=>s+(o.props.watts||0),0)} W`);
  // Plants
  const pc={}; plants.forEach(o=>{ const p=plantSpec(o); pc[p.name]=(pc[p.name]||0)+1; }); Object.entries(pc).forEach(([nm,n])=>add('Plants','plant',nm,n,'ea'));
  // Trench
  const tr=byKind('trench'); if(tr.length) add('Dig plan','trench-ft','Trench (ft)',+(tr.reduce((s,o)=>s+pathLen(o.pts),0)/12).toFixed(1),'ft',`${tr.reduce((s,o)=>s+pathLen(o.pts)*o.props.width*o.props.depth,0)/46656>0?(tr.reduce((s,o)=>s+pathLen(o.pts)*o.props.width*o.props.depth,0)/46656).toFixed(2)+' cu yd':''}`);
  return rows;
}
function renderBom(){
  const rows=computeBom(); const el=$('#tab-bom'); if(!rows.length){ el.innerHTML='<div class="note">Nothing to list yet.</div>'; return; }
  let total=0, h=''; let cat='';
  rows.forEach((r,i)=>{ if(r.cat!==cat){ if(cat) h+='</table>'; cat=r.cat; h+=`<h4>${cat}</h4><table><tr><th>Item</th><th class="n">Qty</th><th class="n">$ / unit</th><th class="n">Ext</th></tr>`; } const price=state.prices[r.key]??0; const ext=price*r.qty; total+=ext; h+=`<tr><td>${esc(r.item)}${r.note?`<div class="muted">${esc(r.note)}</div>`:''}</td><td class="n">${r.qty} ${r.unit}</td><td class="n"><input data-price="${r.key}" value="${price}"></td><td class="n">$${ext.toFixed(2)}</td></tr>`; });
  h+='</table>'+`<h4>Total</h4><div style="font-size:16px"><b>$${total.toFixed(2)}</b></div><div class="note">Prices are editable placeholders and save with the design. Items sharing a key share a price.</div>`;
  el.innerHTML=h; el.querySelectorAll('[data-price]').forEach(i=> i.onchange=()=>{ state.prices[i.dataset.price]=parseFloat(i.value)||0; renderBom(); autosave(); });
}
function bomCsv(){ const rows=computeBom(); let s='Category,Item,Qty,Unit,UnitPrice,Ext,Note\n'; rows.forEach(r=>{ const p=state.prices[r.key]??0; s+=[r.cat,r.item,r.qty,r.unit,p,(p*r.qty).toFixed(2),r.note].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')+'\n'; }); download('backyard-bom.csv', s, 'text/csv'); }

// ================= IO =================
function download(name, content, type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }
$('#btnExport').onclick=()=>{ state.build=BUILD_ID; state.savedAt=new Date().toISOString(); download('backyard-design.json', JSON.stringify(state,null,1), 'application/json'); };
$('#btnImport').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ const st=JSON.parse(r.result); migrate(st); state=st; ui.selId=null; ui.hist=[]; ui.redo=[]; syncSupply(); refresh(); fitView(); }catch(err){ alert('Could not read file: '+err.message); } }; r.readAsText(f); e.target.value=''; };
$('#btnNew').onclick=()=>{ if(!confirm('Clear the whole design? (Export first if you want to keep it.)')) return; state=newState(); ui.selId=null; ui.hist=[]; ui.redo=[]; syncSupply(); refresh(); fitView(); };
$('#btnBom').onclick=bomCsv;
$('#btnUndo').onclick=undo; $('#btnRedo').onclick=redo;
$('#btnGrid').onclick=()=>toggleBtn('btnGrid','showGrid'); $('#btnSnap').onclick=()=>toggleBtn('btnSnap','snap'); $('#btnDims').onclick=()=>toggleBtn('btnDims','showDims'); $('#btnArcs').onclick=()=>toggleBtn('btnArcs','showArcs'); $('#btnFit').onclick=fitView;
$('#supplyGpm').onchange=e=>{ state.supply.gpm=parseFloat(e.target.value)||0; renderZones(); autosave(); }; $('#supplyPsi').onchange=e=>{ state.supply.psi=parseFloat(e.target.value)||0; renderZones(); autosave(); };
function syncSupply(){ $('#supplyGpm').value=state.supply.gpm; $('#supplyPsi').value=state.supply.psi; }
$('#btnPng').onclick=()=>{
  const b=allBounds(); if(!b){ alert('Nothing to export yet.'); return; }
  const ppf = parseFloat(prompt('Pixels per foot for the PNG (24 = ¼"=1\' at 96 dpi, 48 = ½"=1\')','48')); if(!ppf) return;
  const scale=ppf/12, margin=24; const w=Math.ceil((b.x1-b.x0+margin*2)*scale), h=Math.ceil((b.y1-b.y0+margin*2)*scale);
  if(w*h>60e6){ alert('Too large — use fewer pixels per foot.'); return; }
  const saved={scale:view.scale,ox:view.ox,oy:view.oy,cw:canvas.width,ch:canvas.height,sw:canvas.style.width,sh:canvas.style.height,sel:ui.selId,m:ui.mouseW};
  const dpr=devicePixelRatio; canvas.width=w*dpr; canvas.height=h*dpr; canvas.style.width=w+'px'; canvas.style.height=h+'px';
  view.scale=scale; view.ox=(margin-b.x0)*scale; view.oy=(margin-b.y0)*scale; ui.selId=null; ui.mouseW=null; draw();
  // title block
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.font='12px system-ui'; ctx.fillStyle='#333'; ctx.textAlign='left'; ctx.textBaseline='bottom'; ctx.fillText(`Backyard Designer · ${new Date().toLocaleDateString()} · scale ${ppf} px/ft · grid 6"`, 8, h-6);
  canvas.toBlob(blob=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='backyard-plan.png'; a.click();
    canvas.width=saved.cw; canvas.height=saved.ch; canvas.style.width=saved.sw; canvas.style.height=saved.sh; view.scale=saved.scale; view.ox=saved.ox; view.oy=saved.oy; ui.selId=saved.sel; draw(); });
};

// ================= Init =================
$('#buildId').textContent='build '+BUILD_ID;
buildLeft();
const restored=loadAutosave(); syncSupply();
resize(); setTool('select'); refresh(); if(restored) fitView(); else { view.scale=2; view.ox=80; view.oy=80; draw(); }
</script>
</body>
</html>
