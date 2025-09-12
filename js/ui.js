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
function loadBoardSettings(){ try{ const raw=localStorage.getItem('boardSettings'); if(raw){ const parsed=JSON.parse(raw); if(parsed && typeof parsed==='object') boardSettings={...boardSettings, ...parsed}; } }catch{} }
function persistBoardSettings(){ try{ localStorage.setItem('boardSettings', JSON.stringify(boardSettings)); }catch{} }
function applyBoardBackground(){
  try{ const canvas=document.getElementById('battleMap'); if(!canvas) return; const ctx=canvas.getContext('2d'); if(!ctx) return; // simple background fill or image
    ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.fillStyle='#101417'; ctx.fillRect(0,0,canvas.width,canvas.height); if(boardSettings.bgImage){ const img=new Image(); img.onload=()=>{ ctx.drawImage(img,0,0,canvas.width,canvas.height); }; img.src=boardSettings.bgImage; }
  }catch{}
}
async function handleBgUpload(e){ const file=e.target.files && e.target.files[0]; if(!file) return; try{ const url = await new Promise(r=>{ const rd=new FileReader(); rd.onload=()=>r(rd.result); rd.readAsDataURL(file); }); boardSettings.bgImage=url; persistBoardSettings(); applyBoardBackground(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'bg', data:url}}); toast('Background set'); }catch(err){ console.error(err); toast('BG failed'); } finally { e.target.value=''; } }
let fogHistory = [];
// Multiplayer session state
let mp = { ws:null, connected:false, isGM:false, allowEdits:false, room:'', name:'', server:'', silent:false, _retries:0, peerId: (Math.random().toString(36).slice(2,10)), transport:'ws', fb:null };

function saveMpPrefs(){ try{ localStorage.setItem('mp:server', mp.server||''); localStorage.setItem('mp:room', mp.room||''); localStorage.setItem('mp:name', mp.name||''); localStorage.setItem('mp:isGM', mp.isGM? '1':''); localStorage.setItem('mp:transport', mp.transport||'ws'); if(mp.fb?.config){ localStorage.setItem('mp:fbConfig', JSON.stringify(mp.fb.config)); } }catch{} }
function loadMpPrefs(){ try{ return { server: localStorage.getItem('mp:server')||'', room: localStorage.getItem('mp:room')||'', name: localStorage.getItem('mp:name')||'', isGM: (localStorage.getItem('mp:isGM')==='1'), transport: localStorage.getItem('mp:transport')||'ws', fbConfig: (localStorage.getItem('mp:fbConfig')? JSON.parse(localStorage.getItem('mp:fbConfig')): null) }; }catch{ return {server:'',room:'',name:'',isGM:false,transport:'ws',fbConfig:null}; } }

// Utility IDs
function uid(){ return Math.random().toString(36).slice(2,9); }

// Global help wiring (works on every view)
function wireHelp(){
  const open=()=>{
    const modal=document.getElementById('mapHelpModal'); const title=document.getElementById('helpTitle'); const body=document.getElementById('helpContent');
    if(!modal||!title||!body) return;
    // Decide content based on current view
    const view=document.querySelector('.view.active')?.id||'';
    if(view==='view-map'){
      title.textContent='Board Help';
      body.innerHTML = '<ul>'+
        '<li>Add Token, Walls, Reveal, Ruler are the primary tools. More… opens advanced tools.</li>'+
        '<li>Drag tokens to move; right-click a token for actions (HP, Type, Vision, Duplicate, Delete).</li>'+
        '<li>Reveal lets you uncover areas. Use Grid + Snap for neat placement.</li>'+
        '<li>Share from the banner. GM can enable player editing.</li>'+
      '</ul>';
    } else if(view==='view-board'){
      title.textContent='Kanban Help';
      body.innerHTML = '<p>Group by a column, drag cards between columns, and add new cards with the New Card button.</p>';
    } else if(view==='view-table'){
      title.textContent='Table Help';
      body.innerHTML = '<p>Search and filter columns. Click a row to edit. Export as CSV/JSON from the toolbar.</p>';
    } else if(view==='view-entities'){
      title.textContent='Entities Help';
      body.innerHTML = '<p>Search entities. Click a tile for details. Use New Entry (Admin) to add items.</p>';
    } else if(view==='view-moves'){
      title.textContent='Moves Help';
      body.innerHTML = '<p>Create or edit a move on the left; it appears in the list on the right. You can import/export Excel.</p>';
    } else {
      title.textContent='Help';
      body.textContent = 'Use the navigation on the left to switch views.';
    }
    modal.classList.remove('hidden');
  };
  document.getElementById('helpFab')?.addEventListener('click', open);
  document.getElementById('closeMapHelp')?.addEventListener('click', ()=> document.getElementById('mapHelpModal')?.classList.add('hidden'));
  // Dismiss on backdrop click and Escape
  const modal=document.getElementById('mapHelpModal');
  modal?.addEventListener('click', (e)=> { if(e.target===modal) modal.classList.add('hidden'); });
  window.addEventListener('keydown', (e)=> { if(e.key==='Escape' && !document.getElementById('mapHelpModal')?.classList.contains('hidden')) document.getElementById('mapHelpModal')?.classList.add('hidden'); });
}

document.addEventListener('DOMContentLoaded', () => {
  wireHelp();
  wireAdvancedMap();
  wireCharacterPage();
});

function wireAdvancedMap(){
  const stage = document.getElementById('mapStage'); if(!stage) return;
  // More panel toggle
  const moreBtn=document.getElementById('mapMoreBtn');
  const morePanel=document.getElementById('mapMorePanel');
  if(moreBtn && morePanel){
    // Restore persisted state
    const open = loadPref('mapMoreOpen','false')==='true';
    morePanel.classList.toggle('hidden', !open);
    moreBtn.setAttribute('aria-controls','mapMorePanel');
    moreBtn.setAttribute('aria-expanded', String(open));
    moreBtn.addEventListener('click', ()=>{
      const nowHidden = morePanel.classList.toggle('hidden');
      const isOpen = !nowHidden;
      moreBtn.setAttribute('aria-expanded', String(isOpen));
      savePref('mapMoreOpen', isOpen? 'true':'false');
    });
  }
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
  // Quick lightweight code-based hosting (no manual config) — generates a short room and starts Firebase if configured else local relay default placeholder
  const quick = document.getElementById('hostGameBtn'); if(quick){ quick.addEventListener('dblclick', ()=> { quickHostQuickRoom(); }); }
  document.getElementById('playersEditToggle')?.addEventListener('change', e=> { mp.allowEdits=!!e.target.checked; broadcast({type:'perm', allowEdits: mp.allowEdits}); });
  document.getElementById('closeMpModal')?.addEventListener('click', ()=> document.getElementById('mpModal')?.classList.add('hidden'));
  document.getElementById('mpDoHost')?.addEventListener('click', ()=> startMp(true));
  document.getElementById('mpDoJoin')?.addEventListener('click', ()=> startMp(false));
  // Save Firebase config from MP modal
  document.getElementById('mpSaveFirebase')?.addEventListener('click', ()=>{
    const raw=(document.getElementById('mpFirebaseConfig')?.value||'').trim();
    if(!raw){ toast('Paste Firebase config JSON'); return; }
    try{ const cfg=JSON.parse(raw); mp.fb={config:cfg, app:null, db:null, unsub:null}; saveMpPrefs(); toast('Firebase saved'); }
    catch{ toast('Invalid Firebase config JSON'); }
  });
  // Initiative
  document.getElementById('initAddBtn')?.addEventListener('click', addSelectedToInitiative);
  document.getElementById('initPrevBtn')?.addEventListener('click', ()=> cycleInitiative(-1));
  document.getElementById('initNextBtn')?.addEventListener('click', ()=> cycleInitiative(1));
  document.getElementById('initClearBtn')?.addEventListener('click', ()=> { initiative={order:[],current:0}; persistInitiative(); renderInitiative(); });
  // Global listeners for multi-select
  stage.addEventListener('mousedown', onStageMouseDown);
  window.addEventListener('keydown', e=> { if(e.key==='m' || e.key==='M') startRulerMode(); });
  // ESC handling for walls
  window.addEventListener('keydown', e=> { if(e.key==='Escape'){ if(wallTempPoint){ wallTempPoint=null; hideWallPreview(); showWallHint('Placement cancelled. Click to start again.'); } else if(wallEditIndex>-1){ clearWallSelection(); showWallHint('Edit cancelled.'); } else if(wallMode){ toggleWallMode(); toast('Wall mode off'); } } });
  // Live preview while placing walls
  document.addEventListener('mousemove', e=> { if(!wallMode || !wallTempPoint) return; const stage=document.getElementById('mapStage'); if(!stage) return; const rect=stage.getBoundingClientRect(); let x=e.clientX-rect.left, y=e.clientY-rect.top; const p=snapPoint(x,y); x=p.x; y=p.y; if(e.shiftKey){ const sn=angleSnap(wallTempPoint.x,wallTempPoint.y,x,y); x=sn.x2; y=sn.y2; } showWallPreview(wallTempPoint.x,wallTempPoint.y,x,y); });
  // Context menu
  stage.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('click', hideContextMenu);
  computeVisionAuto();
  // Auto-join via hash (supports Relay or Firebase)
  const j=parseJoinHash(); if(j){
    const prefs = loadMpPrefs();
    mp.transport = j.transport||'ws';
    mp.server = j.server||''; mp.room = j.room; mp.name = prefs.name || 'Player'; mp.isGM = false; mp.connected=false;
    if(mp.transport==='fb'){
      if(prefs.fbConfig){ mp.fb={config:prefs.fbConfig, app:null, db:null, unsub:null}; saveMpPrefs(); connectFirebase(); toast('Joining room '+mp.room); }
      else { toast('Firebase config needed. Open Welcome → paste config → Save Firebase.'); }
    } else {
      connectWs(); toast('Joining room '+mp.room);
    }
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

// --- Simple quick room creation (auto code) ---
function genShortRoom(){ return Math.random().toString(36).replace(/[^a-z0-9]/g,'').slice(2,8); }
function quickHostQuickRoom(){
  if(mp.connected){ toast('Already online'); return; }
  const prefs=loadMpPrefs(); const room=genShortRoom(); const name=prefs.name||'GM';
  if(prefs.fbConfig){ mp.transport='fb'; mp.fb={config:prefs.fbConfig, app:null, db:null, unsub:null}; mp.room=room; mp.name=name; mp.isGM=true; mp.connected=false; saveMpPrefs(); connectFirebase(); setMpStatus('Hosting quick room'); toast('Quick room '+room); renderSessionBanner(); }
  else {
    // fallback: ask user once for relay, else just local offline
    if(!prefs.server){ toast('Save a Relay or Firebase config first (Welcome)'); return; }
    mp.transport='ws'; mp.server=prefs.server; mp.room=room; mp.name=name; mp.isGM=true; mp.connected=false; saveMpPrefs(); connectWs(); setMpStatus('Hosting quick room'); toast('Quick room '+room); renderSessionBanner();
  }
}

// --- Tab presence highlight (broadcast active view) ---
let lastViewBroadcast=0;
function broadcastActiveView(){ if(!mp.connected) return; const now=performance.now(); if(now-lastViewBroadcast<1500) return; lastViewBroadcast=now; const view=document.querySelector('.nav-btn.active')?.dataset.view||''; broadcast({type:'presence', id:mp.peerId, name:mp.name, role:(mp.isGM?'gm':'player'), view}); }
setInterval(()=> broadcastActiveView(), 2000);

// ---------------- Character Page ----------------
const CHAR_KEY='charProfileV1';
let charProfile = { name:'', desc:'', img:null, stats:{}, inv:{hands:'',equip:'',store:''}, moves:[] };
function loadChar(){ try{ const raw=localStorage.getItem(CHAR_KEY); if(raw){ const p=JSON.parse(raw); if(p&&typeof p==='object') charProfile={...charProfile, ...p}; } }catch{} }
function saveChar(){ try{ localStorage.setItem(CHAR_KEY, JSON.stringify(charProfile)); }catch{} }
function wireCharacterPage(){ loadChar(); buildCharStats(); bindCharInputs(); renderCharMoves(); }
function buildCharStats(){
  const host=document.getElementById('charStats'); if(!host) return; host.innerHTML='';
  // Derive stat keys: use first 15 distinct capitalized column headers or fallback list
  const fallback=['ATF','ATM','DEF','DEM','VEL','VID','PRE','EVA','PAS','SUE','FZA','CON','INT','SAG','AGI','CRM','DST','VIT','ETK','EAC','EST','ESP'];
  let keys = (window.state?.headers||[]).filter(h=>/^[A-Z]{2,5}$/.test(h)).slice(0,24); if(!keys.length) keys=fallback;
  keys.forEach(k=>{ if(!(k in charProfile.stats)) charProfile.stats[k]=''; const cell=document.createElement('div'); cell.className='stat'; cell.innerHTML=`<label style='font-size:10px;letter-spacing:.5px;'>${k}</label><input data-stat='${k}' value='${escapeHtml(charProfile.stats[k]||'')}' />`; host.appendChild(cell); });
  host.querySelectorAll('input[data-stat]').forEach(inp=>{
    inp.addEventListener('input', ()=>{ const key=inp.dataset.stat; charProfile.stats[key]=inp.value.trim(); saveChar(); });
  });
}
function bindCharInputs(){
  const n=document.getElementById('charName'); const d=document.getElementById('charDesc'); const h=document.getElementById('invHands'); const e=document.getElementById('invEquip'); const s=document.getElementById('invStore'); const imgWrap=document.getElementById('charImgWrap'); const imgInput=document.getElementById('charImgInput'); const imgEl=document.getElementById('charImg'); const imgPh=document.getElementById('charImgPh');
  if(n){ n.value=charProfile.name||''; n.addEventListener('input', ()=>{ charProfile.name=n.value.trim(); saveChar(); }); }
  if(d){ d.value=charProfile.desc||''; d.addEventListener('input', ()=>{ charProfile.desc=d.value; saveChar(); }); }
  if(h){ h.value=charProfile.inv.hands||''; h.addEventListener('input', ()=>{ charProfile.inv.hands=h.value; saveChar(); }); }
  if(e){ e.value=charProfile.inv.equip||''; e.addEventListener('input', ()=>{ charProfile.inv.equip=e.value; saveChar(); }); }
  if(s){ s.value=charProfile.inv.store||''; s.addEventListener('input', ()=>{ charProfile.inv.store=s.value; saveChar(); }); }
  if(imgWrap && imgInput){ imgWrap.addEventListener('click', ()=> imgInput.click()); imgInput.addEventListener('change', async ev=>{ const file=ev.target.files?.[0]; if(!file) return; const rd=new FileReader(); rd.onload=()=>{ charProfile.img=rd.result; saveChar(); applyCharImage(); }; rd.readAsDataURL(file); }); applyCharImage(); }
  const filt=document.getElementById('charMoveFilter'); const add=document.getElementById('charMoveAdd'); const sug=document.getElementById('charMoveSuggestions');
  if(filt){ filt.addEventListener('input', ()=> renderCharMoves()); }
  if(add){ add.addEventListener('input', ()=> buildMoveSuggestions(add.value.trim(), sug)); add.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); quickAddMove(add.value.trim()); }}); }
}
function applyCharImage(){ const imgEl=document.getElementById('charImg'); const ph=document.getElementById('charImgPh'); if(!imgEl||!ph) return; if(charProfile.img){ imgEl.src=charProfile.img; imgEl.classList.remove('hidden'); ph.classList.add('hidden'); } else { imgEl.classList.add('hidden'); ph.classList.remove('hidden'); } }
function buildMoveSuggestions(term, container){ if(!container) return; if(!term){ container.classList.add('hidden'); container.innerHTML=''; return; } term=term.toLowerCase(); const matches=(moves||[]).filter(m=> m.name.toLowerCase().includes(term) && !charProfile.moves.includes(m.name)).slice(0,10); if(!matches.length){ container.classList.add('hidden'); container.innerHTML=''; return; } container.innerHTML=''; matches.forEach(m=>{ const b=document.createElement('button'); b.textContent=m.name; b.addEventListener('click', ()=>{ quickAddMove(m.name); container.classList.add('hidden'); document.getElementById('charMoveAdd').value=''; }); container.appendChild(b); }); container.classList.remove('hidden'); }
function quickAddMove(name){ if(!name) return; const mv=(moves||[]).find(m=> m.name.toLowerCase()===name.toLowerCase()); if(!mv){ toast('Move not found'); return; } if(charProfile.moves.includes(mv.name)){ toast('Already added'); return; } charProfile.moves.push(mv.name); saveChar(); renderCharMoves(); toast('Move added'); }
function removeCharMove(name){ charProfile.moves=charProfile.moves.filter(n=> n!==name); saveChar(); renderCharMoves(); }
function renderCharMoves(){ const list=document.getElementById('charMovesList'); if(!list) return; const filt=(document.getElementById('charMoveFilter')?.value||'').toLowerCase(); list.innerHTML=''; const assigned=charProfile.moves.map(n=> (moves||[]).find(m=> m.name===n)).filter(Boolean).filter(m=> !filt || m.name.toLowerCase().includes(filt) || (m.tags||[]).some(t=>t.toLowerCase().includes(filt))); if(!assigned.length){ list.innerHTML='<div class="muted">No moves assigned.</div>'; return; } assigned.forEach(m=>{ const card=document.createElement('div'); card.className='char-move'; card.innerHTML=`<button class='remove-move' title='Remove'>&times;</button><h3>${escapeHtml(m.name)}</h3><div class='desc small'>${escapeHtml(m.description||'')}</div><div class='tags'>${(m.tags||[]).map(t=>`<span class='tag'>${escapeHtml(t)}</span>`).join('')}</div>`; card.querySelector('.remove-move').addEventListener('click', ()=> removeCharMove(m.name)); list.appendChild(card); }); }

// ----- Walls -----
let wallMode = false, wallTempPoint=null;
let wallOverlayEl=null, wallPreviewEl=null, wallEditIndex=-1, wallDragHandle=null, wallEditing=false;
function ensureWallOverlay(){
  const stage=document.getElementById('mapStage'); if(!stage) return;
  if(!wallOverlayEl){ wallOverlayEl=document.createElement('div'); wallOverlayEl.id='wallOverlay'; wallOverlayEl.className='wall-overlay hidden'; stage.appendChild(wallOverlayEl); }
  if(!wallPreviewEl){ wallPreviewEl=document.createElement('div'); wallPreviewEl.id='wallPreview'; wallPreviewEl.className='wall-preview hidden'; stage.appendChild(wallPreviewEl); }
}
function toggleWallMode(){ wallMode = !wallMode; const b=document.getElementById('wallModeBtn'); if(b) b.classList.toggle('active', wallMode); ensureWallOverlay(); if(wallOverlayEl) wallOverlayEl.classList.toggle('hidden', !wallMode); if(!wallMode){ wallTempPoint=null; hideWallPreview(); clearWallSelection(); } else { showWallHint('Click to start a wall. Shift: snap 45°. Alt+Click existing wall: delete. Click wall segment: edit. Esc: cancel.'); } }
function showWallHint(msg){ if(!wallOverlayEl) return; let hint=wallOverlayEl.querySelector('.wall-hint'); if(!hint){ hint=document.createElement('div'); hint.className='wall-hint'; wallOverlayEl.appendChild(hint);} hint.textContent=msg; }
function showWallPreview(x1,y1,x2,y2){ ensureWallOverlay(); if(!wallPreviewEl) return; wallPreviewEl.classList.remove('hidden'); const dx=x2-x1, dy=y2-y1; const len=Math.sqrt(dx*dx+dy*dy); wallPreviewEl.style.left=Math.min(x1,x2)+'px'; wallPreviewEl.style.top=Math.min(y1,y2)+'px'; wallPreviewEl.style.width=Math.abs(dx)+'px'; wallPreviewEl.style.height=Math.abs(dy)+'px'; wallPreviewEl.dataset.x1=x1; wallPreviewEl.dataset.y1=y1; wallPreviewEl.dataset.x2=x2; wallPreviewEl.dataset.y2=y2; }
function hideWallPreview(){ if(wallPreviewEl) wallPreviewEl.classList.add('hidden'); }
function snapPoint(x,y){ const grid=+document.getElementById('gridSizeInput')?.value||50; const snap=document.getElementById('snapToggle')?.checked; return snap? {x:Math.round(x/grid)*grid, y:Math.round(y/grid)*grid} : {x,y}; }
function angleSnap(x1,y1,x2,y2){ // Snap to 45 deg if Shift
  const dx=x2-x1, dy=y2-y1; const ang=Math.atan2(dy,dx); const step=Math.PI/4; const snapAng=Math.round(ang/step)*step; const len=Math.sqrt(dx*dx+dy*dy); return {x2:x1+Math.cos(snapAng)*len, y2:y1+Math.sin(snapAng)*len}; }
function clearWallSelection(){ wallEditIndex=-1; document.getElementById('wallsCanvas')?.classList.remove('editing'); const existing=document.querySelectorAll('.wall-handle'); existing.forEach(e=>e.remove()); }
function selectWall(idx){ clearWallSelection(); if(idx<0||idx>=walls.length) return; wallEditIndex=idx; const w=walls[idx]; const stage=document.getElementById('mapStage'); if(!stage) return; const mk=(x,y,cls)=>{ const h=document.createElement('div'); h.className='wall-handle '+cls; h.style.left=(x-5)+'px'; h.style.top=(y-5)+'px'; h.dataset.kind=cls; h.addEventListener('mousedown', startWallHandleDrag); stage.appendChild(h);}; mk(w.x1,w.y1,'start'); mk(w.x2,w.y2,'end'); showWallHint('Dragging endpoints. Delete: Alt+Click wall. Esc: exit edit.');
}
function startWallHandleDrag(e){ if(wallEditIndex<0) return; wallDragHandle=e.target; wallEditing=true; e.preventDefault(); const move=(ev)=>{ const stage=document.getElementById('mapStage'); const rect=stage.getBoundingClientRect(); let x=ev.clientX-rect.left, y=ev.clientY-rect.top; const p=snapPoint(x,y); x=p.x; y=p.y; const w=walls[wallEditIndex]; if(wallDragHandle.dataset.kind==='start'){ w.x1=x; w.y1=y; } else { w.x2=x; w.y2=y; } persistWalls(); drawWalls(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'walls', walls}}); selectWall(wallEditIndex); };
  const up=()=>{ document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); wallEditing=false; wallDragHandle=null; };
  document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
}
function onStageMouseDown(e){
  const stage = document.getElementById('mapStage');
  if(e.target.closest('.token') || e.target.closest('.token-context')) return;
  if(wallMode){
    if(!( !mp.connected || mp.isGM || mp.allowEdits )){ toast('Editing disabled'); return; }
    const rect = stage.getBoundingClientRect();
    let x = e.clientX - rect.left; let y = e.clientY - rect.top; const p=snapPoint(x,y); x=p.x; y=p.y;
    // Click existing wall to edit
    const nearest = findNearestWall(x,y,8);
    if(nearest>-1 && !wallTempPoint && !e.altKey){ selectWall(nearest); e.preventDefault(); return; }
    // Alt+click to delete nearest wall
    if(e.altKey){ const idx = nearest; if(idx>-1){ walls.splice(idx,1); persistWalls(); drawWalls(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'walls', walls}}); toast('Wall removed'); clearWallSelection(); } return; }
    if(!wallTempPoint){ wallTempPoint={x,y}; hideWallPreview(); showWallHint('First point set. Click to finish. Esc cancels.'); }
    else {
      let x2=x, y2=y; if(e.shiftKey){ const sn=angleSnap(wallTempPoint.x,wallTempPoint.y,x,y); x2=sn.x2; y2=sn.y2; }
      walls.push({x1:wallTempPoint.x,y1:wallTempPoint.y,x2:x2,y2:y2}); wallTempPoint=null; hideWallPreview(); persistWalls(); drawWalls(); if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'walls', walls}}); showWallHint('Wall added. Click to start another or Esc to exit.');
    }
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
function boxDistToPoint(w,px,py){ const minx=Math.min(w.x1,w.x2), maxx=Math.max(w.x1,w.x2); const miny=Math.min(w.y1,w.y2), maxy=Math.max(w.y1,w.y2); const nx=Math.max(minx,Math.min(px,maxx)); const ny=Math.max(miny,Math.min(py,maxy)); const dx=px-nx, dy=py-ny; return Math.hypot(dx,dy); }
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

/*
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
*/

// Moves feature (lightweight list independent from sheet)
let moves = JSON.parse(localStorage.getItem('movesStore')||'[]');
let editingMove = null;
let movesUndoStack=[]; let movesRedoStack=[]; // new undo/redo stacks
function snapshotMoves(){ try{return JSON.stringify(moves);}catch{return '[]';} }
function pushMovesUndo(){ movesUndoStack.push(snapshotMoves()); if(movesUndoStack.length>50) movesUndoStack.shift(); movesRedoStack.length=0; }
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
  pushMovesUndo();
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
//     tr.querySelector('[data-act=edit]').addEventListener('click', ()=> { editingMove = m; fillMoveForm(m); });
    tr.querySelector('[data-act=del]').addEventListener('click', ()=> { if(confirm('Delete move?')) { pushMovesUndo(); moves = moves.filter(x=>x!==m); persistMoves(); renderMoves(); } });
    body.appendChild(tr);
  });
  document.getElementById('movesEmpty')?.classList.toggle('hidden', rows.length>0);
}
function fillMoveForm(m){
  const f = document.getElementById('moveForm'); if(!f) return;
  f.name.value = m.name||''; f.description.value = m.description||''; f.tags.value = (m.tags||[]).join(', '); f.image.value = m.image||''; 
}
function persistMoves(){ localStorage.setItem('movesStore', JSON.stringify(moves)); }
// Global moves undo/redo (Ctrl+Z / Ctrl+Y) outside form fields
window.addEventListener('keydown', e=> {
  if(e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA')) return;
  if(e.ctrlKey && (e.key==='z' || e.key==='Z')){ if(movesUndoStack.length){ const prev=movesUndoStack.pop(); movesRedoStack.push(snapshotMoves()); try{ moves=JSON.parse(prev)||[]; }catch{ moves=[]; } persistMoves(); renderMoves(); editingMove=null; } e.preventDefault(); }
  else if(e.ctrlKey && (e.key==='y' || e.key==='Y')){ if(movesRedoStack.length){ const next=movesRedoStack.pop(); movesUndoStack.push(snapshotMoves()); try{ moves=JSON.parse(next)||[]; }catch{ moves=[]; } persistMoves(); renderMoves(); editingMove=null; } e.preventDefault(); }
});

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
function openMpModalHost(){ const m=document.getElementById('mpModal'); if(!m) return; m.classList.remove('hidden'); preloadMpModal(); }
function openMpModalJoin(){ const m=document.getElementById('mpModal'); if(!m) return; m.classList.remove('hidden'); preloadMpModal(); }
function preloadMpModal(){ const prefs=loadMpPrefs(); const useFb=document.getElementById('mpUseFirebase'); const ta=document.getElementById('mpFirebaseConfig'); if(useFb) useFb.checked = (prefs.transport==='fb'); if(ta && prefs.fbConfig) ta.value = JSON.stringify(prefs.fbConfig); }
function startMp(asHost){
  const useFb = !!document.getElementById('mpUseFirebase')?.checked;
  const room=(document.getElementById('mpRoomCode')?.value||'').trim() || Math.random().toString(36).slice(2,8);
  const name=(document.getElementById('mpName')?.value||'').trim() || (asHost? 'GM':'Player');
  if(useFb){
    const cfgRaw=(document.getElementById('mpFirebaseConfig')?.value||'').trim();
    if(!cfgRaw){ toast('Paste Firebase config'); return; }
    let cfg=null; try{ cfg=JSON.parse(cfgRaw); }catch{ toast('Invalid Firebase config JSON'); return; }
    mp.transport='fb'; mp.fb = { config: cfg, app:null, db:null, unsub:null }; mp.room=room; mp.name=name; mp.isGM=true; mp.connected=false; saveMpPrefs(); connectFirebase(); setMpStatus('Connecting…');
    toast('Hosting on Firebase');
  } else if(server){
    // Online host as GM
    mp.transport='ws'; mp.server=server; mp.room=room; mp.name=name; mp.isGM=true; mp.connected=false; saveMpPrefs(); connectWs(); setMpStatus('Connecting…');
    toast('Hosting as GM');
  } else {
    // Fallback: local solo GM session (no relay yet)
    mp.transport='ws'; mp.server=''; mp.room=''; mp.name=name; mp.isGM=true; mp.connected=false; saveMpPrefs(); setMpStatus('Solo');
    toast('Created local table (offline). Save Relay or Firebase to go online.');
  }
  // Jump to Map view for immediate feedback
  const mapBtn=document.querySelector(".nav-btn[data-view='map']"); if(mapBtn) mapBtn.click(); else { document.querySelectorAll('.view').forEach(sec=>sec.classList.remove('active')); document.getElementById('view-map')?.classList.add('active'); }
  renderSessionBanner();
}
function copyJoinLink(){ if(!mp.room){ toast('Start a session first'); return; } const url=new URL(location.href); if(mp.transport==='fb'){ url.hash = `#join=fb|${encodeURIComponent(mp.room)}`; } else { url.hash = `#join=${encodeURIComponent(mp.server)}|${encodeURIComponent(mp.room)}`; } navigator.clipboard?.writeText(url.toString()).then(()=> toast('Join link copied')).catch(()=> toast('Copy failed'));
}
function parseJoinHash(){ try{ const h=location.hash||''; const fb=h.match(/#join=fb\|(.+)/); if(fb) return { transport:'fb', server:'', room: decodeURIComponent(fb[1]) }; const m=h.match(/#join=([^|]+)\|(.+)/); if(!m) return null; return { transport:'ws', server:decodeURIComponent(m[1]), room:decodeURIComponent(m[2])}; }catch{ return null; } }
function setMpStatus(txt){ const el=document.getElementById('mpStatus'); if(el) el.textContent = txt; renderSessionBanner(); }
function connectWs(){ if(mp.transport!=='ws') return; try{
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
// Firebase transport
function connectFirebase(){ if(mp.transport!=='fb') return; try{
    // Require compat SDKs included in index.html
    if(!window.firebase || !window.firebase.initializeApp){ toast('Firebase SDK not loaded'); return; }
    if(!mp.fb?.app){ mp.fb.app = firebase.initializeApp(mp.fb.config, 'dndex-app'); }
    mp.fb.db = firebase.database();
    // connection state
    const roomBase = `rooms/${mp.room}`;
    // presence: write this peer under /presence and auto-remove on disconnect
    const myRef = mp.fb.db.ref(`${roomBase}/presence/${mp.peerId}`);
    myRef.onDisconnect().remove();
    myRef.set({ name: mp.name, role: (mp.isGM?'gm':'player'), ts: firebase.database.ServerValue.TIMESTAMP });
    // listen to presence
    mp.fb.db.ref(`${roomBase}/presence`).on('value', snap=>{
      const val=snap.val()||{}; presence.peers.clear(); Object.entries(val).forEach(([id,p])=> presence.peers.set(id,{ name:p.name||'Player', role:p.role||'player', ts: Date.now() })); renderSessionBanner();
    });
    // ops stream: a simple append-only log under /events; write last seen key to skip own echoes
    const evRef = mp.fb.db.ref(`${roomBase}/events`);
    let inited=false; evRef.limitToLast(1000).on('child_added', s=>{
      const msg=s.val(); if(!msg || msg._from===mp.peerId) return; // skip self
      handleMpMessage(msg);
    });
    // send initial state if GM
    if(mp.isGM){ const snapshot = exportStateObj(); fbBroadcast({type:'state', data:snapshot}); }
    mp.connected = true; setMpStatus('Connected'); renderSessionBanner();
  }catch(e){ console.error(e); setMpStatus('Error'); }
}
function fbBroadcast(msg){ if(mp.transport!=='fb') return; try{ const evRef = mp.fb.db.ref(`rooms/${mp.room}/events`).push(); const payload={...msg, room: mp.room, from: mp.name, _ts: Date.now(), _from: mp.peerId }; evRef.set(payload); }catch(e){ console.warn('fbBroadcast error', e); }
}
function scheduleReconnect(){
  if(!mp.server || !mp.room) return; // not configured
  const maxDelay = 8000;
  const delay = Math.min(maxDelay, 500 * Math.pow(2, (mp._retries||0)));
  mp._retries = (mp._retries||0) + 1;
  setTimeout(()=> { if(!mp.connected){ connectWs(); } }, delay);
}
function broadcast(msg){ try{ if(mp.transport==='fb'){ if(!mp.connected) return; fbBroadcast(msg); return; } if(!mp.ws || !mp.connected) return; // tag messages to avoid echo loops
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

// ----- Token inspector inputs
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

// ---------------- Missing / Simplified Multiplayer + Landing Functions ----------------
// Note: These functions restore simplified onboarding (Create / Join / Solo) and basic realtime sync.

function initWelcomeLanding(){
  const modal=document.getElementById('welcomeModal'); if(!modal) return;
  const nameI=document.getElementById('wlName');
  const createBtn=document.getElementById('wlCreate');
  const joinBtn=document.getElementById('wlJoin');
  const soloBtn=document.getElementById('wlSolo');
  const inviteI=document.getElementById('wlInvite');
  const relayI=document.getElementById('wlServerInline');
  const relaySave=document.getElementById('wlSaveRelay');
  const fbTa=document.getElementById('wlFbConfigInline');
  const fbSave=document.getElementById('wlSaveFirebase');
  // Load prefs
  const prefs=loadMpPrefs();
  if(nameI) nameI.value = prefs.name || '';
  if(relayI) relayI.value = prefs.server || '';
  if(fbTa && prefs.fbConfig) fbTa.value = JSON.stringify(prefs.fbConfig);

  function open(){ modal.classList.remove('hidden'); }
  function close(){ modal.classList.add('hidden'); }
  // Always show on first load if not already connected
  if(!mp.connected && !sessionStorage.getItem('welcomeShown')){ open(); sessionStorage.setItem('welcomeShown','1'); }

  createBtn?.addEventListener('click', ()=>{
    const name=(nameI?.value||'').trim()||'GM';
    mp.name=name; mp.isGM=true; mp.connected=false; mp.room=genShortRoom();
    // Choose transport preference: Firebase if config present else relay if present else offline
    if(fbTa?.value.trim()){
      try{ const cfg=JSON.parse(fbTa.value.trim()); mp.transport='fb'; mp.fb={config:cfg, app:null, db:null, unsub:null}; }
      catch{ toast('Bad Firebase JSON'); return; }
    } else if(relayI?.value.trim()){
      mp.transport='ws'; mp.server=relayI.value.trim();
    } else {
      mp.transport='ws'; mp.server=''; // offline local
    }
    saveMpPrefs();
    if(mp.transport==='fb') connectFirebase(); else if(mp.server) connectWs(); else { setMpStatus('Solo'); }
    toast('Room '+mp.room);
    close();
    // Jump to map
    document.querySelector(".nav-btn[data-view='map']")?.click();
    renderSessionBanner();
  });

  joinBtn?.addEventListener('click', ()=>{
    const link=(inviteI?.value||'').trim(); if(!link){ toast('Paste invite link'); return; }
    // Accept either full URL with #join=... or raw fragment like #join=fb|room
    let hash='';
    if(link.startsWith('http')){ try{ hash=new URL(link).hash; }catch{ hash=link; } }
    else { hash = link.startsWith('#')? link : '#'+link; }
    location.hash = hash; // so parseJoinHash works
    const parsed=parseJoinHash(); if(!parsed){ toast('Invalid invite'); return; }
    const name=(nameI?.value||'').trim()||'Player';
    mp.name=name; mp.isGM=false; mp.room=parsed.room; mp.transport=parsed.transport; mp.server=parsed.server||''; mp.connected=false;
    if(parsed.transport==='fb'){
      const prefs2=loadMpPrefs(); if(prefs2.fbConfig){ mp.fb={config:prefs2.fbConfig, app:null, db:null, unsub:null}; connectFirebase(); }
      else { toast('Need Firebase config (Save in Welcome)'); return; }
    } else if(parsed.transport==='ws'){
      if(!mp.server){ toast('Invite missing relay server'); return; }
      connectWs();
    }
    saveMpPrefs();
    close();
    document.querySelector(".nav-btn[data-view='map']")?.click();
    renderSessionBanner();
  });

  soloBtn?.addEventListener('click', ()=>{
    const name=(nameI?.value||'').trim()||'GM'; mp.name=name; mp.isGM=true; mp.room=''; mp.connected=false; mp.transport='ws'; mp.server=''; saveMpPrefs(); setMpStatus('Solo'); close(); document.querySelector(".nav-btn[data-view='map']")?.click(); renderSessionBanner(); });

  relaySave?.addEventListener('click', ()=>{ const v=relayI?.value.trim(); if(!v){ toast('Enter relay URL'); return; } mp.server=v; saveMpPrefs(); toast('Relay saved'); });
  fbSave?.addEventListener('click', ()=>{ const raw=fbTa?.value.trim(); if(!raw){ toast('Enter Firebase config JSON'); return; } try{ const cfg=JSON.parse(raw); mp.fb={config:cfg, app:null, db:null, unsub:null}; mp.transport='fb'; saveMpPrefs(); toast('Firebase saved'); }catch{ toast('Invalid JSON'); } });
}

function renderSessionBanner(){
  const el=document.getElementById('sessionBanner'); if(!el) return; const parts=[];
  if(mp.room){ parts.push(`<strong>${mp.isGM? 'GM':'Player'}</strong> in <code>${mp.room}</code>`); }
  else parts.push(mp.isGM? 'Solo (GM)' : 'Offline');
  parts.push(mp.transport==='fb'? 'Firebase' : (mp.server? 'Relay' : 'Local'));
  if(mp.connected){ parts.push('<span class="good">Online</span>'); } else { parts.push('<span class="muted">Offline</span>'); }
  // Peers list
  const peerBits=[]; for(const [id,p] of presence.peers){ peerBits.push(`<span class="peer ${p.role}">${escapeHtml(p.name)}${p.view? ' <em>'+escapeHtml(p.view)+'</em>':''}</span>`); }
  if(peerBits.length) parts.push(peerBits.join(' '));
  if(mp.room){ parts.push(`<button id="sbShare" class="mini-btn">Share</button>`); }
  el.innerHTML=parts.join(' • ');
  el.querySelector('#sbShare')?.addEventListener('click', copyJoinLink);
}

function applyGmMode(){ document.body.classList.toggle('gm-mode', !!boardSettings.gmMode); document.getElementById('gmModeToggle') && (document.getElementById('gmModeToggle').checked = !!boardSettings.gmMode); }

function wireLiveCursors(){ const layer=document.getElementById('cursorLayer'); const stage=document.getElementById('mapStage'); if(!layer||!stage) return; const cursors=new Map(); function upkeep(){ const now=Date.now(); for(const [id,info] of cursors){ if(now-info.ts>4000){ info.el.remove(); cursors.delete(id); } } requestAnimationFrame(upkeep); } upkeep(); stage.addEventListener('mousemove', e=>{ if(!mp.connected) return; if(loadPref('cursors','true')==='false') return; const rect=stage.getBoundingClientRect(); const x=e.clientX-rect.left, y=e.clientY-rect.top; broadcast({type:'cursor', id:mp.peerId, x,y,name:mp.name}); }); function show(id,x,y,name){ let entry=cursors.get(id); if(!entry){ const div=document.createElement('div'); div.className='remote-cursor'; div.innerHTML=`<span class='dot'></span><label>${escapeHtml(name||'')}</label>`; layer.appendChild(div); entry={el:div,ts:Date.now()}; cursors.set(id,entry);} entry.el.style.left=x+'px'; entry.el.style.top=y+'px'; entry.ts=Date.now(); }
  wireLiveCursors._show = show; }

function handleMpMessage(msg){ if(!msg || msg.room && mp.room && msg.room!==mp.room) return; switch(msg.type){
    case 'presence': upsertPresence(msg); if(msg.view){ const p=presence.peers.get(msg.id); if(p) p.view=msg.view; } break;
    case 'state': if(!mp.isGM){ importStateObj(msg.data||{}); toast('State synced'); } break;
    case 'perm': mp.allowEdits = !!msg.allowEdits; toast('Edit '+(mp.allowEdits?'enabled':'locked')); break;
    case 'cursor': if(wireLiveCursors._show) wireLiveCursors._show(msg.id,msg.x,msg.y,msg.name); break;
    case 'op': applyRemoteOp(msg.op); break;
  }
  renderSessionBanner();
}

function applyRemoteOp(op){ if(!op||mp.isGM && op.skipGM) return; try{
    if(op.kind==='move'){ const tok=[...document.querySelectorAll('.token')].find(t=> t.dataset.id===op.id); if(tok){ tok.style.left=op.x+'px'; tok.style.top=op.y+'px'; saveTokens(); if(boardSettings.visionAuto) computeVisionAuto(); } }
    else if(op.kind==='tokenAdd'){ const layer=document.getElementById('tokenLayer'); if(layer){ const t=document.createElement('div'); t.className='token'; t.dataset.id=op.token.id; t.style.left=op.token.x+'px'; t.style.top=op.token.y+'px'; t.title=op.token.title||''; if(op.token.type) t.dataset.type=op.token.type; if(op.token.bg) t.style.backgroundImage=op.token.bg; if(op.token.hp) t.dataset.hp=op.token.hp; if(op.token.vision) t.dataset.vision=op.token.vision; layer.appendChild(t); updateTokenBadges(t); saveTokens(); if(boardSettings.visionAuto) computeVisionAuto(); } }
    else if(op.kind==='tokenUpdate'){ const tok=[...document.querySelectorAll('.token')].find(t=> t.dataset.id===op.id); if(tok){ Object.entries(op.fields||{}).forEach(([k,v])=>{ if(k==='title') tok.title=v; else if(k==='type'){ if(v) tok.dataset.type=v; else delete tok.dataset.type; } else if(k==='hp'){ if(v) tok.dataset.hp=v; else delete tok.dataset.hp; updateTokenBadges(tok); } else if(k==='vision'){ if(v) tok.dataset.vision=v; else delete tok.dataset.vision; if(boardSettings.visionAuto) computeVisionAuto(); } }); saveTokens(); } }
    else if(op.kind==='tokenDel'){ (op.ids||[]).forEach(id=> { const t=[...document.querySelectorAll('.token')].find(x=>x.dataset.id===id); if(t) t.remove(); }); saveTokens(); }
    else if(op.kind==='tokensSet'){ const layer=document.getElementById('tokenLayer'); if(layer){ layer.innerHTML=''; (op.tokens||[]).forEach(o=>{ const t=document.createElement('div'); t.className='token'; t.dataset.id=o.id; t.style.left=o.x+'px'; t.style.top=o.y+'px'; t.title=o.title||''; if(o.type) t.dataset.type=o.type; if(o.bg) t.style.backgroundImage=o.bg; if(o.hp) t.dataset.hp=o.hp; if(o.vision) t.dataset.vision=o.vision; layer.appendChild(t); updateTokenBadges(t); }); saveTokens(); if(boardSettings.visionAuto) computeVisionAuto(); } }
    else if(op.kind==='walls'){ walls=op.walls||[]; persistWalls(); drawWalls(); if(boardSettings.visionAuto) computeVisionAuto(); }
    else if(op.kind==='templates'){ templates=op.templates||[]; persistTemplates(); drawTemplates(); }
    else if(op.kind==='initAdd'){ (op.items||[]).forEach(it=> { if(!initiative.order.some(o=>o.id===it.id)) initiative.order.push(it); }); persistInitiative(); renderInitiative(); }
    else if(op.kind==='initRemove'){ initiative.order=initiative.order.filter(o=> o.id!==op.id); persistInitiative(); renderInitiative(); }
    else if(op.kind==='initCycle'){ cycleInitiative(op.dir||1); }
    else if(op.kind==='bg'){ boardSettings.bgImage=op.data; persistBoardSettings(); applyBoardBackground(); }
    else if(op.kind==='fog'){ try{ localStorage.setItem('fogData', op.data); loadFog(); }catch{} }
  }catch(e){ console.warn('applyRemoteOp', e); }
}

// Utility: escape HTML
function escapeHtml(str){ return String(str||'').replace(/[&<>"']/g, s=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s])); }

// Kick off init after DOM ready (existing code may already attach DOMContentLoaded earlier)
document.addEventListener('DOMContentLoaded', ()=> { renderSessionBanner(); });

// --------------- Missing Utility Exports / Ruler ---------------
function exportBoardState(){ try{ const data=exportStateObj(); const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.download='board-state.json'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000); toast('Board exported'); }catch(e){ console.error(e); toast('Export failed'); } }
async function importBoardState(e){ try{ const file=e.target.files?.[0]; if(!file) return; const txt=await file.text(); const json=JSON.parse(txt); importStateObj(json); toast('Board imported'); e.target.value=''; }catch(err){ console.error(err); toast('Import failed'); } }

function startRulerMode(){ const stage=document.getElementById('mapStage'); if(!stage) return; let box=document.getElementById('rulerLine'); if(!box){ box=document.createElement('div'); box.id='rulerLine'; box.style.position='absolute'; box.style.pointerEvents='none'; box.style.border='1px solid #4f8dff'; box.style.background='rgba(79,141,255,0.15)'; box.style.fontSize='11px'; box.style.color='#fff'; box.style.padding='2px 4px'; box.style.borderRadius='4px'; stage.appendChild(box);} let origin=null; const grid=+document.getElementById('gridSizeInput')?.value||50; function fmt(distPx){ const squares = distPx / grid; const feet = squares*5; return feet.toFixed(1)+' ft'; }
  function down(ev){ const rect=stage.getBoundingClientRect(); origin={x:ev.clientX-rect.left,y:ev.clientY-rect.top}; box.style.left=origin.x+'px'; box.style.top=origin.y+'px'; box.textContent='0 ft'; box.style.display='block'; document.addEventListener('mousemove',move); document.addEventListener('mouseup',up); ev.preventDefault(); }
  function move(ev){ if(!origin) return; const rect=stage.getBoundingClientRect(); const x=ev.clientX-rect.left, y=ev.clientY-rect.top; const dx=x-origin.x, dy=y-origin.y; const dist=Math.hypot(dx,dy); const left=Math.min(origin.x,x), top=Math.min(origin.y,y); box.style.left=left+'px'; box.style.top=top+'px'; box.style.width=Math.abs(dx)+'px'; box.style.height=Math.abs(dy)+'px'; box.textContent=fmt(dist); }
  function up(){ document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); setTimeout(()=>{ if(box) box.style.display='none'; }, 400); origin=null; }
  stage.addEventListener('mousedown', down, { once:true }); toast('Ruler: drag to measure (M to re-run)'); }

