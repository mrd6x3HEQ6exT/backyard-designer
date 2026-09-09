<script>
'use strict';
const BUILD_ID = '2026.09.08.3';
const GRID = 6;           // inches
const FT = 12;

// ---------- Layers ----------
const LAYERS = [
  {id:'base',       name:'Base plan (yard, house, fixed)', color:'#333333'},
  {id:'hardscape',  name:'Hardscape',                      color:'#8d6e63'},
  {id:'irrigation', name:'Irrigation',                     color:'#1e88e5'},
  {id:'conduit',    name:'Electrical conduit',             color:'#fb8c00'},
  {id:'lighting',   name:'Landscape lighting',             color:'#8e24aa'},
  {id:'plants',     name:'Plants',                         color:'#43a047'},
  {id:'trench',     name:'Trench / dig plan',              color:'#6d4c41'},
  {id:'notes',      name:'Notes / labels',                 color:'#555555'},
];

// ---------- Sprinkler head database, ranked best -> worst for a small hose-bib-fed lawn ----------
// gpm360 = full-circle GPM at nominal radius & psi. GPM is scaled by arc/360 (matched-precip nozzles do this by design; sprays approx).
const HEADS = [
  {id:'mp1000', rank:1, brand:'Hunter', name:'MP Rotator MP1000', rmin:8, rmax:15, radius:15, gpm360:0.74, psi:40, body:'Hunter Pro-Spray PRS40 4" pop-up (pressure-regulated)', precip:0.4,
   why:'Best uniformity and wind resistance; matched precipitation at any arc; low flow means more heads per zone on a hose bib. Needs a pressure-regulated body (40 PSI at head).'},
  {id:'mp2000', rank:2, brand:'Hunter', name:'MP Rotator MP2000', rmin:13, rmax:21, radius:21, gpm360:1.74, psi:40, body:'Hunter Pro-Spray PRS40 4" pop-up', precip:0.4,
   why:'Same as MP1000 with longer throw; use where 15 ft is not enough (the 22-ft-wide lawn section can use these on the edges).'},
  {id:'mpss', rank:3, brand:'Hunter', name:'MP Rotator Side Strip (5×30)', rmin:5, rmax:15, radius:15, gpm360:0.46, psi:40, body:'Hunter Pro-Spray PRS40 4" pop-up', precip:0.4, strip:true,
   why:'For the 8×15 side strip — waters a 5-ft-wide band without overspray onto walls or the patio.'},
  {id:'rvan14', rank:4, brand:'Rain Bird', name:'R-VAN14 rotary nozzle', rmin:8, rmax:14, radius:14, gpm360:1.27, psi:45, body:'Rain Bird 1804-PRS 4" pop-up (45 PSI regulated)', precip:0.6,
   why:'Close second to MP Rotator; tool-free arc adjust; slightly higher precip rate (shorter run times). Pairs with Rain Bird 1800 PRS bodies.'},
  {id:'rvan18', rank:5, brand:'Rain Bird', name:'R-VAN18 rotary nozzle', rmin:13, rmax:18, radius:17, gpm360:1.85, psi:45, body:'Rain Bird 1804-PRS 4" pop-up', precip:0.6,
   why:'Longer-throw R-VAN.'},
  {id:'hevan15', rank:6, brand:'Rain Bird', name:'HE-VAN-15 spray nozzle', rmin:4, rmax:15, radius:15, gpm360:3.7, psi:30, body:'Rain Bird 1804 4" pop-up', precip:1.6,
   why:'High-efficiency fixed spray. Cheap and simple but ~3.7 GPM per full-circle head — a hose bib supports only 1–2 full-circle heads per zone. Mists in wind.'},
  {id:'orbit-spray', rank:7, brand:'Orbit', name:'4" pop-up adjustable spray (Orbit)', rmin:4, rmax:15, radius:15, gpm360:3.5, psi:30, body:'Orbit 4" pop-up (built in)', precip:1.6,
   why:'Big-box equivalent of a VAN spray. High flow, high precip rate; fine for small strips, poor for whole-lawn coverage on a hose bib.'},
  {id:'orbit-gear', rank:8, brand:'Orbit', name:'Gear-drive rotor (Orbit 50020 kit head)', rmin:15, rmax:25, radius:20, gpm360:2.2, psi:50, body:'Included in kit (Blu-Lock ½" tubing)', precip:0.5,
   why:'What the 50020 kit ships with (6 heads, 15–25 ft, needs ≥50 PSI & ≥5 GPM). Minimum 15-ft throw overshoots a 22-ft-wide lawn from the edges; hard to get head-to-head coverage without watering the patio and fences. Keep the kit tubing/timer, swap the heads.'},
];

// ---------- Plant database: full-sun perennials for USDA zone 8a, ~4,600 ft elevation, monsoon summer ----------
const PLANTS = [
  {id:'gaillardia',   name:'Blanket flower (Gaillardia)',              spread:18, height:18, color:'#ff7f2a', bloom:'Red/orange/yellow, spring–frost', pet:true,  water:'low'},
  {id:'salvia-greggii',name:'Autumn sage (Salvia greggii)',             spread:30, height:30, color:'#e53935', bloom:'Red/coral/pink/purple, Mar–Nov', pet:true, water:'low'},
  {id:'blackfoot',    name:'Blackfoot daisy (Melampodium)',             spread:18, height:10, color:'#ffffff', bloom:'White, nearly year-round', pet:true, water:'very low'},
  {id:'coreopsis',    name:'Coreopsis (tickseed)',                      spread:18, height:18, color:'#ffd600', bloom:'Yellow/bicolor, summer', pet:true, water:'low'},
  {id:'penstemon',    name:'Firecracker penstemon (P. eatonii)',        spread:18, height:30, color:'#d50000', bloom:'Red spikes, spring', pet:true, water:'low'},
  {id:'parry',        name:"Parry's penstemon",                         spread:18, height:36, color:'#ec407a', bloom:'Pink spikes, spring', pet:true, water:'low'},
  {id:'desert-marigold',name:'Desert marigold (Baileya)',               spread:15, height:15, color:'#ffeb3b', bloom:'Yellow, spring–fall, reseeds', pet:true, water:'very low'},
  {id:'chocolate',    name:'Chocolate flower (Berlandiera)',            spread:24, height:15, color:'#ffca28', bloom:'Yellow, cocoa scent, spring–fall', pet:true, water:'low'},
  {id:'yarrow',       name:'Yarrow (Achillea) — mildly toxic to dogs',  spread:24, height:24, color:'#f06292', bloom:'Yellow/red/pink, summer', pet:false, water:'low'},
  {id:'echinacea',    name:'Coneflower (Echinacea)',                    spread:18, height:30, color:'#ab47bc', bloom:'Purple/orange/red, summer', pet:true, water:'medium'},
  {id:'rudbeckia',    name:'Black-eyed Susan (Rudbeckia)',              spread:18, height:24, color:'#ffb300', bloom:'Gold, summer–fall', pet:true, water:'medium'},
  {id:'agastache',    name:'Hummingbird mint (Agastache)',              spread:20, height:30, color:'#ff8a65', bloom:'Orange/pink/purple, summer–fall', pet:true, water:'low'},
  {id:'damianita',    name:'Damianita (Chrysactinia)',                  spread:20, height:15, color:'#fdd835', bloom:'Gold, spring & fall', pet:true, water:'very low'},
  {id:'angelita',     name:'Angelita daisy (Tetraneuris)',              spread:12, height:12, color:'#ffee58', bloom:'Yellow, nearly year-round', pet:true, water:'low'},
  {id:'verbena',      name:'Verbena (Glandularia)',                     spread:24, height:8,  color:'#7e57c2', bloom:'Purple/pink, spring–fall, spiller', pet:true, water:'low'},
  {id:'catmint',      name:'Catmint (Nepeta)',                          spread:24, height:15, color:'#5c6bc0', bloom:'Blue-violet, spring–fall', pet:true, water:'low'},
  {id:'lantana',      name:'Lantana — TOXIC to dogs/cats',              spread:36, height:24, color:'#ff5722', bloom:'Orange/yellow/pink, all summer', pet:false, water:'low'},
  {id:'redyucca',     name:'Red yucca (Hesperaloe) — mildly toxic',     spread:36, height:36, color:'#e57373', bloom:'Coral spikes, spring–summer', pet:false, water:'very low'},
];

// ---------- Object library ----------
// tool: 'poly' (draw area), 'path' (draw run), 'item' (place)
const LIB = {
  areas: [
    {id:'yard',    name:'Yard outline',            tool:'poly', kind:'yard',    layer:'base',      color:'#222222'},
    {id:'house',   name:'House / structure',       tool:'poly', kind:'house',   layer:'base',      color:'#9e9e9e'},
    {id:'patio',   name:'Patio / concrete',        tool:'poly', kind:'patio',   layer:'hardscape', color:'#bdbdbd'},
    {id:'lawn',    name:'Lawn (Bermuda)',          tool:'poly', kind:'lawn',    layer:'plants',    color:'#7cb342'},
    {id:'paver',   name:'Paver area',              tool:'poly', kind:'paver',   layer:'hardscape', color:'#c9a27a'},
    {id:'rock',    name:'Decorative rock',         tool:'poly', kind:'rock',    layer:'hardscape', color:'#b0a090'},
    {id:'mulch',   name:'Mulch / planting bed',    tool:'poly', kind:'mulch',   layer:'plants',    color:'#8d6e63'},
    {id:'planter', name:'Garden wall / planter',   tool:'poly', kind:'planter', layer:'hardscape', color:'#5d4037'},
    {id:'area',    name:'Generic area',            tool:'poly', kind:'area',    layer:'notes',     color:'#90a4ae'},
  ],
  runs: [
    {id:'fence',   name:'Fence / wall',                     tool:'path', kind:'fence',   layer:'base',       color:'#333333'},
    {id:'pipe',    name:'½" poly / Blu-Lock pipe (sprinkler)', tool:'path', kind:'pipe',  layer:'irrigation', color:'#1e88e5'},
    {id:'drip',    name:'¼" drip tubing',                   tool:'path', kind:'drip',    layer:'irrigation', color:'#4fc3f7'},
    {id:'drip12',  name:'½" drip main / fountain fill line', tool:'path', kind:'drip12', layer:'irrigation', color:'#0288d1'},
    {id:'conduit', name:'Cantex ¾" PVC conduit run',        tool:'path', kind:'conduit', layer:'conduit',    color:'#fb8c00'},
    {id:'wire',    name:'Low-voltage lighting wire',        tool:'path', kind:'wire',    layer:'lighting',   color:'#8e24aa'},
    {id:'trench',  name:'Trench',                           tool:'path', kind:'trench',  layer:'trench',     color:'#6d4c41'},
  ],
  irrigation: [
    {id:'head',      name:'Sprinkler head',                     tool:'item', kind:'head',   layer:'irrigation', w:4,  h:4,  shape:'head',   color:'#1e88e5'},
    {id:'hosebib',   name:'Hose bib (supply)',                  tool:'item', kind:'hosebib',layer:'base',       w:6,  h:6,  shape:'rect',   color:'#0d47a1'},
    {id:'timer',     name:'Hose-end timer (Orbit)',             tool:'item', kind:'timer',  layer:'irrigation', w:6,  h:4,  shape:'rect',   color:'#1565c0'},
    {id:'manifold',  name:'Multi-zone manifold / valves',       tool:'item', kind:'manifold',layer:'irrigation',w:14, h:8,  shape:'rect',   color:'#1565c0'},
    {id:'backflow',  name:'Vacuum breaker / backflow',          tool:'item', kind:'backflow',layer:'irrigation',w:4,  h:4,  shape:'rect',   color:'#1565c0'},
    {id:'filter',    name:'Filter + pressure regulator (drip)', tool:'item', kind:'filter', layer:'irrigation', w:6,  h:3,  shape:'rect',   color:'#1565c0'},
    {id:'floatvalve',name:'Basin float valve (fountain autofill)',tool:'item',kind:'floatvalve',layer:'irrigation',w:4,h:4, shape:'circle', color:'#00acc1'},
    {id:'valvebox',  name:'Valve box',                          tool:'item', kind:'valvebox',layer:'irrigation',w:12, h:17, shape:'rect',   color:'#37474f'},
  ],
  electrical: [
    {id:'panel',   name:'Power source (panel / house outlet)', tool:'item', kind:'panel',  layer:'conduit', w:8,  h:4,  shape:'rect',   color:'#e65100'},
    {id:'gfci',    name:'In-use GFCI outlet (post/box)',      tool:'item', kind:'gfci',   layer:'conduit', w:5,  h:5,  shape:'rect',   color:'#fb8c00'},
    {id:'jbox',    name:'Cantex PVC junction box 4×4',        tool:'item', kind:'jbox',   layer:'conduit', w:4,  h:4,  shape:'rect',   color:'#fb8c00'},
    {id:'lb',      name:'Cantex LB conduit body ¾"',          tool:'item', kind:'lb',     layer:'conduit', w:3,  h:2,  shape:'rect',   color:'#fb8c00'},
    {id:'transformer',name:'LV lighting transformer',         tool:'item', kind:'transformer',layer:'lighting',w:8,h:5, shape:'rect',   color:'#6a1b9a'},
  ],
  lighting: [
    {id:'pathlight',name:'Path light',      tool:'item', kind:'pathlight',layer:'lighting', w:6,  h:6,  shape:'circle', color:'#ba68c8', props:{watts:4}},
    {id:'spot',     name:'Spot / up-light', tool:'item', kind:'spot',     layer:'lighting', w:4,  h:4,  shape:'circle', color:'#9c27b0', props:{watts:5}},
    {id:'well',     name:'Well light (in-ground)',tool:'item',kind:'well', layer:'lighting', w:4,  h:4,  shape:'circle', color:'#7b1fa2', props:{watts:5}},
    {id:'wall',     name:'Wall wash / step light',tool:'item',kind:'walllight',layer:'lighting',w:6,h:2, shape:'rect',   color:'#8e24aa', props:{watts:3}},
    {id:'string',   name:'String light post',tool:'item', kind:'stringpost',layer:'lighting',w:4,h:4, shape:'circle', color:'#ce93d8', props:{watts:0}},
  ],
  hardscape: [
    {id:'fountain', name:"Hurricane's Eye fountain 29\"", tool:'item', kind:'fountain', layer:'hardscape', w:29, h:29, shape:'circle', color:'#4dd0e1', props:{pad:true, padSize:48}},
    {id:'paver12',  name:'Paver 12×12',      tool:'item', kind:'paverunit', layer:'hardscape', w:12, h:12, shape:'rect', color:'#c9a27a'},
    {id:'paver16',  name:'Paver 16×16',      tool:'item', kind:'paverunit', layer:'hardscape', w:16, h:16, shape:'rect', color:'#c9a27a'},
    {id:'paver24',  name:'Stepping stone 24×24', tool:'item', kind:'paverunit', layer:'hardscape', w:24, h:24, shape:'rect', color:'#c9a27a'},
    {id:'boulder',  name:'Boulder (~2 ft)',  tool:'item', kind:'boulder',   layer:'hardscape', w:24, h:20, shape:'circle', color:'#8d8d8d'},
    {id:'firepit',  name:'Fire pit 36"',     tool:'item', kind:'firepit',   layer:'hardscape', w:36, h:36, shape:'circle', color:'#e64a19'},
    {id:'raisedbed',name:'Raised bed 4×8',   tool:'item', kind:'raisedbed', layer:'hardscape', w:96, h:48, shape:'rect',   color:'#6d4c41'},
    {id:'bench',    name:'Bench 5 ft',       tool:'item', kind:'furniture', layer:'hardscape', w:60, h:20, shape:'rect',   color:'#795548'},
    {id:'table',    name:'Patio table 48"',  tool:'item', kind:'furniture', layer:'hardscape', w:48, h:48, shape:'circle', color:'#795548'},
    {id:'chair',    name:'Chair',            tool:'item', kind:'furniture', layer:'hardscape', w:24, h:24, shape:'rect',   color:'#a1887f'},
    {id:'grill',    name:'Grill',            tool:'item', kind:'furniture', layer:'hardscape', w:52, h:24, shape:'rect',   color:'#424242'},
    {id:'shed',     name:'Shed 8×10',        tool:'item', kind:'shed',      layer:'base',      w:120,h:96, shape:'rect',   color:'#9e9e9e'},
    {id:'ac',       name:'A/C condenser',    tool:'item', kind:'fixed',     layer:'base',      w:36, h:36, shape:'rect',   color:'#9e9e9e'},
    {id:'gate',     name:'Gate',             tool:'item', kind:'gate',      layer:'base',      w:48, h:4,  shape:'rect',   color:'#333333'},
    {id:'tree',     name:'Tree (canopy)',    tool:'item', kind:'tree',      layer:'plants',    w:120,h:120,shape:'circle', color:'#2e7d32'},
    {id:'shrub',    name:'Shrub',            tool:'item', kind:'shrub',     layer:'plants',    w:36, h:36, shape:'circle', color:'#388e3c'},
    {id:'label',    name:'Text label',       tool:'item', kind:'label',     layer:'notes',     w:1,  h:1,  shape:'text',   color:'#333333', props:{text:'Note', size:12}},
  ],
};
LIB.plants = PLANTS.map(p=>({id:'plant-'+p.id, name:p.name, tool:'item', kind:'plant', layer:'plants', w:p.spread, h:p.spread, shape:'plant', color:p.color, props:{plant:p.id, emitters:1}}));

const KIND_STYLE = {
  yard:   {stroke:'#222', width:3, fill:'rgba(0,0,0,0)'},
  house:  {stroke:'#616161', width:2, fill:'rgba(158,158,158,.45)', hatch:'#757575'},
  patio:  {stroke:'#8a8a8a', width:1.5, fill:'rgba(189,189,189,.55)'},
  lawn:   {stroke:'#558b2f', width:1, fill:'rgba(139,195,74,.45)'},
  paver:  {stroke:'#8d6e63', width:1, fill:'rgba(201,162,122,.6)', hatch:'#a1887f'},
  rock:   {stroke:'#8d8d8d', width:1, fill:'rgba(176,160,144,.55)', dots:'#6d6d6d'},
  mulch:  {stroke:'#6d4c41', width:1, fill:'rgba(141,110,99,.5)'},
  planter:{stroke:'#4e342e', width:4, fill:'rgba(121,85,72,.35)'},
  area:   {stroke:'#607d8b', width:1, fill:'rgba(144,164,174,.25)', dash:[6,4]},
  fence:  {stroke:'#333', width:3},
  pipe:   {stroke:'#1e88e5', width:3},
  drip:   {stroke:'#4fc3f7', width:2, dash:[5,4]},
  drip12: {stroke:'#0288d1', width:3, dash:[8,4]},
  conduit:{stroke:'#fb8c00', width:3.5},
  wire:   {stroke:'#8e24aa', width:2, dash:[3,4]},
  trench: {stroke:'rgba(109,76,65,.35)', width:12},
};

const PAVER_SIZES = [{id:'12x12',w:12,h:12},{id:'16x16',w:16,h:16},{id:'24x24',w:24,h:24},{id:'6x9',w:6,h:9},{id:'12x24',w:12,h:24}];
const ZONE_COLORS = ['#1e88e5','#43a047','#fb8c00','#8e24aa','#e53935','#00acc1','#fdd835','#6d4c41'];

// Default unit prices (editable in BOM; persisted with the design). Ballpark big-box pricing.
const DEFAULT_PRICES = {
  'conduit-stick':4.5,'conduit-coupling':0.6,'conduit-90':1.5,'conduit-45':1.4,'conduit-22':1.4,'conduit-other':0,'conduit-adapter':1.2,'conduit-lb':4.0,'conduit-jbox':6.0,'conduit-cement':12.0,'gfci-outlet':45.0,'panel':0,
  'pipe-ft':0.45,'pipe-elbow':2.5,'pipe-tee':2.8,'pipe-endcap':2.0,'timer':45,'manifold':60,'backflow':10,'filter':20,'floatvalve':15,'valvebox':15,
  'drip-ft':0.12,'drip12-ft':0.35,'emitter':0.5,
  'trench-ft':0,'fence-ft':0,
  'rock-ton':110,'paver-unit':2.5,'patio-sqft':0,'fountain':1755,'fountain-pad':0,'boulder':60,'firepit':0,'raisedbed':0,'furniture':0,'shed':0,'fixed':0,'gate':0,'tree':0,'shrub':0,
  'wire-ft':0.6,'transformer':80,'pathlight':25,'spot':20,'well':25,'walllight':20,'stringpost':30,
  'plant':8,
};
HEADS.forEach(h=>{DEFAULT_PRICES['head-'+h.id]= h.id==='orbit-gear'?0:(h.id.startsWith('mp')?7:(h.id.startsWith('rvan')?6:2.5)); DEFAULT_PRICES['body-'+h.id]= h.id==='orbit-gear'?0:(h.body.includes('PRS')?6:3);});
</script>
