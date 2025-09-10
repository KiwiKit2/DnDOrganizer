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
  try{
    const url = new URL(mp.server);
    if(url.protocol!=='ws:' && url.protocol!=='wss:'){ toast('Server URL must start with ws:// or wss://'); return; }
  }catch{ toast('Invalid server URL'); return; }
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
  const leanT = document.getElementById('leanToggle');
  if(leanT){
    const v=loadPref('lean','false');
    leanT.checked = v==='true';
    document.body.classList.toggle('lean', leanT.checked);
    leanT.addEventListener('change', ()=>{
      savePref('lean', leanT.checked?'true':'false');
      document.body.classList.toggle('lean', leanT.checked);
      if(leanT.checked){ document.querySelector(".nav-btn[data-view='map']")?.click(); }
    });
  }
  document.getElementById('resetAppBtn')?.addEventListener('click', resetApp);
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
  setInterval(()=> {
    // Pause auto refresh while Map view is active to avoid stutter
    const activeView = document.querySelector('.nav-btn.active')?.dataset.view;
    if (activeView === 'map') return;
    if (els.autoToggle.checked) reload();
  }, AUTO_REFRESH_MS);
}

function resetApp(){
  if(!confirm('Reset clears local data (tokens, walls, templates, fog, scenes, sheet cache). Continue?')) return;
  try{
    ['mapTokens','mapWalls','mapTemplates','mapInitiative','boardSettings','fogData','wipLimits','movesStore','mp:server','mp:room','mp:name','mp:isGM'].forEach(k=> localStorage.removeItem(k));
  }catch{}
  location.reload();
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
  if (clearBtn) clearBtn.addEventListener('click', () => { 
    if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; }
    document.getElementById('tokenLayer').innerHTML='';
    saveTokens();
    if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokensClear'}});
  });
  const gridInput = document.getElementById('gridSizeInput');
  if (gridInput){ gridInput.value = loadPref('gridSize', gridInput.value); gridInput.addEventListener('change', (e)=> { savePref('gridSize', e.target.value); refreshMap(); }); }
  const snapT = document.getElementById('snapToggle'); if(snapT){ const val = loadPref('snapToggle', 'true'); snapT.checked = val==='true'; snapT.addEventListener('change', ()=> savePref('snapToggle', snapT.checked?'true':'false')); }
  const layer = document.getElementById('tokenLayer');
  layer?.addEventListener('mousedown', e=> { if (e.target.classList.contains('token')) { const additive = e.ctrlKey||e.shiftKey; selectToken(e.target, additive); dragToken(e); } });
  document.getElementById('addSingleTokenBtn')?.addEventListener('click', ()=> newAdHocToken());
  setupFog();
  loadTokens();
  // Ensure existing tokens have stable IDs
  try{ ensureTokenIds && ensureTokenIds(); }catch{}
  // Layer toggles
  document.getElementById('showFogToggle')?.addEventListener('change', e=> document.getElementById('fogCanvas').style.display = e.target.checked? '' : 'none');
  document.getElementById('showWallsToggle')?.addEventListener('change', e=> document.getElementById('wallsCanvas').style.display = e.target.checked? '' : 'none');
  document.getElementById('showTemplatesToggle')?.addEventListener('change', e=> document.getElementById('overlayCanvas').style.display = e.target.checked? '' : 'none');
  document.getElementById('clearWallsBtn')?.addEventListener('click', ()=> { if(confirm('Delete all walls?')) { walls=[]; persistWalls(); drawWalls(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'walls', walls}}); toast('Walls cleared'); } });
  document.getElementById('clearTemplatesBtn')?.addEventListener('click', ()=> { if(confirm('Delete all templates?')) { templates=[]; persistTemplates(); drawTemplates(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'templates', templates}}); toast('Templates cleared'); } });
});

function addTokensFromFiltered() {
  const layer = document.getElementById('tokenLayer');
  if (!layer) return;
  if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; }
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
  div.dataset.id = uid();
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
  // Persist and broadcast full token set
  saveTokens();
  if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)){
    const tokens=[...document.querySelectorAll('.token')].map(t=>({id:t.dataset.id||uid(),x:parseFloat(t.style.left),y:parseFloat(t.style.top),title:t.title,type:t.dataset.type||'',hp:t.dataset.hp||'',vision:t.dataset.vision||'',bg:t.style.backgroundImage||''}));
    broadcast({type:'op', op:{kind:'tokensSet', tokens}});
  }
}

function dragToken(e) {
  const token = e.target;
  if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; }
  let sx = e.clientX, sy = e.clientY;
  const selected = [...document.querySelectorAll('.token.selected')];
  const moving = selected.length>1 && selected.includes(token) ? selected : [token];
  const starts = moving.map(t=> ({t, x:parseFloat(t.style.left), y:parseFloat(t.style.top)}));
  function move(ev) {
    const dx = ev.clientX - sx; const dy = ev.clientY - sy;
  starts.forEach(s=> { s.t.style.left = (s.x + dx) + 'px'; s.t.style.top = (s.y + dy) + 'px'; });
  }
  function up() {
    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
    // Snap to grid if enabled
    const snap = document.getElementById('snapToggle')?.checked; const grid = +document.getElementById('gridSizeInput')?.value||50;
    if(snap){ moving.forEach(t=> { const x=parseFloat(t.style.left), y=parseFloat(t.style.top); const sx=Math.round(x/grid)*grid; const sy=Math.round(y/grid)*grid; t.style.left=sx+'px'; t.style.top=sy+'px'; }); }
  // Optional collide with walls: simple revert if token crosses a wall segment center area
  if(document.getElementById('collideWallsToggle')?.checked){ const bad = moving.some(t=> tokenHitsWall(t)); if(bad){
      // try to slide to a nearby free spot
      moving.forEach(s=> { const alt=findSlidePosition(parseFloat(s.style.left), parseFloat(s.style.top), 32); if(alt){ s.style.left=alt.x+'px'; s.style.top=alt.y+'px'; } });
      // if still blocked, revert
      if(moving.some(t=> tokenHitsWall(t))){ starts.forEach(s=> { s.t.style.left=s.x+'px'; s.t.style.top=s.y+'px'; }); toast('Blocked by wall'); }
    } }
  saveTokens(); if(boardSettings.visionAuto) computeVisionAuto();
  // Broadcast moves to peers
  moving.forEach(t=> { if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'move', id:(t.dataset.id||''), x:parseFloat(t.style.left), y:parseFloat(t.style.top)}}); });
  }
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}

function tokenHitsWall(tok){ const x=parseFloat(tok.style.left), y=parseFloat(tok.style.top); const r=30; return walls.some(w=> distPointToSeg(x,y,w.x1,w.y1,w.x2,w.y2) < r); }
function findSlidePosition(x,y,range){ const dirs=[[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]; for(let d=8; d<=range; d+=8){ for(const v of dirs){ const nx=x+v[0]*d, ny=y+v[1]*d; if(!walls.some(w=> distPointToSeg(nx,ny,w.x1,w.y1,w.x2,w.y2) < 30)) return {x:nx,y:ny}; } } return null; }
function distPointToSeg(px,py,x1,y1,x2,y2){ const A=px-x1,B=py-y1,C=x2-x1,D=y2-y1; const dot=A*C+B+D; const len_sq=C*C+D*D; let t = len_sq? ((A*C)+(B*D))/len_sq : 0; t=Math.max(0,Math.min(1,t)); const xx=x1+t*C, yy=y1+t*D; const dx=px-xx, dy=py-yy; return Math.sqrt(dx*dx+dy*dy); }

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
  if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; }
  const name = prompt('Token label (optional):','');
  const div = document.createElement('div');
  div.className='token';
  div.style.left='100px'; div.style.top='100px';
  div.title = name || 'token';
  div.dataset.id = uid();
  layer.appendChild(div); saveTokens();
  if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)){
    const payload = { id:div.dataset.id, x:100, y:100, title:div.title, type:div.dataset.type||'', hp:div.dataset.hp||'', vision:div.dataset.vision||'', bg:div.style.backgroundImage||'' };
    broadcast({type:'op', op:{kind:'tokenAdd', token: payload}});
  }
}
function saveTokens(){
  const layer = document.getElementById('tokenLayer'); if(!layer) return;
  const tokens=[...layer.querySelectorAll('.token')].map(t=>({id:t.dataset.id||uid(),x:parseFloat(t.style.left),y:parseFloat(t.style.top),title:t.title,type:t.dataset.type||'',bg:t.style.backgroundImage||'',hp:t.dataset.hp||'',vision:t.dataset.vision||''}));
  try { localStorage.setItem('mapTokens', JSON.stringify(tokens)); } catch{}
}
function loadTokens(){
  try { const raw = localStorage.getItem('mapTokens'); if(!raw) return; const arr=JSON.parse(raw); const layer=document.getElementById('tokenLayer'); if(!layer) return; layer.innerHTML=''; arr.forEach(o=> { const d=document.createElement('div'); d.className='token'; d.dataset.id=o.id||uid(); d.style.left=o.x+'px'; d.style.top=o.y+'px'; d.title=o.title; if(o.type) d.dataset.type=o.type; if(o.bg) d.style.backgroundImage=o.bg; if(o.hp) d.dataset.hp=o.hp; if(o.vision) d.dataset.vision=o.vision; layer.appendChild(d); updateTokenBadges(d); }); } catch {}
}
// Ensure tokens have stable IDs for multiplayer references
function ensureTokenIds(){ const layer=document.getElementById('tokenLayer'); if(!layer) return; let changed=false; [...layer.querySelectorAll('.token')].forEach(t=> { if(!t.dataset.id){ t.dataset.id = uid(); changed=true; } }); if(changed) saveTokens(); }

let fogCtx, fogMode='none';
function setupFog(){
  const canvas = document.getElementById('fogCanvas'); if(!canvas) return;
  fogCtx = canvas.getContext('2d');
  document.getElementById('fogFullBtn')?.addEventListener('click', (e)=> { if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); e.preventDefault(); return; } pushFogHistory(); coverFog(); fogMode='none'; saveFog(); });
  document.getElementById('fogClearBtn')?.addEventListener('click', (e)=> { if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); e.preventDefault(); return; } pushFogHistory(); clearFog(); fogMode='none'; saveFog(); });
  document.getElementById('fogRevealBtn')?.addEventListener('click', (e)=> { if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); e.preventDefault(); return; } fogMode='reveal'; });
  coverFog(); loadFog();
  canvas.addEventListener('mousedown', e=> { if(!( !mp.connected || mp.isGM || mp.allowEdits )) return; if(fogMode==='reveal'){ pushFogHistory(); revealAt(e.offsetX,e.offsetY,true); const mv=ev=> { revealAt(ev.offsetX,ev.offsetY,false); }; const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);saveFog();}; document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);} });
}
function coverFog(){ if(!fogCtx) return; fogCtx.globalCompositeOperation='source-over'; fogCtx.fillStyle='rgba(0,0,0,0.85)'; fogCtx.fillRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); }
function clearFog(){ if(!fogCtx) return; fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); }
function revealAt(x,y,start){ if(!fogCtx) return; const r = +document.getElementById('fogBrushSize')?.value||90; const shape = document.getElementById('fogBrushShape')?.value||'circle'; fogCtx.globalCompositeOperation='destination-out'; if(shape==='rect'){ const w=r, h=r; fogCtx.fillRect(x-w/2,y-h/2,w,h); } else { fogCtx.beginPath(); fogCtx.arc(x,y,r,0,Math.PI*2); fogCtx.fill(); } }
function saveFog(){ if(!fogCtx) return; try { localStorage.setItem('fogData', fogCtx.canvas.toDataURL()); } catch {} }
function loadFog(){ try { const d=localStorage.getItem('fogData'); if(!d||!fogCtx) return; const img=new Image(); img.onload=()=> { fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); fogCtx.globalCompositeOperation='source-over'; fogCtx.drawImage(img,0,0); }; img.src=d; } catch {} }

// ---------------- Advanced Map Enhancements ----------------
// Data models
let walls = []; // each wall: {x1,y1,x2,y2}
let templates = []; // AoE templates {id, kind:circle|cone|line, x,y,w,h,angle}
let initiative = { order: [], current: 0 }; // order: [{id, name}]
let multiSelect = null; // {x1,y1,x2,y2}
let boardSettings = { visionAuto:true, bgImage:null, gmMode:false };
let fogHistory = [];
// Multiplayer session state
let mp = { ws:null, connected:false, isGM:false, allowEdits:false, room:'', name:'', server:'', silent:false, _retries:0, peerId: (Math.random().toString(36).slice(2,10)) };

function saveMpPrefs(){ try{ localStorage.setItem('mp:server', mp.server||''); localStorage.setItem('mp:room', mp.room||''); localStorage.setItem('mp:name', mp.name||''); localStorage.setItem('mp:isGM', mp.isGM? '1':''); }catch{} }
function loadMpPrefs(){ try{ return { server: localStorage.getItem('mp:server')||'', room: localStorage.getItem('mp:room')||'', name: localStorage.getItem('mp:name')||'', isGM: (localStorage.getItem('mp:isGM')==='1') }; }catch{ return {server:'',room:'',name:'',isGM:false}; } }

// Utility IDs
function uid(){ return Math.random().toString(36).slice(2,9); }

document.addEventListener('DOMContentLoaded', () => {
  wireAdvancedMap();
});

function wireAdvancedMap(){
  const stage = document.getElementById('mapStage'); if(!stage) return;
  // Load persisted state
  loadWalls(); loadTemplates(); loadInitiative(); loadBoardSettings();
    drawWalls(); drawTemplates(); renderInitiative(); applyBoardBackground(); applyGmMode();
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
  document.getElementById('gmModeToggle')?.addEventListener('change', e=> { boardSettings.gmMode = !!e.target.checked; persistBoardSettings(); applyGmMode(); });
  document.getElementById('exportImageBtn')?.addEventListener('click', exportPngSnapshot);
  document.getElementById('mapHelpBtn')?.addEventListener('click', ()=> document.getElementById('mapHelpModal').classList.remove('hidden'));
  document.getElementById('closeMapHelp')?.addEventListener('click', ()=> document.getElementById('mapHelpModal').classList.add('hidden'));
  document.getElementById('helpFab')?.addEventListener('click', ()=> document.getElementById('mapHelpModal').classList.remove('hidden'));
  // Simple Mode
  const sT=document.getElementById('simpleModeToggle'); if(sT){ const val=loadPref('simpleMode','true'); sT.checked=val==='true'; document.body.classList.toggle('simple-mode', sT.checked); sT.addEventListener('change', ()=> { savePref('simpleMode', sT.checked?'true':'false'); document.body.classList.toggle('simple-mode', sT.checked); }); }
  // Perf/Lock/Cursors toggles
  const pT=document.getElementById('perfModeToggle'); if(pT){ const v=loadPref('perfMode','false'); pT.checked = v==='true'; pT.addEventListener('change', ()=> savePref('perfMode', pT.checked?'true':'false')); }
  const lT=document.getElementById('lockBoardToggle'); if(lT){ const v=loadPref('lockBoard','false'); lT.checked=v==='true'; document.body.classList.toggle('locked', lT.checked); lT.addEventListener('change', ()=> { savePref('lockBoard', lT.checked?'true':'false'); document.body.classList.toggle('locked', lT.checked); }); }
  const cT=document.getElementById('cursorsToggle'); if(cT){ const v=loadPref('cursors','true'); cT.checked=v!=='false'; cT.addEventListener('change', ()=> { savePref('cursors', cT.checked?'true':'false'); document.getElementById('cursorLayer').style.display = cT.checked? '' : 'none'; }); document.getElementById('cursorLayer').style.display = cT.checked? '' : 'none'; }
  // Multiplayer controls
  document.getElementById('hostGameBtn')?.addEventListener('click', openMpModalHost);
  document.getElementById('joinGameBtn')?.addEventListener('click', openMpModalJoin);
  document.getElementById('shareGameBtn')?.addEventListener('click', copyJoinLink);
  document.getElementById('playersEditToggle')?.addEventListener('change', e=> { mp.allowEdits=!!e.target.checked; broadcast({type:'perm', allowEdits: mp.allowEdits}); });
  document.getElementById('closeMpModal')?.addEventListener('click', ()=> document.getElementById('mpModal')?.classList.add('hidden'));
  document.getElementById('mpDoHost')?.addEventListener('click', ()=> startMp(true));
  document.getElementById('mpDoJoin')?.addEventListener('click', ()=> startMp(false));
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
  // Auto-join via hash
  const j=parseJoinHash(); if(j){
    const prefs = loadMpPrefs();
    mp.server = j.server; mp.room = j.room; mp.name = prefs.name || 'Player'; mp.isGM = false; mp.connected=false;
    connectWs(); toast('Joining room '+mp.room);
  }
  // Show welcome landing on first load
  initWelcomeLanding();
  // Render banner initially
  renderSessionBanner();
  // Wire live cursor sync
  wireLiveCursors();
  // Token inspector inputs
  wireTokenInspector();
  // Scenes
  wireScenes();
}

// ----- Walls -----
let wallMode = false, wallTempPoint=null;
function toggleWallMode(){ wallMode = !wallMode; const b=document.getElementById('wallModeBtn'); if(b) b.classList.toggle('active', wallMode); }
function onStageMouseDown(e){
  const stage = document.getElementById('mapStage');
  if(e.target.closest('.token') || e.target.closest('.token-context')) return;
  if(wallMode){
    if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; }
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    // Alt+click to delete nearest wall
  if(e.altKey){ const idx = findNearestWall(x,y,10); if(idx>-1){ walls.splice(idx,1); persistWalls(); drawWalls(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'walls', walls}}); toast('Wall removed'); } return; }
    if(!wallTempPoint){ wallTempPoint={x,y}; }
  else { walls.push({x1:wallTempPoint.x,y1:wallTempPoint.y,x2:x,y2:y}); wallTempPoint=null; persistWalls(); drawWalls(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'walls', walls}}); }
    e.preventDefault(); return;
  }
  // Multi-select start (Shift)
  if(e.shiftKey){ const rect = stage.getBoundingClientRect(); multiSelect={x1:e.clientX-rect.left,y1:e.clientY-rect.top,x2:e.clientX-rect.left,y2:e.clientY-rect.top}; startMultiDrag(); e.preventDefault(); }
}
function startMultiDrag(){ const stage=document.getElementById('mapStage'); function mv(ev){ const r=stage.getBoundingClientRect(); multiSelect.x2=ev.clientX-r.left; multiSelect.y2=ev.clientY-r.top; drawMultiSelect(); } function up(){ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); finalizeMultiSelect(); } document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up); }
function drawMultiSelect(){ let box=document.getElementById('multiSelectRect'); if(!box){ box=document.createElement('div'); box.id='multiSelectRect'; box.className='multi-select-rect'; document.getElementById('mapStage').appendChild(box);} const {x1,y1,x2,y2}=multiSelect; const l=Math.min(x1,x2),t=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1); Object.assign(box.style,{left:l+'px',top:t+'px',width:w+'px',height:h+'px'}); }
function finalizeMultiSelect(){ const box=document.getElementById('multiSelectRect'); if(box) box.remove(); if(!multiSelect) return; const layer=document.getElementById('tokenLayer'); const {x1,y1,x2,y2}=multiSelect; const l=Math.min(x1,x2),t=Math.min(y1,y2),r=Math.max(x1,x2),b=Math.max(y1,y2); [...layer.querySelectorAll('.token')].forEach(tok=> { const x=parseFloat(tok.style.left), y=parseFloat(tok.style.top); if(x>=l && x<=r && y>=t && y<=b) tok.classList.add('selected'); }); multiSelect=null; }
function drawWalls(){ const c=document.getElementById('wallsCanvas'); if(!c) return; const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=3; walls.forEach(w=> { ctx.beginPath(); ctx.moveTo(w.x1,w.y1); ctx.lineTo(w.x2,w.y2); ctx.stroke(); }); if(wallTempPoint){ ctx.fillStyle='rgb(79,141,255)'; ctx.beginPath(); ctx.arc(wallTempPoint.x,wallTempPoint.y,4,0,Math.PI*2); ctx.fill(); } }
function persistWalls(){ try{ localStorage.setItem('mapWalls', JSON.stringify(walls)); }catch{} }
function loadWalls(){ try{ const raw=localStorage.getItem('mapWalls'); if(raw) walls=JSON.parse(raw); }catch{} }

// ----- Templates (AoE) -----
function addTemplate(kind){ const t={id:uid(),kind,x:300,y:300,w:160,h:160,angle:0}; templates.push(t); persistTemplates(); drawTemplates(); }
function drawTemplates(){ const c=document.getElementById('overlayCanvas'); if(!c) return; const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
  templates.forEach(t=> { ctx.save(); ctx.translate(t.x,t.y); ctx.rotate(t.angle*Math.PI/180); ctx.strokeStyle='rgba(79,141,255,0.9)'; ctx.fillStyle='rgba(79,141,255,0.18)'; ctx.lineWidth=2; if(t.kind==='circle'){ ctx.beginPath(); ctx.arc(0,0,t.w/2,0,Math.PI*2); ctx.fill(); ctx.stroke(); } else if(t.kind==='cone'){ ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(t.w, -t.h/2); ctx.lineTo(t.w, t.h/2); ctx.closePath(); ctx.fill(); ctx.stroke(); } else if(t.kind==='line'){ ctx.beginPath(); ctx.rect(0,-t.h/2,t.w,t.h); ctx.fill(); ctx.stroke(); } 
    // handles: resize bottom-right, rotate above
    ctx.fillStyle='rgba(79,141,255,0.95)'; const hx=(t.kind==='circle'? (t.w/2) : t.w), hy=(t.kind==='circle'? (t.w/2) : t.h/2); ctx.beginPath(); ctx.arc(hx,hy,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(79,141,255,0.75)'; const ry=-(t.kind==='circle'? (t.w/2) : t.h/2)-12; ctx.beginPath(); ctx.arc(0,ry,4,0,Math.PI*2); ctx.fill();
    ctx.restore(); });
  // Enable pointer events based on presence
  c.style.pointerEvents = templates.length ? 'auto' : 'none';
}
// Interaction on overlay templates
let selectedTemplateId=null; let templateDragMode=null; // 'move'|'resize'
(function wireTemplatesInteractions(){ const c=document.getElementById('overlayCanvas'); if(!c) return; const stage=document.getElementById('mapStage'); let start=null; c.addEventListener('mousedown', e=> { const rect=c.getBoundingClientRect(); const x=e.clientX-rect.left, y=e.clientY-rect.top; const t=findTemplateAt(x,y); if(!t) return; selectedTemplateId=t.id; templateDragMode = e.shiftKey? 'resize':'move'; start={x,y,t: {...t}}; function mv(ev){ const rx=ev.clientX-rect.left, ry=ev.clientY-rect.top; const dx=rx-start.x, dy=ry-start.y; const cur=templates.find(tt=>tt.id===selectedTemplateId); if(!cur) return; if(templateDragMode==='move'){ cur.x = start.t.x + dx; cur.y = start.t.y + dy; } else { cur.w = Math.max(20, start.t.w + dx); cur.h = Math.max(20, start.t.h + dy); } drawTemplates(); }
    function up(){ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); persistTemplates(); }
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up); }); c.addEventListener('wheel', e=> { if(!selectedTemplateId) return; const cur=templates.find(tt=>tt.id===selectedTemplateId); if(!cur) return; cur.angle += (e.deltaY>0? 5 : -5); drawTemplates(); persistTemplates(); e.preventDefault(); }, {passive:false}); window.addEventListener('keydown', e=> { if(e.key==='Delete' && selectedTemplateId){ templates = templates.filter(t=> t.id!==selectedTemplateId); selectedTemplateId=null; drawTemplates(); persistTemplates(); } }); function findTemplateAt(x,y){ // naive hit: within bounding box
      for(let i=templates.length-1;i>=0;i--){ const t=templates[i]; const dx=x - t.x, dy=y - t.y; const dist=Math.hypot(dx,dy); if(t.kind==='circle'){ if(dist<=t.w/2) return t; } else { // use bbox in local coords rotated inverse
          const ang=-t.angle*Math.PI/180; const lx=dx*Math.cos(ang)-dy*Math.sin(ang); const ly=dx*Math.sin(ang)+dy*Math.cos(ang); if(Math.abs(lx)<=t.w && Math.abs(ly)<=t.h) return t; }
      } return null; }
})();
function persistTemplates(){ try{ localStorage.setItem('mapTemplates', JSON.stringify(templates)); }catch{} if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'templates', templates}}); }
function loadTemplates(){ try{ const raw=localStorage.getItem('mapTemplates'); if(raw) templates=JSON.parse(raw); }catch{} }

// ----- Initiative -----
function addSelectedToInitiative(){ const list=[...document.querySelectorAll('.token.selected')]; const added=[]; list.forEach(t=> { const id=t.dataset.id||(t.dataset.id=uid()); if(!initiative.order.some(o=>o.id===id)){ const item={id,name:t.title||'token'}; initiative.order.push(item); added.push(item); } }); persistInitiative(); renderInitiative(); if(added.length && !mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'initAdd', items:added}}); }
function renderInitiative(){ const el=document.getElementById('initiativeList'); if(!el) return; el.innerHTML=''; initiative.order.forEach((o,i)=> { const li=document.createElement('li'); li.textContent=(i+1)+'. '+o.name; if(i===initiative.current) li.classList.add('active'); const del=document.createElement('button'); del.textContent='✕'; del.addEventListener('click',()=> { const removedId=o.id; initiative.order=initiative.order.filter(x=>x!==o); if(initiative.current>=initiative.order.length) initiative.current=0; persistInitiative(); renderInitiative(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'initRemove', id:removedId}}); }); li.appendChild(del); el.appendChild(li); }); }
function cycleInitiative(dir){ if(!initiative.order.length) return; initiative.current=(initiative.current+dir+initiative.order.length)%initiative.order.length; renderInitiative(); highlightActiveToken(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'initCycle', dir}}); }
function highlightActiveToken(){ const cur=initiative.order[initiative.current]; document.querySelectorAll('.token').forEach(t=> t.classList.remove('highlight-move')); if(!cur) return; const tok=[...document.querySelectorAll('.token')].find(t=> t.dataset.id===cur.id); if(tok) tok.classList.add('highlight-move'); }
function persistInitiative(){ try{ localStorage.setItem('mapInitiative', JSON.stringify(initiative)); }catch{} }
function loadInitiative(){ try{ const raw=localStorage.getItem('mapInitiative'); if(raw) initiative=JSON.parse(raw); }catch{} }

// ----- Vision (simplified radial reveal) -----
let _visionTmr=null; function computeVisionAuto(){ if(!boardSettings.visionAuto) return; clearTimeout(_visionTmr); const perf = loadPref('perfMode','false')==='true'; const delay = perf? 250 : 60; _visionTmr = setTimeout(()=>{ const canvas = fogCtx?.canvas; if(!canvas || !fogCtx) return; pushFogHistory(); coverFog(); fogCtx.globalCompositeOperation='destination-out'; [...document.querySelectorAll('.token')].forEach(t=> revealVisionForToken(t)); saveFog(); }, delay); }
function revealVisionForToken(t){ const r=parseInt(t.dataset.vision||'180'); const x=parseFloat(t.style.left); const y=parseFloat(t.style.top); const poly = computeLOS(x,y,r); drawPoly(fogCtx, poly, true); }
function computeLOS(cx,cy,r){ const near = walls.filter(w=> boxDistToPoint(w, cx, cy) <= r+80); const pts=[]; const angles=[]; near.forEach(w=> { const a1=Math.atan2(w.y1-cy,w.x1-cx); const a2=Math.atan2(w.y2-cy,w.x2-cx); angles.push(a1-0.0005,a1,a1+0.0005,a2-0.0005,a2,a2+0.0005); }); for(let a=0;a<Math.PI*2;a+=Math.PI/180) angles.push(a); const uniq=[...new Set(angles.map(a=> +a.toFixed(4)))]; uniq.sort((a,b)=>a-b); uniq.forEach(theta=> { const end = castRay(cx,cy,theta,r,near); pts.push(end); }); return pts; }
function castRay(x,y,ang,r,segments){ const dx=Math.cos(ang), dy=Math.sin(ang); let minT=1e9; let hitX=x+dx*r, hitY=y+dy*r; segments.forEach(w=> { const res = segIntersect(x,y,dx,dy, w.x1,w.y1,w.x2,w.y2); if(res && res.t<minT && res.t>=0 && res.t<=r){ minT=res.t; hitX=x+dx*res.t; hitY=y+dy*res.t; } }); return {x:hitX,y:hitY}; }
function boxDistToPoint(w,px,py){ const minx=Math.min(w.x1,w.x2), maxx=Math.max(w.x1,w.x2); const miny=Math.min(w.y1,w.y2), maxy=Math.max(w.y1,w.y2); const nx=Math.max(minx,Math.min(px,maxx)); const ny=Math.max(miny,Math.min(py,maxy)); const dx=nx-px, dy=ny-py; return Math.hypot(dx,dy); }
function segIntersect(x,y,dx,dy, x1,y1,x2,y2){ // ray (x,y)+(t)(dx,dy) with segment (x1,y1)-(x2,y2)
  const sx=x2-x1, sy=y2-y1; const denom = dx*sy - dy*sx; if(Math.abs(denom) < 1e-6) return null; const t = ((x1 - x)*sy - (y1 - y)*sx)/denom; const u = ((x1 - x)*dy - (y1 - y)*dx)/denom; if(t>=0 && u>=0 && u<=1) return {t,u}; return null; }
function drawPoly(ctx, pts, close){ if(!pts.length) return; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y); if(close) ctx.closePath(); ctx.fill(); }
function setTokenVision(token, radius){ token.dataset.vision=radius; saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenUpdate', id:(token.dataset.id||''), fields:{vision: String(radius)}}}); if(boardSettings.visionAuto) computeVisionAuto(); }

// ----- Context Menu -----
function onContextMenu(e){ const tok = e.target.closest('.token'); if(!tok){ return; }
  e.preventDefault(); selectToken(tok); showContextMenu(e.clientX,e.clientY,tok); }
function showContextMenu(x,y,token){ hideContextMenu(); const menu=document.createElement('div'); menu.className='token-context'; menu.id='tokenContextMenu'; menu.innerHTML='<ul>'+[
    {k:'vision',label:'Set Vision'},
    {k:'hp',label:'Set HP'},
    {k:'type_player',label:'Set Type: Player'},
    {k:'type_enemy',label:'Set Type: Enemy'},
    {k:'type_neutral',label:'Set Type: Neutral'},
    {k:'dup',label:'Duplicate'},
    {k:'del',label:'Delete Token'}
  ].map(o=>`<li data-k="${o.k}">${o.label}</li>`).join('')+'</ul>'; document.body.appendChild(menu); positionMenu(menu,x,y); menu.addEventListener('click', ev=> { const li=ev.target.closest('li'); if(!li) return; if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; } const k=li.dataset.k; if(k==='vision'){ const r=prompt('Vision radius px:', token.dataset.vision||'180'); if(r) setTokenVision(token, parseInt(r)||0); } else if(k==='hp'){ const hp=prompt('HP value:', token.dataset.hp||''); if(hp!==null){ token.dataset.hp=hp; updateTokenBadges(token); saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenUpdate', id:(token.dataset.id||''), fields:{hp:String(hp)}}}); } } else if(k==='dup'){ duplicateToken(token); } else if(k==='del'){ const id=(token.dataset.id||''); token.remove(); saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenDel', ids:[id]}}); } else if(k==='type_player'){ token.dataset.type='player'; saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenUpdate', id:(token.dataset.id||''), fields:{type:'player'}}}); } else if(k==='type_enemy'){ token.dataset.type='enemy'; saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenUpdate', id:(token.dataset.id||''), fields:{type:'enemy'}}}); } else if(k==='type_neutral'){ delete token.dataset.type; saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenUpdate', id:(token.dataset.id||''), fields:{type:''}}}); } hideContextMenu(); }); }
function positionMenu(menu,x,y){ const vw=window.innerWidth,vh=window.innerHeight; const r=menu.getBoundingClientRect(); if(x+r.width>vw) x=vw-r.width-10; if(y+r.height>vh) y=vh-r.height-10; menu.style.left=x+'px'; menu.style.top=y+'px'; }
function hideContextMenu(){ document.getElementById('tokenContextMenu')?.remove(); }
function duplicateToken(tok){ if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; } const layer=document.getElementById('tokenLayer'); const d=tok.cloneNode(true); d.dataset.id = uid(); d.style.left=(parseFloat(tok.style.left)+30)+'px'; d.style.top=(parseFloat(tok.style.top)+30)+'px'; layer.appendChild(d); updateTokenBadges(d); saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)){ const payload={ id:d.dataset.id, x:parseFloat(d.style.left), y:parseFloat(d.style.top), title:d.title, type:d.dataset.type||'', hp:d.dataset.hp||'', vision:d.dataset.vision||'', bg:d.style.backgroundImage||'' }; broadcast({type:'op', op:{kind:'tokenAdd', token: payload}}); } }
function updateTokenBadges(tok){ let stack=tok.querySelector('.badge-stack'); if(!stack){ stack=document.createElement('div'); stack.className='badge-stack'; tok.appendChild(stack); } stack.innerHTML=''; if(tok.dataset.hp){ const hp=document.createElement('div'); hp.className='hp-badge'; hp.textContent=tok.dataset.hp; stack.appendChild(hp); } }

// ----- Ruler -----
let rulerActive=false; let rulerStart=null; let rulerEl=null;
function startRulerMode(){ rulerActive=true; document.getElementById('rulerBtn')?.classList.add('active'); const stage=document.getElementById('mapStage'); stage.addEventListener('mousedown', rulerDown,{once:true}); }
function rulerDown(e){ const stage=document.getElementById('mapStage'); const rect=stage.getBoundingClientRect(); rulerStart={x:e.clientX-rect.left,y:e.clientY-rect.top}; rulerEl=document.createElement('div'); rulerEl.className='ruler-line'; stage.appendChild(rulerEl); function mv(ev){ const grid = +document.getElementById('gridSizeInput')?.value||50; const snap = document.getElementById('snapToggle')?.checked; const rx=ev.clientX-rect.left, ry=ev.clientY-rect.top; const ex=snap? Math.round(rx/grid)*grid : rx; const ey=snap? Math.round(ry/grid)*grid : ry; const sx=snap? Math.round(rulerStart.x/grid)*grid : rulerStart.x; const sy=snap? Math.round(rulerStart.y/grid)*grid : rulerStart.y; const dx=ex-sx, dy=ey-sy; const len=Math.sqrt(dx*dx+dy*dy); const squares=(len/grid).toFixed(1); rulerEl.textContent=`${len.toFixed(0)} px • ${squares} squares`; const left=Math.min(ex,sx), top=Math.min(ey,sy); Object.assign(rulerEl.style,{left:left+'px',top:top+'px',width:Math.abs(dx)+'px',height:Math.abs(dy)+'px'}); } function up(){ stage.removeEventListener('mousemove',mv); stage.removeEventListener('mouseup',up); setTimeout(()=>{ rulerEl?.remove(); rulerActive=false; document.getElementById('rulerBtn')?.classList.remove('active'); },1500); } stage.addEventListener('mousemove',mv); stage.addEventListener('mouseup',up); }

// ----- Background Image -----
function handleBgUpload(e){ const file=e.target.files[0]; if(!file) return; if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); e.target.value=''; return; } const reader=new FileReader(); reader.onload=ev=> { boardSettings.bgImage=ev.target.result; persistBoardSettings(); applyBoardBackground(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'bg', data: boardSettings.bgImage}}); }; reader.readAsDataURL(file); e.target.value=''; }
function applyBoardBackground(){ const c=document.getElementById('battleMap'); if(!c) return; if(boardSettings.bgImage){ c.style.backgroundImage=`url(${boardSettings.bgImage})`; c.parentElement.classList.add('background-image'); } else { c.style.backgroundImage=''; c.parentElement.classList.remove('background-image'); } }

// ----- Export / Import -----
function exportBoardState(){ const payload={ tokens:[...document.querySelectorAll('.token')].map(t=>({x:parseFloat(t.style.left),y:parseFloat(t.style.top),title:t.title,type:t.dataset.type||'',hp:t.dataset.hp||'',vision:t.dataset.vision||'',bg:t.style.backgroundImage||''})), walls, templates, initiative, boardSettings, fog: localStorage.getItem('fogData')||null }; const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.download='board-state.json'; a.href=URL.createObjectURL(blob); a.click(); }
function importBoardState(e){ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=ev=> { try{ const data=JSON.parse(ev.target.result); if(data.tokens){ localStorage.setItem('mapTokens', JSON.stringify(data.tokens)); loadTokens(); } if(data.walls){ walls=data.walls; persistWalls(); drawWalls(); } if(data.templates){ templates=data.templates; persistTemplates(); drawTemplates(); } if(data.initiative){ initiative=data.initiative; persistInitiative(); renderInitiative(); } if(data.boardSettings){ boardSettings=data.boardSettings; persistBoardSettings(); applyBoardBackground(); } if(data.fog){ localStorage.setItem('fogData', data.fog); loadFog(); } computeVisionAuto(); }catch(err){ alert('Import failed: '+err.message); } finally { e.target.value=''; }; }; reader.readAsText(file); }

// ----- Scenes (save/load snapshots) -----
function wireScenes(){ const sel=document.getElementById('sceneSelect'); const saveB=document.getElementById('sceneSaveBtn'); const loadB=document.getElementById('sceneLoadBtn'); const manageB=document.getElementById('sceneManageBtn'); if(!sel||!saveB||!loadB||!manageB) return;
  const listEl=document.getElementById('sceneList'); const panel=document.getElementById('scenePanel'); const close=document.getElementById('scenePanelClose'); const delAll=document.getElementById('sceneDeleteAllBtn');
  function loadScenes(){ try{ return JSON.parse(localStorage.getItem('mapScenes')||'[]'); }catch{ return []; } }
  function saveScenes(arr){ try{ localStorage.setItem('mapScenes', JSON.stringify(arr)); }catch{} }
  function refreshSelect(){ const arr=loadScenes(); sel.innerHTML = arr.map((s,i)=>`<option value="${i}">${escapeHtml(s.name)}</option>`).join(''); }
  function refreshPanel(){ if(!panel||!listEl) return; const arr=loadScenes(); listEl.innerHTML=''; arr.forEach((s,i)=>{ const li=document.createElement('li'); li.innerHTML = `<span class="title">${escapeHtml(s.name)}</span><div class="panel-actions"><button class="mini-btn" data-load="${i}">Load</button><button class="mini-btn danger" data-del="${i}">Del</button></div>`; listEl.appendChild(li); }); }
  refreshSelect();
  saveB.addEventListener('click', ()=>{ const name=prompt('Scene name:'); if(!name) return; const arr=loadScenes(); arr.push({ name, data: exportStateObj() }); saveScenes(arr); refreshSelect(); });
  loadB.addEventListener('click', ()=>{ const idx=parseInt(sel.value||'-1'); const arr=loadScenes(); if(idx>=0 && arr[idx]){ importStateObj(arr[idx].data); computeVisionAuto(); }});
  manageB.addEventListener('click', ()=>{ refreshPanel(); panel?.classList.remove('hidden'); });
  close?.addEventListener('click', ()=> panel?.classList.add('hidden'));
  delAll?.addEventListener('click', ()=>{ if(confirm('Delete all scenes?')){ localStorage.removeItem('mapScenes'); refreshSelect(); refreshPanel(); }});
  listEl?.addEventListener('click', (e)=>{
    const btn=e.target.closest('button'); if(!btn) return; const arr=loadScenes(); const loadIdx=btn.dataset.load? parseInt(btn.dataset.load): -1; const delIdx=btn.dataset.del? parseInt(btn.dataset.del): -1;
    if(loadIdx>-1 && arr[loadIdx]){ importStateObj(arr[loadIdx].data); computeVisionAuto(); }
    if(delIdx>-1){ arr.splice(delIdx,1); saveScenes(arr); refreshSelect(); refreshPanel(); }
  });
}

// ----- Persistence helpers -----
function persistBoardSettings(){ try{ localStorage.setItem('boardSettings', JSON.stringify(boardSettings)); }catch{} }
function loadBoardSettings(){ try{ const raw=localStorage.getItem('boardSettings'); if(raw) boardSettings=JSON.parse(raw); }catch{} }
function applyGmMode(){ document.body.classList.toggle('gm-mode', !!boardSettings.gmMode); const fog=document.getElementById('fogCanvas'); if(!fog) return; fog.style.visibility = boardSettings.gmMode? 'hidden' : 'visible'; const gmToggle=document.getElementById('gmModeToggle'); if(gmToggle) gmToggle.checked = !!boardSettings.gmMode; }

// ----- Fog history (undo) -----
function pushFogHistory(){ try{ const d=fogCtx?.canvas.toDataURL(); if(d){ fogHistory.push(d); if(fogHistory.length>20) fogHistory.shift(); } }catch{} }
function undoFogStep(){ if(!fogHistory.length) return; const last=fogHistory.pop(); const img=new Image(); img.onload=()=> { fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); fogCtx.globalCompositeOperation='source-over'; fogCtx.drawImage(img,0,0); saveFog(); }; img.src=last; }

// Pref helpers and toast
function savePref(k,v){ try{ localStorage.setItem('pref:'+k, v);}catch{} }
function loadPref(k,def){ try{ const v=localStorage.getItem('pref:'+k); return v==null? def : v; }catch{ return def; } }
function toast(msg){ const t=document.getElementById('toast'); if(!t) return; t.textContent=msg; t.classList.remove('hidden'); clearTimeout(toast._tmr); toast._tmr = setTimeout(()=> t.classList.add('hidden'), 1200); }

// Export PNG snapshot of the map (simple composite)
function exportPngSnapshot(){ const map=document.getElementById('battleMap'); const wallsC=document.getElementById('wallsCanvas'); const fogC=document.getElementById('fogCanvas'); const overC=document.getElementById('overlayCanvas'); const tokenLayer=document.getElementById('tokenLayer'); const W=map.width, H=map.height; const out=document.createElement('canvas'); out.width=W; out.height=H; const ctx=out.getContext('2d');
  // Background fill (patterned board color)
  ctx.fillStyle = '#101417'; ctx.fillRect(0,0,W,H);
  // Walls
  if(wallsC) ctx.drawImage(wallsC,0,0);
  // Tokens (approximate by drawing circles with stroke color and background)
  [...tokenLayer.querySelectorAll('.token')].forEach(t=> {
    const x=parseFloat(t.style.left), y=parseFloat(t.style.top); const r=30;
    ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.clip();
    const bg=t.style.backgroundImage; const m=bg&&bg.match(/url\("?(.*?)"?\)/);
    if(m&&m[1]){ /* Note: External images may be tainted; we still draw a fallback */ ctx.fillStyle='#222'; ctx.fillRect(x-r,y-r,2*r,2*r); }
    else { ctx.fillStyle='#222'; ctx.fillRect(x-r,y-r,2*r,2*r); }
    ctx.restore(); ctx.strokeStyle=getTokenStroke(t); ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();
  });
  // Templates
  if(overC) ctx.drawImage(overC,0,0);
  // Optionally fog (omit when GM mode to share clean image)
  if(!boardSettings.gmMode && fogC) ctx.drawImage(fogC,0,0);
  const a=document.createElement('a'); a.download='map.png'; a.href=out.toDataURL('image/png'); a.click();
}
function getTokenStroke(t){ if(t.dataset.type==='enemy') return '#ff5576'; if(t.dataset.type==='player') return '#4f8dff'; return getComputedStyle(document.body).getPropertyValue('--accent')||'#4f8dff'; }

// ----- Token selection helper (updated) -----
function selectToken(t, additive){ if(!additive){ document.querySelectorAll('.token.selected').forEach(x=>x.classList.remove('selected')); } t.classList.add('selected'); }

// Keyboard actions
window.addEventListener('keydown', e=> { if(e.key==='Delete'){ const sel=[...document.querySelectorAll('.token.selected')]; if(sel.length){ if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; } const ids=sel.map(t=> t.dataset.id||''); sel.forEach(t=> t.remove()); saveTokens(); computeVisionAuto(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenDel', ids}}); } } });

// Helpers and keybinds for walls
function findNearestWall(x,y,thresh){ let best=-1,bd=1e9; walls.forEach((w,i)=>{ const d=distPointToSeg(x,y,w.x1,w.y1,w.x2,w.y2); if(d<bd){ bd=d; best=i; } }); return bd<=thresh? best : -1; }
let wallsRedo=[];
window.addEventListener('keydown', e=> { if(e.ctrlKey && (e.key==='z' || e.key==='Z')){ if(walls.length){ wallsRedo.push(walls.pop()); persistWalls(); drawWalls(); toast('Undo wall'); } e.preventDefault(); } else if(e.ctrlKey && (e.key==='y' || e.key==='Y')){ if(wallsRedo.length){ walls.push(wallsRedo.pop()); persistWalls(); drawWalls(); toast('Redo wall'); } e.preventDefault(); } });

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

// ---------------- Multiplayer helpers ----------------
function openMpModalHost(){ const m=document.getElementById('mpModal'); if(!m) return; m.classList.remove('hidden'); const lbl=document.getElementById('mpRoleLabel'); if(lbl) lbl.textContent='Host (GM)'; }
function openMpModalJoin(){ const m=document.getElementById('mpModal'); if(!m) return; m.classList.remove('hidden'); const lbl=document.getElementById('mpRoleLabel'); if(lbl) lbl.textContent='Join as Player'; }
function startMp(asHost){
  const server=(document.getElementById('mpServerUrl')?.value||'').trim();
  const room=(document.getElementById('mpRoomCode')?.value||'').trim() || Math.random().toString(36).slice(2,8);
  const name=(document.getElementById('mpName')?.value||'').trim() || (asHost? 'GM':'Player');
  if(!server){ toast('Enter server URL (ws:// or wss://)'); return; }
  mp.server=server; mp.room=room; mp.name=name; mp.isGM=!!asHost; mp.connected=false; saveMpPrefs(); connectWs();
  document.getElementById('mpModal')?.classList.add('hidden');
  renderSessionBanner();
}
function copyJoinLink(){ if(!mp.server || !mp.room){ toast('Start a session first'); return; } const url=new URL(location.href); url.hash = `#join=${encodeURIComponent(mp.server)}|${encodeURIComponent(mp.room)}`; navigator.clipboard?.writeText(url.toString()).then(()=> toast('Join link copied')).catch(()=> toast('Copy failed'));
}
function parseJoinHash(){ try{ const h=location.hash||''; const m=h.match(/#join=([^|]+)\|(.+)/); if(!m) return null; return {server:decodeURIComponent(m[1]), room:decodeURIComponent(m[2])}; }catch{ return null; } }
function setMpStatus(txt){ const el=document.getElementById('mpStatus'); if(el) el.textContent = txt; renderSessionBanner(); }
function connectWs(){ try{
    const url = new URL(mp.server);
    if(url.protocol!=='ws:' && url.protocol!=='wss:'){ toast('Server must be ws:// or wss://'); return; }
  }catch{ toast('Invalid server URL'); return; }
  try{ if(mp.ws){ try{ mp.ws.close(); }catch{} mp.ws=null; } }catch{}
  const ws = new WebSocket(mp.server);
  mp.ws = ws; setMpStatus('Connecting…');
  ws.onopen = ()=>{ mp.connected=true; setMpStatus('Connected');
    mp._retries = 0;
  saveMpPrefs();
    // subscribe to room
    ws.send(JSON.stringify({type:'join', room: mp.room, name: mp.name, role: (mp.isGM?'gm':'player')}));
  try{ presence.peers.clear(); }catch{}
    // send initial state if GM
    if(mp.isGM){ const snapshot = exportStateObj(); broadcast({type:'state', data: snapshot}); }
    // start presence pings
    startPresence();
  };
  ws.onclose = ()=>{ mp.connected=false; stopPresence(); setMpStatus('Disconnected'); scheduleReconnect(); };
  ws.onerror = ()=>{ setMpStatus('Error'); };
  ws.onmessage = ev=> { try{ const msg = JSON.parse(ev.data); handleMpMessage(msg); }catch(e){ console.warn('bad msg', e); } };
}
function scheduleReconnect(){
  if(!mp.server || !mp.room) return; // not configured
  const maxDelay = 8000;
  const delay = Math.min(maxDelay, 500 * Math.pow(2, (mp._retries||0)));
  mp._retries = (mp._retries||0) + 1;
  setTimeout(()=> { if(!mp.connected){ connectWs(); } }, delay);
}
function broadcast(msg){ try{ if(!mp.ws || !mp.connected) return; // tag messages to avoid echo loops
  msg = {...msg, room: mp.room, from: mp.name, _ts: Date.now()}; mp.ws.send(JSON.stringify(msg)); }catch{}
}
// ---- Presence (lightweight roster) ----
const presence = {
  peers: new Map(), // peerId -> { name, role, ts }
  interval: null,
};
function startPresence(){
  stopPresence();
  presence.interval = setInterval(()=>{
    if(!mp.connected) return;
  broadcast({ type:'presence', id: mp.peerId, name: mp.name||'', role: (mp.isGM?'gm':'player') });
  prunePresence();
  renderSessionBanner();
  }, 4000);
  // also announce immediately
  broadcast({ type:'presence', id: mp.peerId, name: mp.name||'', role: (mp.isGM?'gm':'player') });
}
function stopPresence(){ if(presence.interval){ clearInterval(presence.interval); presence.interval=null; } }
function prunePresence(){ const now=Date.now(); for(const [id,info] of presence.peers){ if(now-(info.ts||0) > 12000) presence.peers.delete(id); } }
function upsertPresence(msg){ if(!msg?.id) return; presence.peers.set(msg.id, { name: msg.name||'Player', role: msg.role||'player', ts: Date.now() }); prunePresence(); renderSessionBanner(); }
function exportStateObj(){ return { 
    tokens:[...document.querySelectorAll('.token')].map(t=>({id:t.dataset.id||uid(),x:parseFloat(t.style.left),y:parseFloat(t.style.top),title:t.title,type:t.dataset.type||'',hp:t.dataset.hp||'',vision:t.dataset.vision||'',bg:t.style.backgroundImage||''})),
    walls, templates, initiative, boardSettings,
    fog: localStorage.getItem('fogData')||null
  }; }
function importStateObj(data){ try{
  if(data.tokens){ localStorage.setItem('mapTokens', JSON.stringify(data.tokens)); loadTokens(); }
  if(data.walls){ walls=data.walls; persistWalls(); drawWalls(); }
  if(data.templates){ templates=data.templates; persistTemplates(); drawTemplates(); }
  if(data.initiative){ initiative=data.initiative; persistInitiative(); renderInitiative(); }
  if(data.boardSettings){ boardSettings=data.boardSettings; persistBoardSettings(); applyBoardSettings(); }
  if(data.fog){ try{ localStorage.setItem('fogData', data.fog); loadFog(); }catch{} }
}catch(e){ console.error('importStateObj', e); }}
function applyBoardSettings(){
  document.getElementById('snapToggle') && (document.getElementById('snapToggle').checked = !!boardSettings.snap);
  applyBoardBackground(); applyGmMode(); computeVisionAuto();
}
function handleMpMessage(msg){
  if(!msg || msg.room!==mp.room) return; // other room
  if(msg.type==='perm'){
    if(!mp.isGM){ mp.allowEdits = !!msg.allowEdits; const el=document.getElementById('playersEditToggle'); if(el) el.checked = mp.allowEdits; setMpStatus(mp.allowEdits? 'Players can edit' : 'View-only'); }
    return;
  }
  if(msg.type==='state' && !mp.isGM){ importStateObj(msg.data||{}); setMpStatus('Synced'); return; }
  if(msg.type==='cursor'){ updateRemoteCursor(msg); return; }
  if(msg.type==='presence'){ upsertPresence(msg); return; }
  if(msg.type==='op' && msg.op){ applyRemoteOp(msg.op); return; }
}
function applyRemoteOp(op){ if(!op) return; mp.silent = true; try{
  if(op.kind==='move'){
    const t=[...document.querySelectorAll('.token')].find(x=> (x.dataset.id||'')===op.id);
    if(t){ t.style.left = op.x+'px'; t.style.top = op.y+'px'; saveTokens(); if(boardSettings.visionAuto) computeVisionAuto(); }
  } else if(op.kind==='walls'){
    walls = Array.isArray(op.walls)? op.walls: walls; persistWalls(); drawWalls(); if(boardSettings.visionAuto) computeVisionAuto();
  } else if(op.kind==='templates'){
    templates = Array.isArray(op.templates)? op.templates: templates; persistTemplates(); drawTemplates();
  } else if(op.kind==='fog'){
    if(op.data){ try{ localStorage.setItem('fogData', op.data); loadFog(); }catch{} }
  } else if(op.kind==='tokensSet'){
    if(Array.isArray(op.tokens)){ try{ localStorage.setItem('mapTokens', JSON.stringify(op.tokens)); loadTokens(); if(boardSettings.visionAuto) computeVisionAuto(); }catch{} }
  } else if(op.kind==='tokenAdd'){
    if(op.token){ try{ const t=op.token; const layer=document.getElementById('tokenLayer'); if(layer){ const d=document.createElement('div'); d.className='token'; d.dataset.id=t.id||uid(); d.style.left=t.x+'px'; d.style.top=t.y+'px'; d.title=t.title||'token'; if(t.type) d.dataset.type=t.type; if(t.hp) d.dataset.hp=t.hp; if(t.vision) d.dataset.vision=t.vision; if(t.bg) d.style.backgroundImage=t.bg; layer.appendChild(d); updateTokenBadges(d); saveTokens(); if(boardSettings.visionAuto) computeVisionAuto(); } }catch{} }
  } else if(op.kind==='tokenUpdate'){
    const t=[...document.querySelectorAll('.token')].find(x=> (x.dataset.id||'')===op.id); if(t && op.fields){ Object.entries(op.fields).forEach(([k,v])=>{ if(k==='hp'){ t.dataset.hp=String(v); updateTokenBadges(t); } else if(k==='type'){ if(v) t.dataset.type=String(v); else delete t.dataset.type; } else if(k==='vision'){ t.dataset.vision=String(v); } else if(k==='title'){ t.title=String(v); } }); saveTokens(); if(op.fields && Object.prototype.hasOwnProperty.call(op.fields,'vision') && boardSettings.visionAuto) computeVisionAuto(); }
  } else if(op.kind==='tokenDel'){
    const ids=op.ids||[]; if(ids.length){ [...document.querySelectorAll('.token')].forEach(t=> { if(ids.includes(t.dataset.id||'')) t.remove(); }); saveTokens(); if(boardSettings.visionAuto) computeVisionAuto(); }
  } else if(op.kind==='tokensClear'){
    const layer=document.getElementById('tokenLayer'); if(layer){ layer.innerHTML=''; saveTokens(); if(boardSettings.visionAuto) computeVisionAuto(); }
  } else if(op.kind==='initAdd'){
    const items=op.items||[]; items.forEach(it=> { if(!initiative.order.some(o=>o.id===it.id)) initiative.order.push({id:it.id, name:it.name}); }); persistInitiative(); renderInitiative(); highlightActiveToken();
  } else if(op.kind==='initRemove'){
    const id=op.id; if(id){ initiative.order=initiative.order.filter(o=> o.id!==id); if(initiative.current>=initiative.order.length) initiative.current=0; persistInitiative(); renderInitiative(); highlightActiveToken(); }
  } else if(op.kind==='initCycle'){
    const dir=op.dir||1; if(initiative.order.length){ initiative.current=(initiative.current+dir+initiative.order.length)%initiative.order.length; renderInitiative(); highlightActiveToken(); }
  } else if(op.kind==='initClear'){
    initiative={order:[],current:0}; persistInitiative(); renderInitiative(); highlightActiveToken();
  } else if(op.kind==='bg'){
    if(typeof op.data==='string'){ boardSettings.bgImage=op.data; persistBoardSettings(); applyBoardBackground(); }
  }
} finally { mp.silent = false; } }

// Strengthen fog buttons with permissions + broadcast
(function hardenFogButtons(){
  const full=document.getElementById('fogFullBtn'); const clr=document.getElementById('fogClearBtn'); const rev=document.getElementById('fogRevealBtn'); const canvas=document.getElementById('fogCanvas');
  full && full.addEventListener('click', ()=> { if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; } setTimeout(()=> { if(!mp.silent) broadcast({type:'op', op:{kind:'fog', data: localStorage.getItem('fogData')||null}}); }, 50); });
  clr && clr.addEventListener('click', ()=> { if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; } setTimeout(()=> { if(!mp.silent) broadcast({type:'op', op:{kind:'fog', data: localStorage.getItem('fogData')||null}}); }, 50); });
  if(canvas){ canvas.addEventListener('mouseup', ()=> { if(!( !mp.connected || mp.isGM || mp.allowEdits )) return; setTimeout(()=> { if(!mp.silent) broadcast({type:'op', op:{kind:'fog', data: localStorage.getItem('fogData')||null}}); }, 100); }); }
})();

// -------- Welcome Landing (Create / Join / Solo) --------
function initWelcomeLanding(){
  const modal=document.getElementById('welcomeModal'); if(!modal) return;
  // If hash autjoIn, keep modal but user likely intends to join; otherwise show by default
  modal.classList.remove('hidden');
  const nameEl=document.getElementById('wlName');
  const inviteEl=document.getElementById('wlInvite');
  const prefs = loadMpPrefs();
  if(nameEl) nameEl.value = prefs.name || '';
  function genRoom(){ return Math.random().toString(36).slice(2,8); }
  function parseInvite(v){ try{ const u=new URL(v); const m=u.hash.match(/#join=([^|]+)\|(.+)/); if(m) return { server: decodeURIComponent(m[1]), room: decodeURIComponent(m[2])}; }catch{} return null; }
  document.getElementById('wlCreate')?.addEventListener('click', ()=>{
    const name=(nameEl?.value||'GM').trim()||'GM';
    const room=genRoom();
    const server=prefs.server||'';
    if(!server){ toast('Set your relay URL in Advanced (wss://…)'); return; }
    document.getElementById('mpName') && (document.getElementById('mpName').value=name);
    document.getElementById('mpRoomCode') && (document.getElementById('mpRoomCode').value=room);
    document.getElementById('mpServerUrl') && (document.getElementById('mpServerUrl').value=server);
    modal.classList.add('hidden');
    mp.server=server; mp.room=room; mp.name=name; mp.isGM=true; mp.connected=false; saveMpPrefs(); connectWs(); renderSessionBanner();
  });
  document.getElementById('wlJoin')?.addEventListener('click', ()=>{
    const name=(nameEl?.value||'Player').trim()||'Player';
    const parsed = parseInvite(inviteEl?.value||'');
    if(!parsed){ toast('Paste a valid invite link'); return; }
    const {server, room} = parsed;
    document.getElementById('mpName') && (document.getElementById('mpName').value=name);
    document.getElementById('mpRoomCode') && (document.getElementById('mpRoomCode').value=room);
    document.getElementById('mpServerUrl') && (document.getElementById('mpServerUrl').value=server);
    modal.classList.add('hidden');
    mp.server=server; mp.room=room; mp.name=name; mp.isGM=false; mp.connected=false; saveMpPrefs(); connectWs(); renderSessionBanner();
  });
  document.getElementById('wlSolo')?.addEventListener('click', ()=>{
    const soloName=(nameEl?.value||'').trim(); if(soloName){ mp.name=soloName; saveMpPrefs(); }
    mp.server=''; mp.room=''; mp.connected=false; modal.classList.add('hidden'); setMpStatus('Solo'); renderSessionBanner();
  });
  document.getElementById('wlAdvanced')?.addEventListener('click', ()=>{
    // Show the original MP modal for manual server/room setup
    document.getElementById('mpModal')?.classList.remove('hidden');
  });
}

// -------- Live Cursors --------
let cursors = new Map(); // name -> {x,y,color,el,ts}
function wireLiveCursors(){
  const stage=document.getElementById('mapStage'); const layer=document.getElementById('cursorLayer'); if(!stage||!layer) return;
  const colors=['#4f8dff','#ff5576','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c'];
  const colorFor=(n)=>{ const h=[...n].reduce((a,c)=>a+c.charCodeAt(0),0); return colors[h%colors.length]; };
  let lastSend=0; function send(ev){ if(!mp.connected) return; const now=performance.now(); if(now-lastSend<40) return; lastSend=now; const rect=stage.getBoundingClientRect(); const x=ev.clientX-rect.left; const y=ev.clientY-rect.top; broadcast({type:'cursor', room: mp.room, name: mp.name, x, y}); }
  stage.addEventListener('mousemove', send);
  // Cleanup stale cursors
  setInterval(()=>{ const now=Date.now(); for(const [k,v] of cursors){ if(now-(v.ts||0) > 4000){ v.el?.remove(); cursors.delete(k); } } }, 3000);

  window.updateRemoteCursor = function(msg){
    if(!msg || msg.name===mp.name) return; // ignore self
    const layer=document.getElementById('cursorLayer'); if(!layer) return;
    const color=colorFor(msg.name||'peer');
    let c=cursors.get(msg.name);
    if(!c){ const el=document.createElement('div'); el.className='remote-cursor'; el.innerHTML = `<span class="dot" style="background:${color}"></span><span class="tag">${escapeHtml(msg.name||'Player')}</span>`; layer.appendChild(el); c={el}; cursors.set(msg.name,c); }
    c.ts = Date.now(); c.x=msg.x; c.y=msg.y; c.el.style.left=msg.x+'px'; c.el.style.top=msg.y+'px';
  }
}

// ------- Session banner (top of map view) -------
function renderSessionBanner(){
  const el=document.getElementById('sessionBanner'); if(!el) return;
  if(!mp.server || !mp.room){
    el.innerHTML = '<span class="grow">You are in Solo mode. Create or Join a table to play with others.</span>'+
      '<button class="accent-btn" id="bnCreate">Create Table</button>'+
      '<button class="mini-btn" id="bnJoin">Join</button>';
    el.querySelector('#bnCreate')?.addEventListener('click', ()=>{ document.getElementById('welcomeModal')?.classList.remove('hidden'); });
    el.querySelector('#bnJoin')?.addEventListener('click', ()=>{ document.getElementById('welcomeModal')?.classList.remove('hidden'); });
    return;
  }
  const link = new URL(location.href); link.hash = `#join=${encodeURIComponent(mp.server)}|${encodeURIComponent(mp.room)}`;
  const role = mp.isGM? 'GM' : 'Player';
  const status = document.getElementById('mpStatus')?.textContent || (mp.connected? 'Connected':'Offline');
  // Build quick roster summary
  const peers = [...presence.peers.values()].sort((a,b)=> a.name.localeCompare(b.name));
  const count = peers.length;
  const names = peers.slice(0,4).map(p=> escapeHtml(p.name)).join(', ')+ (peers.length>4? ` +${peers.length-4}`:'' );
  el.innerHTML = `<span class="pill">${escapeHtml(role)}</span>`+
    `<span class="pill">Room: ${escapeHtml(mp.room)}</span>`+
    `<span class="pill" title="Connected peers seen in last 12s">Peers: ${count}</span>`+
    `<span class="muted small" style="max-width:40ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${names}</span>`+
    `<span class="grow">${escapeHtml(status)}</span>`+
    `<button class="mini-btn" id="bnCopy">Copy Invite</button>`+
    `<button class="mini-btn" id="bnReconnect">Reconnect</button>`;
  el.querySelector('#bnCopy')?.addEventListener('click', ()=>{
    navigator.clipboard?.writeText(link.toString()).then(()=> toast('Invite copied')).catch(()=> toast('Copy failed'));
  });
  el.querySelector('#bnReconnect')?.addEventListener('click', ()=>{ if(mp.server){ connectWs(); }});
}

init();

// -------- Token Inspector --------
function wireTokenInspector(){
  const nameI=document.getElementById('tiName'); const typeI=document.getElementById('tiType'); const hpI=document.getElementById('tiHP'); const visI=document.getElementById('tiVision');
  if(!nameI||!typeI||!hpI||!visI) return;
  function current(){ return document.querySelector('.token.selected'); }
  // Reflect selection into form
  const layer=document.getElementById('tokenLayer');
  layer?.addEventListener('click', ()=> fill());
  window.addEventListener('keydown', e=> { if(e.key==='Tab' || e.key==='Enter'){ setTimeout(fill, 0); }});
  function fill(){ const t=current(); if(!t){ nameI.value=''; typeI.value=''; hpI.value=''; visI.value=''; return; } nameI.value=t.title||''; typeI.value=t.dataset.type||''; hpI.value=t.dataset.hp||''; visI.value=t.dataset.vision||''; }
  // Apply edits
  function push(fields){ const t=current(); if(!t) return; Object.entries(fields).forEach(([k,v])=>{
    if(k==='title'){ t.title=String(v||''); }
    if(k==='type'){ if(v) t.dataset.type=String(v); else delete t.dataset.type; }
    if(k==='hp'){ if(v!=='' && v!=null) t.dataset.hp=String(v); else delete t.dataset.hp; updateTokenBadges(t); }
    if(k==='vision'){ if(v!=='' && v!=null) t.dataset.vision=String(v); else delete t.dataset.vision; if(boardSettings.visionAuto) computeVisionAuto(); }
  }); saveTokens(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'tokenUpdate', id:(t.dataset.id||''), fields}}); }
  nameI.addEventListener('input', ()=> push({title:nameI.value}));
  typeI.addEventListener('change', ()=> push({type:typeI.value}));
  hpI.addEventListener('input', ()=> push({hp:hpI.value}));
  visI.addEventListener('input', ()=> push({vision:visI.value}));
}
