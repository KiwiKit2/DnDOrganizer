// Globals (Sheet, Persist) used to keep file:// usage working without module loader.

let state = {
  headers: [],
  objects: [],
  filtered: [],
  numericCols: [],
  sort: { col: null, dir: 1 },
  lastLoad: null,
  dirty: false,
};

const els = {
  tableHead: null,
  tableBody: null,
  search: null,
  columnFilter: null,
  valueFilter: null,
  recordCount: null,
  lastUpdated: null,
  statusLine: null,
  autoToggle: null,
};

async function init() {
  cacheEls();
  wireNav();
  wireEvents();
  const cached = Persist.loadCache();
  if (cached) {
    state.headers = cached.headers;
    state.objects = cached.objects;
    state.filtered = [...state.objects];
    buildTable();
    buildColumnFilter();
    applyFilters();
    document.querySelector('#statusLine').textContent = 'Loaded cached data';
  }
  if (sheetConfigured()) {
    await reload();
  } else {
    promptForSheet();
  }
  autoLoop();
}

function sheetConfigured() {
  try {
    const u = window.getSheetUrl();
    return /^https?:\/\//i.test(u) && !u.includes('PUT_PUBLISHED');
  } catch { return false; }
}

function promptForSheet() {
  els.statusLine.textContent = 'Configure sheet to start';
  if (document.getElementById('sheetModal').classList.contains('hidden')) {
    document.getElementById('sheetConfigBtn').classList.add('pulse');
    document.getElementById('sheetConfigBtn').click();
    setTimeout(()=> document.getElementById('sheetConfigBtn').classList.remove('pulse'), 4000);
  }
}

function cacheEls() {
  els.tableHead = document.querySelector('#dataTable thead');
  els.tableBody = document.querySelector('#dataTable tbody');
  els.search = document.querySelector('#search');
  els.columnFilter = document.querySelector('#columnFilter');
  els.valueFilter = document.querySelector('#valueFilter');
  els.recordCount = document.querySelector('#recordCount');
  els.lastUpdated = document.querySelector('#lastUpdated');
  els.statusLine = document.querySelector('#statusLine');
  els.autoToggle = document.querySelector('#autoRefreshToggle');
  els.sheetBtn = document.getElementById('sheetConfigBtn');
  els.uploadBtn = document.getElementById('uploadBtn');
  els.fileInput = document.getElementById('fileInput');
  els.groupSelect = document.getElementById('groupSelect');
  els.sampleBtn = document.getElementById('sampleDataBtn');
}

function wireNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      document.querySelectorAll('.view').forEach(sec=>sec.classList.remove('active'));
      document.querySelector('#view-' + v).classList.add('active');
  if (v === 'compendium' || v === 'entities') buildCompendium();
  if (v === 'map') refreshMap();
    });
  });
  document.getElementById('themeSwitch').addEventListener('click', toggleTheme);
}

function toggleTheme() {
  document.body.classList.toggle('light');
}

function wireEvents() {
  document.getElementById('refreshBtn').addEventListener('click', reload);
  els.search.addEventListener('input', applyFilters);
  els.columnFilter.addEventListener('change', buildValueFilter);
  els.valueFilter.addEventListener('change', applyFilters);
  document.getElementById('exportJson').addEventListener('click', ()=> Sheet.exportJson(state.filtered));
  document.getElementById('exportCsv').addEventListener('click', ()=> Sheet.exportCsv(state.headers, state.filtered));
  wireSheetModal();
  wireUpload();
  wireDragDrop();
  wireSample();
  wireEditing();
  wireCompendiumSearch();
  wireMoves();
  wireAdmin();
  wireNewEntry();
}

async function reload() {
  try {
    els.statusLine.textContent = 'Loading…';
  const before = { headers: state.headers, objects: state.objects };
  const data = await Sheet.loadSheet();
  state.headers = data.headers;
  state.objects = data.objects;
    state.numericCols = data.numericCols;
    state.lastLoad = new Date();
    buildTable();
    buildColumnFilter();
    applyFilters();
    buildKanban();
  Persist.saveCache(state);
  const after = { headers: state.headers, objects: state.objects };
  const { added, removed } = Persist.diffCounts(before.headers.length? before : null, after);
  els.statusLine.textContent = `Loaded ${state.objects.length} rows (${added}+ ${removed}-) in ${data.ms|0} ms`;
  } catch (e) {
    console.error(e);
    els.statusLine.textContent = e.message;
  }
}

function buildTable() {
  els.tableHead.innerHTML = '';
  const tr = document.createElement('tr');
  state.headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.addEventListener('click', ()=> sortBy(h));
    tr.appendChild(th);
  });
  els.tableHead.appendChild(tr);
  renderRows();
  // click row to edit
  els.tableBody.addEventListener('click', onRowClickOnce, { once: true });
}

function onRowClickOnce() {
  els.tableBody.addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const idx = [...els.tableBody.children].indexOf(tr);
    const rowObj = state.filtered[idx];
    if (rowObj) openEditor(rowObj);
  });
}

function renderRows() {
  els.tableBody.innerHTML='';
  const frag = document.createDocumentFragment();
  state.filtered.forEach(o => {
    const tr = document.createElement('tr');
    state.headers.forEach(h=> {
      const td = document.createElement('td');
      td.textContent = o[h];
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  els.tableBody.appendChild(frag);
  els.recordCount.textContent = state.filtered.length;
  els.lastUpdated.textContent = state.lastLoad?.toLocaleTimeString();
}

function sortBy(col) {
  if (state.sort.col === col) state.sort.dir *= -1; else { state.sort.col = col; state.sort.dir = 1; }
  state.filtered.sort((a,b)=>{
    const av = a[col]||''; const bv = b[col]||'';
    const an = parseFloat(av.replace(/[$,%\s]/g,''));
    const bn = parseFloat(bv.replace(/[$,%\s]/g,''));
    if (!isNaN(an) && !isNaN(bn)) return (an-bn)*state.sort.dir;
    return av.localeCompare(bv)*state.sort.dir;
  });
  renderRows();
}

function buildColumnFilter() {
  els.columnFilter.innerHTML = '<option value="">Column…</option>' + state.headers.map(h=>`<option>${h}</option>`).join('');
  buildValueFilter();
  if (els.groupSelect) {
    els.groupSelect.innerHTML = state.headers.map(h=>`<option value="${h}" ${h===KANBAN_GROUP_COLUMN?'selected':''}>${h}</option>`).join('');
    els.groupSelect.addEventListener('change', buildKanban);
  }
}

function buildValueFilter() {
  const col = els.columnFilter.value;
  if (!col) { els.valueFilter.innerHTML = '<option value="">Value…</option>'; applyFilters(); return; }
  const vals = [...new Set(state.objects.map(o=>o[col]).filter(v=>v))].sort();
  els.valueFilter.innerHTML = '<option value="">Value…</option>' + vals.map(v=>`<option>${v}</option>`).join('');
  applyFilters();
}

function applyFilters() {
  const q = els.search.value.toLowerCase();
  const col = els.columnFilter.value;
  const val = els.valueFilter.value;
  state.filtered = state.objects.filter(o => {
    if (q && !state.headers.some(h=> (o[h]||'').toLowerCase().includes(q))) return false;
    if (col && val && o[col] !== val) return false;
    return true;
  });
  if (state.sort.col) sortBy(state.sort.col); else renderRows();
  const view = document.querySelector('.nav-btn.active')?.dataset.view;
  if (view === 'board') buildKanban();
  if (view === 'compendium') buildCompendium();
  if (view === 'map') refreshMap();
}

function buildKanban() {
  const container = document.getElementById('kanban');
  container.innerHTML = '';
  const groupCol = els.groupSelect?.value || KANBAN_GROUP_COLUMN;
  if (!state.headers.length) { document.getElementById('kanbanEmpty').classList.remove('hidden'); return; }
  if (!state.headers.includes(groupCol)) { container.textContent = 'Group column '+groupCol+' missing.'; return; }
  const groups = groupBy(state.filtered, o => o[groupCol] || '—');
  const wipLimits = loadWipLimits();
  Object.entries(groups).forEach(([k, items]) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';
    const limit = wipLimits[k]||0; const over = limit && items.length>limit;
    col.innerHTML = `<header data-status="${k}"><div class="col-head-left"><strong class="col-title" title="Double‑click to rename / set WIP">${k}</strong> <span class="count">${items.length}${limit?'/'+limit:''}</span></div><button class="mini-btn add-mini" data-add="${k}" title="Add card to ${k}">＋</button></header><div class="kanban-cards"></div>`;
    if (over) col.classList.add('over-wip');
    const wrap = col.querySelector('.kanban-cards');
    items.forEach(o => wrap.appendChild(makeCard(o)));
    container.appendChild(col);
  });
  enableDrag();
  document.getElementById('kanbanEmpty').classList.toggle('hidden', container.children.length>0);
  // column header interactions
  container.querySelectorAll('header .col-title').forEach(h => {
    h.addEventListener('dblclick', () => {
      const current = h.textContent.trim();
      const newName = prompt('Rename column or keep same:', current) || current;
      if (newName !== current) {
        const groupCol = els.groupSelect?.value || KANBAN_GROUP_COLUMN;
        state.objects.forEach(o=> { if ((o[groupCol]||'—')===current) o[groupCol] = newName; });
      }
      const w = prompt('Set WIP limit (0=none):', (loadWipLimits()[newName]||0));
      if (w!==null) { const lims = loadWipLimits(); lims[newName]= Math.max(0, parseInt(w)||0); saveWipLimits(lims); }
      applyFilters(); buildKanban(); Persist.saveCache(state);
    });
  });
  container.querySelectorAll('button[data-add]').forEach(btn => btn.addEventListener('click', () => quickAddCard(btn.dataset.add)));
  buildBoardSummary(groups, wipLimits);
}

function makeCard(o) {
  const card = document.createElement('div');
  card.className = 'card';
  const titleKey = state.headers.find(h=> /title|name|task|item/i.test(h)) || state.headers[0];
  card.innerHTML = `<h4>${o[titleKey]||'(untitled)'}</h4>`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  state.headers.slice(0,6).forEach(h=> {
    if (h === titleKey) return;
    const v = o[h];
    if (!v || v.length > 40) return;
    meta.innerHTML += `<span>${h}: ${v}</span>`;
  });
  card.appendChild(meta);
  card.draggable = true;
  card.dataset.index = state.objects.indexOf(o);
  card.addEventListener('click', () => openEditor(o));
  return card;
}

function enableDrag() {
  let dragged = null;
  document.querySelectorAll('.card').forEach(c => {
    c.addEventListener('dragstart', e=> { dragged = c; c.classList.add('dragging'); });
    c.addEventListener('dragend', ()=> dragged?.classList.remove('dragging'));
  });
  document.querySelectorAll('.kanban-cards').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); });
    col.addEventListener('drop', e => {
      if (!dragged) return;
      col.appendChild(dragged);
      const idx = +dragged.dataset.index;
      const status = col.parentElement.querySelector('header').dataset.status;
  const groupCol = els.groupSelect?.value || KANBAN_GROUP_COLUMN;
  state.objects[idx][groupCol] = status;
  state.dirty = true;
  markDirty();
  Persist.saveCache(state);
  buildKanban();
    });
  });
}

// Quick add & WIP helpers
function quickAddCard(status){
  const groupCol = els.groupSelect?.value || KANBAN_GROUP_COLUMN;
  if (!state.headers.includes(groupCol)) return alert('Group column missing');
  const titleKey = state.headers.find(h=> /title|name|task|item/i.test(h)) || state.headers[0];
  const title = prompt('Card title:');
  if (!title) return;
  const row = Object.fromEntries(state.headers.map(h=>[h,'']));
  row[titleKey] = title;
  row[groupCol] = status;
  state.objects.push(row);
  applyFilters(); buildKanban(); Persist.saveCache(state); markDirty();
}
function loadWipLimits(){ try { return JSON.parse(localStorage.getItem('wipLimits')||'{}'); } catch { return {}; } }
function saveWipLimits(o){ try { localStorage.setItem('wipLimits', JSON.stringify(o)); } catch{} }

// Wire New Card toolbar button
document.addEventListener('DOMContentLoaded', () => {
  const addCardBtn = document.getElementById('addCardBtn');
  if (addCardBtn) addCardBtn.addEventListener('click', () => {
    const groupCol = els.groupSelect?.value || KANBAN_GROUP_COLUMN;
    const status = prompt('Status / Column value:');
    if (!status) return;
    quickAddCard(status);
  });
});

function buildBoardSummary(groups, limits){
  const box = document.getElementById('boardSummary'); if(!box) return;
  const total = Object.values(groups).reduce((a,b)=>a+b.length,0) || 1;
  box.innerHTML = Object.entries(groups).map(([k, items]) => {
    const limit = limits[k]||0; const pct = ((items.length/total)*100)|0;
    const pctLimit = limit? Math.min(100, (items.length/limit)*100)|0 : 0;
    return `<div class="metric"><strong>${k}</strong><span>${items.length}${limit?'/'+limit:''}</span><div class="bar"><span style="width:${limit?pctLimit:pct}%;background:${limit && items.length>limit?'linear-gradient(90deg,#ff5576,#ff889d)':'linear-gradient(90deg,var(--accent),#7fb3ff)'}"></span></div></div>`;
  }).join('');
}

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => { const k = fn(x); (acc[k] ||= []).push(x); return acc; }, {});
}

function autoLoop() {
  setInterval(()=> { if (els.autoToggle.checked) reload(); }, AUTO_REFRESH_MS);
}

function markDirty() {
  if (state.dirty) {
    document.querySelector('.footer').dataset.dirty = '1';
    document.querySelector('.footer').style.color = 'var(--accent)';
  } else {
    document.querySelector('.footer').style.color = 'var(--text-dim)';
  }
}

// Stats (lazy loaded script defines buildStats hook)
window.__getState = () => state;

function wireSheetModal() {
  const modal = document.getElementById('sheetModal');
  const open = () => { modal.classList.remove('hidden'); document.getElementById('sheetUrlInput').value = window.getSheetUrl() || ''; };
  const close = () => modal.classList.add('hidden');
  els.sheetBtn.addEventListener('click', open);
  document.getElementById('closeSheetModal').addEventListener('click', close);
  document.getElementById('saveSheetUrl').addEventListener('click', () => {
    const val = document.getElementById('sheetUrlInput').value.trim();
    if (!val) return;
    localStorage.setItem('sheetUrl', val);
    close();
  reload();
  });
  document.getElementById('clearSheetUrl').addEventListener('click', () => {
    localStorage.removeItem('sheetUrl');
    document.getElementById('sheetUrlInput').value='';
  });
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  window.addEventListener('keydown', e=> { if (e.key==='Escape' && !modal.classList.contains('hidden')) close(); });
  const modalUploadBtn = document.getElementById('modalUploadBtn');
  if (modalUploadBtn) modalUploadBtn.addEventListener('click', ()=> els.fileInput.click());
}

// Map prototype
function refreshMap() {
  const canvas = document.getElementById('battleMap');
  if (!canvas) return;
  const gridSize = +document.getElementById('gridSizeInput').value || 50;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let x=0; x<canvas.width; x+=gridSize) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
  for (let y=0; y<canvas.height; y+=gridSize) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
}

document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('addTokensBtn');
  const clearBtn = document.getElementById('clearTokensBtn');
  if (addBtn) addBtn.addEventListener('click', addTokensFromFiltered);
  if (clearBtn) clearBtn.addEventListener('click', () => { document.getElementById('tokenLayer').innerHTML=''; saveTokens(); });
  const gridInput = document.getElementById('gridSizeInput');
  if (gridInput) gridInput.addEventListener('change', refreshMap);
  const layer = document.getElementById('tokenLayer');
  layer?.addEventListener('mousedown', e=> { if (e.target.classList.contains('token')) { selectToken(e.target); dragToken(e); } });
  document.getElementById('addSingleTokenBtn')?.addEventListener('click', ()=> newAdHocToken());
  setupFog();
  loadTokens();
});

function addTokensFromFiltered() {
  const layer = document.getElementById('tokenLayer');
  if (!layer) return;
  const state = window.__getState();
  layer.innerHTML='';
  const { headers } = state;
  const imgField = ['Image','Img','Picture','Art','Avatar'].find(h=> headers.includes(h));
  const typeField = ['Type','Category','Kind'].find(h=> headers.includes(h));
  const nameField = headers.find(h=> /name|title/i.test(h)) || headers[0];
  let x=80,y=80; const step=70; const maxRow = 900;
  state.filtered.slice(0,60).forEach(o => {
    const div = document.createElement('div');
    div.className = 'token';
    const type = (o[typeField]||'').toLowerCase();
    if (/enemy|monster|foe/.test(type)) div.dataset.type='enemy'; else if (/player|pc|hero|character/.test(type)) div.dataset.type='player';
    div.title = o[nameField];
    if (imgField && o[imgField]) {
      const url = o[imgField];
      try {
        const host = new URL(url, location.href).hostname.toLowerCase();
        if (BLOCKED_IMAGE_DOMAINS.some(d=> host.includes(d))) {
          div.style.backgroundImage = `url(${PLACEHOLDER_IMG})`;
        } else {
          testImage(url, ok => { div.style.backgroundImage = `url(${ok?url:PLACEHOLDER_IMG})`; });
        }
      } catch { div.style.backgroundImage = `url(${PLACEHOLDER_IMG})`; }
    } else div.style.backgroundImage = `url(${PLACEHOLDER_IMG})`;
    div.style.left = x+'px';
    div.style.top = y+'px';
    div.dataset.drag='1';
    layer.appendChild(div);
    x += step; if (x>maxRow) { x=80; y+=step; }
  });
  refreshMap();
}

function dragToken(e) {
  const token = e.target;
  let sx = e.clientX, sy = e.clientY;
  const startLeft = parseFloat(token.style.left); const startTop = parseFloat(token.style.top);
  function move(ev) {
    const dx = ev.clientX - sx; const dy = ev.clientY - sy;
    token.style.left = (startLeft + dx) + 'px';
    token.style.top = (startTop + dy) + 'px';
  }
  function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}

function testImage(src, cb) {
  const img = new Image();
  let done=false; const finish = ok => { if (done) return; done=true; cb(ok); };
  img.onload = () => finish(true);
  img.onerror = () => finish(false);
  img.src = src;
  setTimeout(()=> finish(false), 6000);
}

// Token & Fog enhancements
function selectToken(t){ document.querySelectorAll('.token.selected').forEach(x=>x.classList.remove('selected')); t.classList.add('selected'); }
function newAdHocToken(){
  const layer = document.getElementById('tokenLayer'); if(!layer) return;
  const name = prompt('Token label (optional):','');
  const div = document.createElement('div');
  div.className='token';
  div.style.left='100px'; div.style.top='100px';
  div.title = name || 'token';
  layer.appendChild(div); saveTokens();
}
function saveTokens(){
  const layer = document.getElementById('tokenLayer'); if(!layer) return;
  const tokens=[...layer.querySelectorAll('.token')].map(t=>({x:parseFloat(t.style.left),y:parseFloat(t.style.top),title:t.title,type:t.dataset.type||'',bg:t.style.backgroundImage||''}));
  try { localStorage.setItem('mapTokens', JSON.stringify(tokens)); } catch{}
}
function loadTokens(){
  try { const raw = localStorage.getItem('mapTokens'); if(!raw) return; const arr=JSON.parse(raw); const layer=document.getElementById('tokenLayer'); if(!layer) return; layer.innerHTML=''; arr.forEach(o=> { const d=document.createElement('div'); d.className='token'; d.style.left=o.x+'px'; d.style.top=o.y+'px'; d.title=o.title; if(o.type) d.dataset.type=o.type; if(o.bg) d.style.backgroundImage=o.bg; layer.appendChild(d); }); } catch {}
}

let fogCtx, fogMode='none';
function setupFog(){
  const canvas = document.getElementById('fogCanvas'); if(!canvas) return;
  fogCtx = canvas.getContext('2d');
  document.getElementById('fogFullBtn')?.addEventListener('click', ()=> { coverFog(); fogMode='none'; saveFog(); });
  document.getElementById('fogClearBtn')?.addEventListener('click', ()=> { clearFog(); fogMode='none'; saveFog(); });
  document.getElementById('fogRevealBtn')?.addEventListener('click', ()=> { fogMode='reveal'; });
  coverFog(); loadFog();
  canvas.addEventListener('mousedown', e=> { if(fogMode==='reveal'){ revealAt(e.offsetX,e.offsetY); const mv=ev=> { revealAt(ev.offsetX,ev.offsetY); }; const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);saveFog();}; document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);} });
}
function coverFog(){ if(!fogCtx) return; fogCtx.globalCompositeOperation='source-over'; fogCtx.fillStyle='rgba(0,0,0,0.85)'; fogCtx.fillRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); }
function clearFog(){ if(!fogCtx) return; fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); }
function revealAt(x,y){ if(!fogCtx) return; const r=90; fogCtx.globalCompositeOperation='destination-out'; fogCtx.beginPath(); fogCtx.arc(x,y,r,0,Math.PI*2); fogCtx.fill(); }
function saveFog(){ if(!fogCtx) return; try { localStorage.setItem('fogData', fogCtx.canvas.toDataURL()); } catch {} }
function loadFog(){ try { const d=localStorage.getItem('fogData'); if(!d||!fogCtx) return; const img=new Image(); img.onload=()=> { fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); fogCtx.globalCompositeOperation='source-over'; fogCtx.drawImage(img,0,0); }; img.src=d; } catch {} }

// ---------------- Advanced Map Enhancements ----------------
// Data models
let walls = []; // each wall: {x1,y1,x2,y2}
let templates = []; // AoE templates {id, kind:circle|cone|line, x,y,w,h,angle}
let initiative = { order: [], current: 0 }; // order: [{id, name}]
let multiSelect = null; // {x1,y1,x2,y2}
let boardSettings = { visionAuto:true, bgImage:null };
let fogHistory = [];

// Utility IDs
function uid(){ return Math.random().toString(36).slice(2,9); }

document.addEventListener('DOMContentLoaded', () => {
  wireAdvancedMap();
});

function wireAdvancedMap(){
  const stage = document.getElementById('mapStage'); if(!stage) return;
  // Load persisted state
  loadWalls(); loadTemplates(); loadInitiative(); loadBoardSettings();
  drawWalls(); drawTemplates(); renderInitiative(); applyBoardBackground();
  // Buttons
  document.getElementById('wallModeBtn')?.addEventListener('click', toggleWallMode);
  document.getElementById('visionToggleBtn')?.addEventListener('click', () => { boardSettings.visionAuto = !boardSettings.visionAuto; persistBoardSettings(); computeVisionAuto(); });
  document.getElementById('rulerBtn')?.addEventListener('click', startRulerMode);
  document.getElementById('addCircleTemplateBtn')?.addEventListener('click', ()=> addTemplate('circle'));
  document.getElementById('addConeTemplateBtn')?.addEventListener('click', ()=> addTemplate('cone'));
  document.getElementById('addLineTemplateBtn')?.addEventListener('click', ()=> addTemplate('line'));
  document.getElementById('bgImageBtn')?.addEventListener('click', () => document.getElementById('bgImageInput').click());
  document.getElementById('bgImageInput')?.addEventListener('change', handleBgUpload);
  document.getElementById('exportBoardBtn')?.addEventListener('click', exportBoardState);
  document.getElementById('importBoardBtn')?.addEventListener('click', ()=> document.getElementById('importBoardInput').click());
  document.getElementById('importBoardInput')?.addEventListener('change', importBoardState);
  document.getElementById('fogUndoBtn')?.addEventListener('click', undoFogStep);
  // Initiative
  document.getElementById('initAddBtn')?.addEventListener('click', addSelectedToInitiative);
  document.getElementById('initPrevBtn')?.addEventListener('click', ()=> cycleInitiative(-1));
  document.getElementById('initNextBtn')?.addEventListener('click', ()=> cycleInitiative(1));
  document.getElementById('initClearBtn')?.addEventListener('click', ()=> { initiative={order:[],current:0}; persistInitiative(); renderInitiative(); });
  // Global listeners for multi-select
  stage.addEventListener('mousedown', onStageMouseDown);
  window.addEventListener('keydown', e=> { if(e.key==='m' || e.key==='M') startRulerMode(); });
  // Context menu
  stage.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('click', hideContextMenu);
  computeVisionAuto();
}

// ----- Walls -----
let wallMode = false, wallTempPoint=null;
function toggleWallMode(){ wallMode = !wallMode; const b=document.getElementById('wallModeBtn'); if(b) b.classList.toggle('active', wallMode); }
function onStageMouseDown(e){
  const stage = document.getElementById('mapStage');
  if(e.target.closest('.token') || e.target.closest('.token-context')) return;
  if(wallMode){
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    if(!wallTempPoint){ wallTempPoint={x,y}; }
    else { walls.push({x1:wallTempPoint.x,y1:wallTempPoint.y,x2:x,y2:y}); wallTempPoint=null; persistWalls(); drawWalls(); }
    e.preventDefault(); return;
  }
  // Multi-select start (Shift)
  if(e.shiftKey){ const rect = stage.getBoundingClientRect(); multiSelect={x1:e.clientX-rect.left,y1:e.clientY-rect.top,x2:e.clientX-rect.left,y2:e.clientY-rect.top}; startMultiDrag(); e.preventDefault(); }
}
function startMultiDrag(){ const stage=document.getElementById('mapStage'); function mv(ev){ const r=stage.getBoundingClientRect(); multiSelect.x2=ev.clientX-r.left; multiSelect.y2=ev.clientY-r.top; drawMultiSelect(); } function up(){ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); finalizeMultiSelect(); } document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up); }
function drawMultiSelect(){ let box=document.getElementById('multiSelectRect'); if(!box){ box=document.createElement('div'); box.id='multiSelectRect'; box.className='multi-select-rect'; document.getElementById('mapStage').appendChild(box);} const {x1,y1,x2,y2}=multiSelect; const l=Math.min(x1,x2),t=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1); Object.assign(box.style,{left:l+'px',top:t+'px',width:w+'px',height:h+'px'}); }
function finalizeMultiSelect(){ const box=document.getElementById('multiSelectRect'); if(box) box.remove(); if(!multiSelect) return; const layer=document.getElementById('tokenLayer'); const {x1,y1,x2,y2}=multiSelect; const l=Math.min(x1,x2),t=Math.min(y1,y2),r=Math.max(x1,x2),b=Math.max(y1,y2); [...layer.querySelectorAll('.token')].forEach(tok=> { const x=parseFloat(tok.style.left), y=parseFloat(tok.style.top); if(x>=l && x<=r && y>=t && y<=b) tok.classList.add('selected'); }); multiSelect=null; }
function drawWalls(){ const c=document.getElementById('wallsCanvas'); if(!c) return; const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=3; walls.forEach(w=> { ctx.beginPath(); ctx.moveTo(w.x1,w.y1); ctx.lineTo(w.x2,w.y2); ctx.stroke(); }); if(wallTempPoint){ ctx.fillStyle='var(--accent)'; ctx.beginPath(); ctx.arc(wallTempPoint.x,wallTempPoint.y,4,0,Math.PI*2); ctx.fill(); } }
function persistWalls(){ try{ localStorage.setItem('mapWalls', JSON.stringify(walls)); }catch{} }
function loadWalls(){ try{ const raw=localStorage.getItem('mapWalls'); if(raw) walls=JSON.parse(raw); }catch{} }

// ----- Templates (AoE) -----
function addTemplate(kind){ const t={id:uid(),kind,x:300,y:300,w:160,h:160,angle:0}; templates.push(t); persistTemplates(); drawTemplates(); }
function drawTemplates(){ const c=document.getElementById('overlayCanvas'); if(!c) return; const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); // visual handles simplified with DOM alt? using canvas now
  templates.forEach(t=> { ctx.save(); ctx.translate(t.x,t.y); ctx.rotate(t.angle*Math.PI/180); ctx.strokeStyle='rgba(79,141,255,0.9)'; ctx.fillStyle='rgba(79,141,255,0.18)'; ctx.lineWidth=2; if(t.kind==='circle'){ ctx.beginPath(); ctx.arc(0,0,t.w/2,0,Math.PI*2); ctx.fill(); ctx.stroke(); } else if(t.kind==='cone'){ ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(t.w, -t.h/2); ctx.lineTo(t.w, t.h/2); ctx.closePath(); ctx.fill(); ctx.stroke(); } else if(t.kind==='line'){ ctx.beginPath(); ctx.rect(0,-t.h/2,t.w,t.h); ctx.fill(); ctx.stroke(); } ctx.restore(); });
}
function persistTemplates(){ try{ localStorage.setItem('mapTemplates', JSON.stringify(templates)); }catch{} }
function loadTemplates(){ try{ const raw=localStorage.getItem('mapTemplates'); if(raw) templates=JSON.parse(raw); }catch{} }

// ----- Initiative -----
function addSelectedToInitiative(){ const list=[...document.querySelectorAll('.token.selected')]; list.forEach(t=> { const id=t.dataset.id||(t.dataset.id=uid()); if(!initiative.order.some(o=>o.id===id)) initiative.order.push({id,name:t.title||'token'}); }); persistInitiative(); renderInitiative(); }
function renderInitiative(){ const el=document.getElementById('initiativeList'); if(!el) return; el.innerHTML=''; initiative.order.forEach((o,i)=> { const li=document.createElement('li'); li.textContent=(i+1)+'. '+o.name; if(i===initiative.current) li.classList.add('active'); const del=document.createElement('button'); del.textContent='✕'; del.addEventListener('click',()=> { initiative.order=initiative.order.filter(x=>x!==o); if(initiative.current>=initiative.order.length) initiative.current=0; persistInitiative(); renderInitiative(); }); li.appendChild(del); el.appendChild(li); }); }
function cycleInitiative(dir){ if(!initiative.order.length) return; initiative.current=(initiative.current+dir+initiative.order.length)%initiative.order.length; renderInitiative(); highlightActiveToken(); }
function highlightActiveToken(){ const cur=initiative.order[initiative.current]; document.querySelectorAll('.token').forEach(t=> t.classList.remove('highlight-move')); if(!cur) return; const tok=[...document.querySelectorAll('.token')].find(t=> t.dataset.id===cur.id); if(tok) tok.classList.add('highlight-move'); }
function persistInitiative(){ try{ localStorage.setItem('mapInitiative', JSON.stringify(initiative)); }catch{} }
function loadInitiative(){ try{ const raw=localStorage.getItem('mapInitiative'); if(raw) initiative=JSON.parse(raw); }catch{} }

// ----- Vision (simplified radial reveal) -----
function computeVisionAuto(){ if(!boardSettings.visionAuto) return; // Basic: reveal around each player token
  pushFogHistory();
  const canvas = fogCtx?.canvas; if(!canvas || !fogCtx) return; loadFog(); // ensure fog is current
  fogCtx.globalCompositeOperation='destination-out';
  [...document.querySelectorAll('.token')].forEach(t=> { const r=parseInt(t.dataset.vision||'180'); const x=parseFloat(t.style.left); const y=parseFloat(t.style.top); fogCtx.beginPath(); fogCtx.arc(x,y,r,0,Math.PI*2); fogCtx.fill(); });
  saveFog();
}
function setTokenVision(token, radius){ token.dataset.vision=radius; if(boardSettings.visionAuto) computeVisionAuto(); }

// ----- Context Menu -----
function onContextMenu(e){ const tok = e.target.closest('.token'); if(!tok){ return; }
  e.preventDefault(); selectToken(tok); showContextMenu(e.clientX,e.clientY,tok); }
function showContextMenu(x,y,token){ hideContextMenu(); const menu=document.createElement('div'); menu.className='token-context'; menu.id='tokenContextMenu'; menu.innerHTML='<ul>'+[
    {k:'vision',label:'Set Vision'},
    {k:'hp',label:'Set HP'},
    {k:'dup',label:'Duplicate'},
    {k:'del',label:'Delete Token'}
  ].map(o=>`<li data-k="${o.k}">${o.label}</li>`).join('')+'</ul>'; document.body.appendChild(menu); positionMenu(menu,x,y); menu.addEventListener('click', ev=> { const li=ev.target.closest('li'); if(!li) return; const k=li.dataset.k; if(k==='vision'){ const r=prompt('Vision radius px:', token.dataset.vision||'180'); if(r) setTokenVision(token, parseInt(r)||0); } else if(k==='hp'){ const hp=prompt('HP value:', token.dataset.hp||''); if(hp!==null){ token.dataset.hp=hp; updateTokenBadges(token); saveTokens(); } } else if(k==='dup'){ duplicateToken(token); } else if(k==='del'){ token.remove(); saveTokens(); } hideContextMenu(); }); }
function positionMenu(menu,x,y){ const vw=window.innerWidth,vh=window.innerHeight; const r=menu.getBoundingClientRect(); if(x+r.width>vw) x=vw-r.width-10; if(y+r.height>vh) y=vh-r.height-10; menu.style.left=x+'px'; menu.style.top=y+'px'; }
function hideContextMenu(){ document.getElementById('tokenContextMenu')?.remove(); }
function duplicateToken(tok){ const layer=document.getElementById('tokenLayer'); const d=tok.cloneNode(true); d.style.left=(parseFloat(tok.style.left)+30)+'px'; d.style.top=(parseFloat(tok.style.top)+30)+'px'; layer.appendChild(d); saveTokens(); }
function updateTokenBadges(tok){ let stack=tok.querySelector('.badge-stack'); if(!stack){ stack=document.createElement('div'); stack.className='badge-stack'; tok.appendChild(stack); } stack.innerHTML=''; if(tok.dataset.hp){ const hp=document.createElement('div'); hp.className='hp-badge'; hp.textContent=tok.dataset.hp; stack.appendChild(hp); } }

// ----- Ruler -----
let rulerActive=false; let rulerStart=null; let rulerEl=null;
function startRulerMode(){ rulerActive=true; document.getElementById('rulerBtn')?.classList.add('active'); const stage=document.getElementById('mapStage'); stage.addEventListener('mousedown', rulerDown,{once:true}); }
function rulerDown(e){ const stage=document.getElementById('mapStage'); const rect=stage.getBoundingClientRect(); rulerStart={x:e.clientX-rect.left,y:e.clientY-rect.top}; rulerEl=document.createElement('div'); rulerEl.className='ruler-line'; stage.appendChild(rulerEl); function mv(ev){ const rx=ev.clientX-rect.left, ry=ev.clientY-rect.top; const dx=rx-rulerStart.x, dy=ry-rulerStart.y; const len=Math.sqrt(dx*dx+dy*dy); rulerEl.textContent=len.toFixed(0); const left=Math.min(rx,rulerStart.x), top=Math.min(ry,rulerStart.y); Object.assign(rulerEl.style,{left:left+'px',top:top+'px',width:Math.abs(dx)+'px',height:Math.abs(dy)+'px'}); } function up(){ stage.removeEventListener('mousemove',mv); stage.removeEventListener('mouseup',up); setTimeout(()=>{ rulerEl?.remove(); rulerActive=false; document.getElementById('rulerBtn')?.classList.remove('active'); },2000); } stage.addEventListener('mousemove',mv); stage.addEventListener('mouseup',up); }

// ----- Background Image -----
function handleBgUpload(e){ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=ev=> { boardSettings.bgImage=ev.target.result; persistBoardSettings(); applyBoardBackground(); }; reader.readAsDataURL(file); e.target.value=''; }
function applyBoardBackground(){ const c=document.getElementById('battleMap'); if(!c) return; if(boardSettings.bgImage){ c.style.backgroundImage=`url(${boardSettings.bgImage})`; c.parentElement.classList.add('background-image'); } else { c.style.backgroundImage=''; c.parentElement.classList.remove('background-image'); } }

// ----- Export / Import -----
function exportBoardState(){ const payload={ tokens:[...document.querySelectorAll('.token')].map(t=>({x:parseFloat(t.style.left),y:parseFloat(t.style.top),title:t.title,type:t.dataset.type||'',hp:t.dataset.hp||'',vision:t.dataset.vision||'',bg:t.style.backgroundImage||''})), walls, templates, initiative, boardSettings, fog: localStorage.getItem('fogData')||null }; const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.download='board-state.json'; a.href=URL.createObjectURL(blob); a.click(); }
function importBoardState(e){ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=ev=> { try{ const data=JSON.parse(ev.target.result); if(data.tokens){ localStorage.setItem('mapTokens', JSON.stringify(data.tokens)); loadTokens(); } if(data.walls){ walls=data.walls; persistWalls(); drawWalls(); } if(data.templates){ templates=data.templates; persistTemplates(); drawTemplates(); } if(data.initiative){ initiative=data.initiative; persistInitiative(); renderInitiative(); } if(data.boardSettings){ boardSettings=data.boardSettings; persistBoardSettings(); applyBoardBackground(); } if(data.fog){ localStorage.setItem('fogData', data.fog); loadFog(); } computeVisionAuto(); }catch(err){ alert('Import failed: '+err.message); } finally { e.target.value=''; }; }; reader.readAsText(file); }

// ----- Persistence helpers -----
function persistBoardSettings(){ try{ localStorage.setItem('boardSettings', JSON.stringify(boardSettings)); }catch{} }
function loadBoardSettings(){ try{ const raw=localStorage.getItem('boardSettings'); if(raw) boardSettings=JSON.parse(raw); }catch{} }

// ----- Fog history (undo) -----
function pushFogHistory(){ try{ const d=fogCtx?.canvas.toDataURL(); if(d){ fogHistory.push(d); if(fogHistory.length>20) fogHistory.shift(); } }catch{} }
function undoFogStep(){ if(!fogHistory.length) return; const last=fogHistory.pop(); const img=new Image(); img.onload=()=> { fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); fogCtx.globalCompositeOperation='source-over'; fogCtx.drawImage(img,0,0); saveFog(); }; img.src=last; }



function wireUpload() {
  els.uploadBtn.addEventListener('click', ()=> els.fileInput.click());
  els.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      els.statusLine.textContent = 'Reading '+file.name+'…';
      let objects = [];
      if (file.name.match(/\.xlsx?$|\.xls$/i)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:'array' });
        const first = wb.SheetNames[0];
        const sheet = wb.Sheets[first];
        objects = XLSX.utils.sheet_to_json(sheet, { defval:'' });
      } else { // csv
        const text = await file.text();
        const rows = text.split(/\r?\n/).filter(l=>l.trim()).map(l=> l.split(',').map(s=> s.replace(/^"|"$/g,'')) );
        const headers = rows.shift();
        objects = rows.map(r=> Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
      }
      if (!objects.length) throw new Error('No rows');
      state.headers = Object.keys(objects[0]);
      state.objects = objects;
      state.numericCols = state.headers.filter(h=> objects.some(o=> /^\d+(\.\d+)?$/.test((o[h]||'').toString().trim())));
      state.lastLoad = new Date();
      buildTable();
      buildColumnFilter();
      applyFilters();
      buildKanban();
      Persist.saveCache(state);
      els.statusLine.textContent = 'Loaded local file '+file.name+' ('+state.objects.length+' rows)';
    } catch(err){
      console.error(err);
      els.statusLine.textContent = 'Upload failed: '+err.message;
    } finally {
      e.target.value='';
    }
  });
}

function wireDragDrop() {
  const overlay = document.getElementById('dropOverlay');
  if (!overlay) return;
  ['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e=> { e.preventDefault(); overlay.classList.remove('hidden'); }));
  ['dragleave','drop'].forEach(ev => document.addEventListener(ev, e=> { if (e.type==='drop' || e.target===document) overlay.classList.add('hidden'); }));
  overlay.addEventListener('click', ()=> overlay.classList.add('hidden'));
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { els.fileInput.files = e.dataTransfer.files; els.fileInput.dispatchEvent(new Event('change')); }
  });
}

function wireSample() {
  if (!els.sampleBtn) return;
  els.sampleBtn.addEventListener('click', ()=> {
    const sample = [
  { Name:'Aria', Type:'Player', Status:'Active', HP:24, Notes:'Half-elf bard', Image:'' },
  { Name:'Borin', Type:'Player', Status:'Active', HP:31, Notes:'Dwarf fighter', Image:'' },
  { Name:'Goblin', Type:'Enemy', Status:'Spotted', HP:7, Notes:'Ambusher', Image:'' },
  { Name:'Potion of Healing', Type:'Item', Status:'Inventory', Notes:'2d4+2 restore', Image:'' }
    ];
    state.headers = Object.keys(sample[0]);
    state.objects = sample;
    state.filtered = [...sample];
    buildTable();
    buildColumnFilter();
    applyFilters();
    buildKanban();
    Persist.saveCache(state);
    els.statusLine.textContent = 'Loaded sample data';
  });
}

// Editing modal
function wireEditing() {
  document.getElementById('closeEditorModal')?.addEventListener('click', closeEditor);
  document.getElementById('saveRowBtn')?.addEventListener('click', saveEditor);
  document.getElementById('deleteRowBtn')?.addEventListener('click', deleteEditor);
}

let editorRow = null;
function openEditor(rowObj) {
  editorRow = rowObj;
  const modal = document.getElementById('editorModal');
  const form = document.getElementById('editForm');
  form.innerHTML = state.headers.map(h=> `<label>${h}<input name="${h}" value="${(rowObj[h]||'').toString().replace(/"/g,'&quot;')}"></label>`).join('');
  modal.classList.remove('hidden');
}
function closeEditor() { document.getElementById('editorModal').classList.add('hidden'); }
function saveEditor() {
  if (!editorRow) return; const form = document.getElementById('editForm');
  const data = Object.fromEntries([...form.querySelectorAll('input,textarea')].map(i=> [i.name, i.value]));
  Object.assign(editorRow, data);
  applyFilters(); buildKanban(); buildCompendium(); Persist.saveCache(state); closeEditor();
}
function deleteEditor() {
  if (!editorRow) return; state.objects = state.objects.filter(o=> o!==editorRow); applyFilters(); buildKanban(); buildCompendium(); Persist.saveCache(state); closeEditor();
}

function wireCompendiumSearch() {
  const inp = document.getElementById('compSearch');
  if (!inp || !window.buildCompendium) return;
  const orig = window.buildCompendium;
  window.buildCompendium = function() { orig(); const term = inp.value.toLowerCase(); if (!term) return; document.querySelectorAll('#compGallery .grid-token').forEach(c=> { if (!c.textContent.toLowerCase().includes(term)) c.style.display='none'; else c.style.display='flex'; }); };
  inp.addEventListener('input', ()=> window.buildCompendium());
}
function wireNewEntry(){
  const btn = document.getElementById('newEntryBtn');
  if(!btn) return;
  btn.addEventListener('click', () => {
    if(!adminMode){ alert('Enable Admin mode to add entries'); return; }
    // create blank row object with all headers
    if(!state.headers.length){ alert('Load sheet data first'); return; }
    const blank = Object.fromEntries(state.headers.map(h=>[h,'']));
    state.objects.push(blank); state.filtered = [...state.objects];
    editorRow = blank; openEditor(blank);
    markDirty(); Persist.saveCache(state); buildKanban(); buildCompendium(); renderRows();
  });
}

// Moves feature (lightweight list independent from sheet)
let moves = JSON.parse(localStorage.getItem('movesStore')||'[]');
let editingMove = null;
function wireMoves(){
  const addBtn = document.getElementById('addMoveBtn');
  if(!addBtn) return; // view not present
  addBtn.addEventListener('click', saveMoveFromForm);
  document.getElementById('resetMoveBtn').addEventListener('click', ()=> { editingMove=null; document.getElementById('moveForm').reset(); });
  document.getElementById('moveSearch').addEventListener('input', renderMoves);
  document.getElementById('exportMovesBtn').addEventListener('click', exportMovesExcel);
  document.getElementById('importMovesBtn').addEventListener('click', ()=> document.getElementById('importMovesInput').click());
  document.getElementById('importMovesInput').addEventListener('change', importMovesExcel);
  renderMoves();
}
function saveMoveFromForm(){
  const form = document.getElementById('moveForm');
  const data = Object.fromEntries([...form.querySelectorAll('input,textarea')].map(i=>[i.name,i.value.trim()]));
  if(!data.name){ alert('Name required'); return; }
  data.tags = data.tags? data.tags.split(/[,;]+/).map(t=>t.trim()).filter(Boolean):[];
  if(editingMove){ Object.assign(editingMove,data); }
  else moves.push(data);
  persistMoves();
  form.reset(); editingMove=null; renderMoves();
}
function renderMoves(){
  const body = document.querySelector('#movesTable tbody'); if(!body) return;
  const term = (document.getElementById('moveSearch')?.value||'').toLowerCase();
  const rows = moves.filter(m=> !term || m.name.toLowerCase().includes(term) || (m.tags||[]).some(t=>t.toLowerCase().includes(term)) );
  body.innerHTML='';
  rows.forEach(m=> {
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.description||'')}</td><td>${(m.tags||[]).map(t=>`<span class='tag'>${escapeHtml(t)}</span>`).join('')}</td><td><button class='mini-btn' data-act='edit'>Edit</button><button class='mini-btn danger' data-act='del'>Del</button></td>`;
    tr.querySelector('[data-act=edit]').addEventListener('click', ()=> { editingMove = m; fillMoveForm(m); });
    tr.querySelector('[data-act=del]').addEventListener('click', ()=> { if(confirm('Delete move?')) { moves = moves.filter(x=>x!==m); persistMoves(); renderMoves(); } });
    body.appendChild(tr);
  });
  document.getElementById('movesEmpty')?.classList.toggle('hidden', rows.length>0);
}
function fillMoveForm(m){
  const f = document.getElementById('moveForm'); if(!f) return;
  f.name.value = m.name||''; f.description.value = m.description||''; f.tags.value = (m.tags||[]).join(', '); f.image.value = m.image||'';
}
function persistMoves(){ localStorage.setItem('movesStore', JSON.stringify(moves)); }
function exportMovesExcel(){
  if(!moves.length){ alert('No moves'); return; }
  const rows = moves.map(m=> ({ Name:m.name, Description:m.description, Tags:(m.tags||[]).join(', '), Image:m.image||'' }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Moves');
  XLSX.writeFile(wb,'moves.xlsx');
}
async function importMovesExcel(e){
  const file = e.target.files[0]; if(!file) return;
  try{ const buf = await file.arrayBuffer(); const wb = XLSX.read(buf,{type:'array'}); const ws = wb.Sheets[wb.SheetNames[0]]; const json = XLSX.utils.sheet_to_json(ws,{defval:''});
    moves = json.map(r=> ({ name:r.Name||r.name||'', description:r.Description||r.description||'', tags:(r.Tags||'').split(/[,;]+/).map(t=>t.trim()).filter(Boolean), image:r.Image||r.image||'' }));
    persistMoves(); renderMoves();
  }catch(err){ console.error(err); alert('Import failed: '+err.message);} finally { e.target.value=''; }
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

// Admin toggle (simple gate for editing buttons)
let adminMode = false;
function wireAdmin(){
  const btn = document.getElementById('adminToggle'); if(!btn) return;
  btn.addEventListener('click', () => { adminMode = !adminMode; btn.textContent = adminMode? 'Admin On':'Admin Off'; document.body.classList.toggle('admin', adminMode); updateAdminVisibility(); });
  updateAdminVisibility();
}
function updateAdminVisibility(){
  document.querySelectorAll('.admin-only').forEach(el=> el.style.display = adminMode? '' : 'none');
  // For moves table actions
  document.querySelectorAll('#movesTable .mini-btn').forEach(b=> { if(/edit|del/i.test(b.textContent)) b.style.display = adminMode? '' : 'none'; });
}

init();
