// Globals (Sheet, Persist) used to keep file:// usage working without module loader.
console.log('=== UI.JS LOADING ===');

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

// Moves feature (lightweight list independent from sheet)
let moves = JSON.parse(localStorage.getItem('movesStore')||'[]');
let editingMove = null;
let movesUndoStack=[]; let movesRedoStack=[]; // new undo/redo stacks

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

// Ensure init runs on load (was missing causing nav + buttons dead)
document.addEventListener('DOMContentLoaded', ()=> { try{ init(); }catch(e){ console.error('init failed', e); } });

function sheetConfigured() {
  // Determine if a sheet URL (published CSV) is configured
  try{ const u = window.getSheetUrl && window.getSheetUrl(); return !!(u && u.includes('http')); }catch{ return false; }
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
      const target = document.querySelector('#view-' + v);
      if(target){ target.classList.add('active'); }
      if (v === 'compendium') buildCompendium();
      if (v === 'entities') {
        // Use new enhanced entities system
        if (window.entitiesSystem && window.entitiesSystem.renderEntities) {
          window.entitiesSystem.renderEntities();
        }
      }
      if (v === 'map') {
        console.log('=== MAP TAB ACTIVATED ===');
        refreshMap();
        initMapBoard(); // Initialize board when map tab is clicked
      }
      if (v === 'character') { buildCharacterSheet(); renderCharMoves(); }
      if (v === 'profile') { buildProfile(); }
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
  initCharacterImageCropping();
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
  // Rebuild character stats panel in case new headers provide stat keys
  buildCharStats();
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
  if (view === 'entities') {
    // Use new enhanced entities system
    if (window.entitiesSystem && window.entitiesSystem.renderEntities) {
      window.entitiesSystem.renderEntities();
    }
  }
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

// ===== MODERN WALL SYSTEM - POLISHED & INTUITIVE =====
let modernWallState = {
  active: false,
  isDrawing: false,
  startPoint: null,
  previewWall: null,
  hoveredWall: null
};

function enableModernWallMode() {
  console.log('🏗️ Modern wall mode enabled');
  modernWallState.active = true;
  
  const canvas = document.getElementById('wallsCanvas');
  const stage = document.getElementById('mapStage');
  console.log('Canvas found:', !!canvas, 'Stage found:', !!stage);
  
  if (!canvas || !stage) {
    console.error('❌ Missing canvas or stage elements!');
    return;
  }
  
  // Change cursor to crosshair for precision
  stage.style.cursor = 'crosshair';
  
  // Mouse down - start wall creation
  canvas.onmousedown = (e) => {
    if (e.button !== 0) return; // Only left click
    
    const rect = canvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    
    // Snap to grid for precision
    const snapped = snapToGrid(rawX, rawY);
    
    if (e.shiftKey) {
      // Shift+Click = Delete wall near cursor
      deleteWallAt(snapped.x, snapped.y);
      return;
    }
    
    // Start new wall
    modernWallState.isDrawing = true;
    modernWallState.startPoint = snapped;
    
    console.log('🎯 Wall start:', snapped);
    showWallPreview(snapped.x, snapped.y, snapped.x, snapped.y);
    
    // Prevent default to avoid canvas issues
    e.preventDefault();
  };
  
  // Mouse move - show preview and hover effects
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const snapped = snapToGrid(rawX, rawY);
    
    if (modernWallState.isDrawing && modernWallState.startPoint) {
      // Update wall preview while drawing
      showWallPreview(
        modernWallState.startPoint.x, 
        modernWallState.startPoint.y, 
        snapped.x, 
        snapped.y
      );
    } else {
      // Show hover effects on existing walls
      highlightWallAt(snapped.x, snapped.y);
    }
  };
  
  // Mouse up - finish wall creation
  canvas.onmouseup = (e) => {
    if (!modernWallState.isDrawing || !modernWallState.startPoint) return;
    
    const rect = canvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const snapped = snapToGrid(rawX, rawY);
    
    // Create wall if it's long enough
    const distance = Math.sqrt(
      Math.pow(snapped.x - modernWallState.startPoint.x, 2) + 
      Math.pow(snapped.y - modernWallState.startPoint.y, 2)
    );
    
    if (distance > 20) { // Minimum wall length
      const newWall = {
        id: 'wall_' + Date.now(),
        x1: modernWallState.startPoint.x,
        y1: modernWallState.startPoint.y,
        x2: snapped.x,
        y2: snapped.y,
        thickness: 4,
        color: '#ffffff'
      };
      
      walls.push(newWall);
      persistWalls();
      redrawWalls();
      computeVisionAuto(); // Update vision
      
      console.log('✅ Wall created:', newWall);
      toast(`🏗️ Wall created (${distance.toFixed(0)}px)`);
    } else {
      toast('❌ Wall too short - drag further');
    }
    
    // Reset state
    modernWallState.isDrawing = false;
    modernWallState.startPoint = null;
    hideWallPreview();
  };
  
  // Right click context for options
  canvas.oncontextmenu = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    showWallContextMenu(x, y, e.clientX, e.clientY);
  };
  
  console.log('✅ Modern wall system ready!');
}

function disableModernWallMode() {
  console.log('🏗️ Modern wall mode disabled');
  modernWallState.active = false;
  modernWallState.isDrawing = false;
  modernWallState.startPoint = null;
  
  const canvas = document.getElementById('wallsCanvas');
  const stage = document.getElementById('mapStage');
  
  if (canvas) {
    canvas.onmousedown = null;
    canvas.onmousemove = null;
    canvas.onmouseup = null;
    canvas.oncontextmenu = null;
  }
  
  if (stage) {
    stage.style.cursor = '';
  }
  
  hideWallPreview();
  clearWallHighlight();
}

function snapToGrid(x, y) {
  const gridSize = parseInt(document.getElementById('gridSizeInput')?.value || 50);
  const snapEnabled = document.getElementById('snapToggle')?.checked;
  
  if (!snapEnabled) return {x, y};
  
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize
  };
}

function showWallPreview(x1, y1, x2, y2) {
  const canvas = document.getElementById('wallsCanvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  // Redraw existing walls first
  redrawWalls();
  
  // Draw preview in bright color
  ctx.strokeStyle = '#00FF00'; // Bright green
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.8;
  
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  
  // Draw endpoints
  ctx.fillStyle = '#00FF00';
  ctx.beginPath();
  ctx.arc(x1, y1, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x2, y2, 6, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.globalAlpha = 1;
}

function hideWallPreview() {
  redrawWalls(); // Just redraw without preview
}

function highlightWallAt(x, y) {
  const nearestWall = findWallNear(x, y, 15);
  
  if (nearestWall !== modernWallState.hoveredWall) {
    modernWallState.hoveredWall = nearestWall;
    redrawWalls();
    
    if (nearestWall) {
      const canvas = document.getElementById('wallsCanvas');
      const ctx = canvas.getContext('2d');
      
      // Highlight the hovered wall
      ctx.strokeStyle = '#FF6B6B'; // Red highlight
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.7;
      
      ctx.beginPath();
      ctx.moveTo(nearestWall.x1, nearestWall.y1);
      ctx.lineTo(nearestWall.x2, nearestWall.y2);
      ctx.stroke();
      
      ctx.globalAlpha = 1;
      
      // Show delete hint
      document.getElementById('mapStage').style.cursor = 'pointer';
      document.getElementById('mapStage').title = 'Shift+Click to delete this wall';
    } else {
      document.getElementById('mapStage').style.cursor = 'crosshair';
      document.getElementById('mapStage').title = '';
    }
  }
}

function clearWallHighlight() {
  modernWallState.hoveredWall = null;
  document.getElementById('mapStage').style.cursor = '';
  document.getElementById('mapStage').title = '';
}

function deleteWallAt(x, y) {
  const wallToDelete = findWallNear(x, y, 15);
  
  if (wallToDelete) {
    const index = walls.indexOf(wallToDelete);
    if (index > -1) {
      walls.splice(index, 1);
      persistWalls();
      redrawWalls();
      computeVisionAuto();
      
      console.log('🗑️ Wall deleted:', wallToDelete);
      toast('🗑️ Wall deleted');
    }
  } else {
    toast('❌ No wall found to delete');
  }
}

function findWallNear(x, y, threshold = 10) {
  for (const wall of walls) {
    const distance = distanceToLineSegment(x, y, wall.x1, wall.y1, wall.x2, wall.y2);
    if (distance < threshold) {
      return wall;
    }
  }
  return null;
}

function redrawWalls() {
  const canvas = document.getElementById('wallsCanvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw all walls with modern styling
  walls.forEach(wall => {
    ctx.strokeStyle = wall.color || '#ffffff';
    ctx.lineWidth = wall.thickness || 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    
    ctx.beginPath();
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
    ctx.stroke();
  });
  
  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function showWallContextMenu(localX, localY, globalX, globalY) {
  // Simple context menu for wall options
  const menu = document.createElement('div');
  menu.style.position = 'fixed';
  menu.style.left = globalX + 'px';
  menu.style.top = globalY + 'px';
  menu.style.background = '#2c3e50';
  menu.style.color = 'white';
  menu.style.padding = '8px';
  menu.style.borderRadius = '4px';
  menu.style.zIndex = '1000';
  menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
  menu.innerHTML = `
    <div style="padding:4px 8px; cursor:pointer;" onclick="clearAllWalls()">🗑️ Clear All Walls</div>
    <div style="padding:4px 8px; cursor:pointer;" onclick="this.parentNode.remove()">❌ Cancel</div>
  `;
  
  document.body.appendChild(menu);
  
  // Auto-remove after 3 seconds
  setTimeout(() => menu.remove(), 3000);
}

function clearAllWalls() {
  if (confirm('🗑️ Delete all walls? This cannot be undone.')) {
    walls.length = 0;
    persistWalls();
    redrawWalls();
    computeVisionAuto();
    toast('🗑️ All walls cleared');
  }
  
  // Remove any context menus
  document.querySelectorAll('div[style*="position: fixed"]').forEach(el => {
    if (el.innerHTML.includes('Clear All Walls')) el.remove();
  });
}

// Update the function calls in button system
function enableSimpleWallMode() { enableModernWallMode(); }
function disableSimpleWallMode() { disableModernWallMode(); }

function enableSimpleRevealMode() {
  console.log('Simple reveal mode enabled');
  const canvas = document.getElementById('fogCanvas');
  if (!canvas) return;
  
  let drawing = false;
  
  canvas.onmousedown = (e) => {
    drawing = true;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    revealFogAt(x, y, 20);
  };
  
  canvas.onmousemove = (e) => {
    if (!drawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    revealFogAt(x, y, 20);
  };
  
  canvas.onmouseup = () => { drawing = false; };
}

function disableSimpleRevealMode() {
  console.log('Simple reveal mode disabled');
  const canvas = document.getElementById('fogCanvas');
  if (canvas) {
    canvas.onmousedown = null;
    canvas.onmousemove = null;
    canvas.onmouseup = null;
  }
}

function startSimpleRuler() {
  console.log('Simple ruler started');
  const canvas = document.getElementById('battleMap');
  if (!canvas) return;
  
  let firstPoint = null;
  
  const clickHandler = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (!firstPoint) {
      firstPoint = {x, y};
      toast('Click second point to measure');
    } else {
      const distance = Math.sqrt((x - firstPoint.x)**2 + (y - firstPoint.y)**2);
      const gridSize = parseInt(document.getElementById('gridSizeInput')?.value || 50);
      const squares = (distance / gridSize).toFixed(1);
      toast(`Distance: ${distance.toFixed(0)}px (${squares} squares)`);
      canvas.removeEventListener('click', clickHandler);
    }
  };
  
  canvas.addEventListener('click', clickHandler);
}

function createNewToken() {
  console.log('Creating new token');
  const layer = document.getElementById('tokenLayer');
  if (!layer) return;
  
  const map = document.getElementById('battleMap');
  if (!map) return;
  
  const rect = map.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  
  const token = document.createElement('div');
  token.className = 'token';
  token.style.left = centerX + 'px';
  token.style.top = centerY + 'px';
  token.style.width = '50px';
  token.style.height = '50px';
  token.style.background = '#4CAF50';
  token.style.borderRadius = '50%';
  token.style.position = 'absolute';
  token.style.border = '2px solid white';
  token.textContent = 'T';
  token.style.color = 'white';
  token.style.textAlign = 'center';
  token.style.lineHeight = '46px';
  token.style.cursor = 'move';
  token.dataset.id = 'token_' + Date.now();
  token.dataset.vision = '180'; // Give token vision radius
  token.dataset.type = 'player'; // Make it a player token
  token.title = 'Player Token';
  
  layer.appendChild(token);
  saveTokens();
  
  // Trigger vision calculation
  if (boardSettings.visionAuto) {
    computeVisionAuto();
  }
  
  toast('Token added');
}

function setupBasicSystems() {
  console.log('Setting up basic systems');
  setupFog();
  loadTokens();
  refreshMap(); // This draws the grid
  drawWalls();
  drawTemplates();
  loadFog(); // This draws the fog
  
  // Enable vision system by default
  // Initialize board settings with vision enabled
  boardSettings.visionAuto = true;
  const visionToggle = document.getElementById('visionAutoToggle');
  if (visionToggle) {
    visionToggle.checked = true;
  }
  
  // Setup token interactions
  setupTokenInteractions();
  
  console.log('Vision system enabled, computing vision...');
  computeVisionAuto();
}

// ===== TOKEN INTERACTION SETUP =====
function setupTokenInteractions() {
  const stage = document.getElementById('mapStage');
  if (!stage) return;
  
  // Add stage mouse down handler if not already set up
  stage.addEventListener('mousedown', onStageMouseDown);
  
  // Setup event delegation for tokens
  stage.addEventListener('mousedown', (e) => {
    const token = e.target.closest('.token');
    if (!token) return;
    
    console.log('Token clicked:', token);
    e.preventDefault();
    
    // Select token
    selectToken(token);
    
    // Start dragging
    dragToken(e);
  });
  
  console.log('Token interactions set up');
}

// ===== MISSING HELPER FUNCTIONS FOR SIMPLE BUTTONS =====
function startWallCreation(x, y) {
  console.log('Starting wall creation at', x, y);
  if (!wallTempPoint) {
    // First click - set start point
    wallTempPoint = {x, y};
    toast('Click second point to finish wall');
  } else {
    // Second click - create wall
    const wall = {
      x1: wallTempPoint.x,
      y1: wallTempPoint.y,
      x2: x,
      y2: y
    };
    walls.push(wall);
    persistWalls();
    drawWalls();
    wallTempPoint = null;
    toast('Wall created');
    computeVisionAuto();
  }
}

function deleteWallNear(x, y) {
  console.log('Deleting wall near', x, y);
  const threshold = 10;
  for (let i = walls.length - 1; i >= 0; i--) {
    const wall = walls[i];
    const dist = distanceToLineSegment(x, y, wall.x1, wall.y1, wall.x2, wall.y2);
    if (dist < threshold) {
      walls.splice(i, 1);
      persistWalls();
      drawWalls();
      toast('Wall deleted');
      computeVisionAuto();
      return;
    }
  }
  toast('No wall found near click');
}

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  if (lenSq === 0) return Math.sqrt(A * A + B * B);
  const t = Math.max(0, Math.min(1, dot / lenSq));
  const projX = x1 + t * C;
  const projY = y1 + t * D;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function revealFogAt(x, y, radius) {
  if (!fogCtx) return;
  // Use the existing revealAt function which handles the fog system properly
  revealAt(x, y, false);
}

// Removed duplicate fog functions - using existing fog system

// Board state management
let boardModes = { wall: false, reveal: false, ruler: false };

function initMapBoard(){
  console.log('=== SIMPLE BUTTON SETUP ===');
  
  // Wait for elements to exist
  const must=['battleMap','tokenLayer','fogCanvas','wallsCanvas'];
  let missing=must.filter(id=> !document.getElementById(id));
  if(missing.length){ 
    console.log('Missing elements:', missing);
    setTimeout(initMapBoard,50); 
    return; 
  }
  
  // ===== SIMPLE BUTTON HANDLERS - NO COMPLEX MODES =====
  
  // 1. ADD TOKEN - Simple click to add token
  const addBtn = document.getElementById('addSingleTokenBtn');
  if (addBtn) {
    addBtn.onclick = () => {
      console.log('ADD TOKEN: Creating new token');
      addBtn.style.background = '#4CAF50';
      setTimeout(() => addBtn.style.background = '', 300);
      createNewToken();
      toast('Token added - drag to move');
    };
    console.log('✓ Add Token button ready');
  }
  
  // 2. WALLS - Modern intuitive system
  const wallBtn = document.getElementById('wallModeBtn');
  if (wallBtn) {
    console.log('✓ Wall button found:', wallBtn);
    let wallActive = false;
    wallBtn.onclick = () => {
      console.log('🔥 WALL BUTTON CLICKED!');
      wallActive = !wallActive;
      wallBtn.classList.toggle('active', wallActive);
      console.log('WALLS:', wallActive ? 'ON' : 'OFF');
      
      if (wallActive) {
        wallBtn.style.background = '#FF9800';
        wallBtn.style.color = 'white';
        toast('🏗️ WALLS ON - Click & drag to create walls, Shift+click to delete');
        enableModernWallMode();
      } else {
        wallBtn.style.background = '';
        wallBtn.style.color = '';
        toast('WALLS OFF');
        disableModernWallMode();
      }
    };
    console.log('✓ Modern Walls button ready');
  } else {
    console.error('❌ Wall button NOT FOUND - wallModeBtn missing!');
  }
  
  // 3. REVEAL - Simple fog reveal
  const revealBtn = document.getElementById('fogRevealBtn');
  if (revealBtn) {
    let revealActive = false;
    revealBtn.onclick = () => {
      revealActive = !revealActive;
      revealBtn.classList.toggle('active', revealActive);
      console.log('REVEAL:', revealActive ? 'ON' : 'OFF');
      
      if (revealActive) {
        revealBtn.style.background = '#2196F3';
        toast('REVEAL ON - Click and drag to clear fog');
        enableSimpleRevealMode();
      } else {
        revealBtn.style.background = '';
        toast('REVEAL OFF');
        disableSimpleRevealMode();
      }
    };
    console.log('✓ Reveal button ready');
  }
  
  // 4. RULER - Simple distance measure
  const rulerBtn = document.getElementById('rulerBtn');
  if (rulerBtn) {
    rulerBtn.onclick = () => {
      console.log('RULER: Measuring distance');
      rulerBtn.style.background = '#9C27B0';
      setTimeout(() => rulerBtn.style.background = '', 300);
      toast('Click two points to measure distance');
      startSimpleRuler();
    };
    console.log('✓ Ruler button ready');
  }
  
  // 5. COVER ALL - Simple fog cover
  const coverBtn = document.getElementById('fogFullBtn');
  if (coverBtn) {
    coverBtn.onclick = () => {
      console.log('COVER ALL: Adding fog');
      coverBtn.style.background = '#607D8B';
      setTimeout(() => coverBtn.style.background = '', 300);
      pushFogHistory(); 
      coverFog(); // Use existing fog system
      toast('Map covered with fog');
    };
    console.log('✓ Cover All button ready');
  }
  
  // 6. CLEAR ALL - Simple fog clear
  const clearBtn = document.getElementById('fogClearBtn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      console.log('CLEAR ALL: Removing fog');
      clearBtn.style.background = '#F44336';
      setTimeout(() => clearBtn.style.background = '', 300);
      pushFogHistory(); 
      clearFog(); // Use existing fog system
      toast('All fog cleared');
    };
    console.log('✓ Clear All button ready');
  }
  
  // Setup basic systems
  setupBasicSystems();
  
  console.log('=== ALL BUTTONS WORKING ===');
}

// OLD COMPLEX MODE SYSTEM REMOVED - NOW USING SIMPLE BUTTON HANDLERS

// Board initialization will be called when map tab is activated

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
  if(!( !mp.connected || mp.isGM || mp.allowEdits )){ 
    toast('Editing disabled'); 
    return; 
  }
  
  let startX = e.clientX;
  let startY = e.clientY;
  const selected = [...document.querySelectorAll('.token.selected')];
  const moving = selected.length > 1 && selected.includes(token) ? selected : [token];
  const startPositions = moving.map(t => ({
    token: t, 
    x: parseFloat(t.style.left), 
    y: parseFloat(t.style.top)
  }));
  
  let isDragging = true;
  
  // Handle scroll wheel rotation during drag
  function handleWheel(ev) {
    if (!isDragging) return;
    ev.preventDefault();
    
    const currentDirection = parseFloat(token.dataset.direction || '0');
    const rotationStep = 0.2; // Smooth rotation
    const newDirection = currentDirection + (ev.deltaY > 0 ? rotationStep : -rotationStep);
    
    // Normalize to 0-2π range
    let normalizedDirection = newDirection;
    while (normalizedDirection < 0) normalizedDirection += Math.PI * 2;
    while (normalizedDirection >= Math.PI * 2) normalizedDirection -= Math.PI * 2;
    
    updateTokenDirection(token, normalizedDirection);
  }
  
  function handleMove(ev) {
    const deltaX = ev.clientX - startX;
    const deltaY = ev.clientY - startY;
    
    startPositions.forEach(pos => {
      pos.token.style.left = (pos.x + deltaX) + 'px';
      pos.token.style.top = (pos.y + deltaY) + 'px';
    });
    
    // Update vision in real-time while dragging
    if(boardSettings.visionAuto) computeVisionAuto();
  }
  
  function handleMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('wheel', handleWheel);
    
    // Snap to grid if enabled
    const snap = document.getElementById('snapToggle')?.checked;
    const gridSize = +document.getElementById('gridSizeInput')?.value || 50;
    
    if(snap) {
      moving.forEach(t => {
        const x = parseFloat(t.style.left);
        const y = parseFloat(t.style.top);
        const snapX = Math.round(x / gridSize) * gridSize;
        const snapY = Math.round(y / gridSize) * gridSize;
        t.style.left = snapX + 'px';
        t.style.top = snapY + 'px';
      });
    }
    
    saveTokens();
    if(boardSettings.visionAuto) computeVisionAuto();
    
    // Broadcast position updates for multiplayer
    moving.forEach(t => {
      if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) {
        broadcast({
          type: 'op', 
          op: {
            kind: 'move', 
            id: (t.dataset.id || ''), 
            x: parseFloat(t.style.left), 
            y: parseFloat(t.style.top),
            direction: parseFloat(t.dataset.direction || '0')
          }
        });
      }
    });
  }
  
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('wheel', handleWheel, { passive: false });
}

function tokenHitsWall(tok){ const x=parseFloat(tok.style.left), y=parseFloat(tok.style.top); const r=30; return walls.some(w=> distPointToSeg(x,y,w.x1,w.y1,w.x2,w.y2) < r); }
function findSlidePosition(x,y,range){ const dirs=[[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]; for(let d=8; d<=range; d+=8){ for(const v of dirs){ const nx=x+v[0]*d, ny=y+v[1]*d; if(!walls.some(w=> distPointToSeg(nx,ny,w.x1,w.y1,w.x2,w.y2) < 30)) return {x:nx,y:ny}; } } return null; }
function distPointToSeg(px,py,x1,y1,x2,y2){ 
  const A=px-x1, B=py-y1, C=x2-x1, D=y2-y1; 
  const dot=A*C+B*D; 
  const len_sq=C*C+D*D; 
  let t = len_sq ? dot/len_sq : 0; 
  t=Math.max(0,Math.min(1,t)); 
  const xx=x1+t*C, yy=y1+t*D; 
  const dx=px-xx, dy=py-yy; 
  return Math.sqrt(dx*dx+dy*dy); 
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
  console.log('Creating new token...');
  const layer = document.getElementById('tokenLayer'); 
  if(!layer) { 
    console.error('tokenLayer not found!'); 
    return; 
  }
  
  // Check permissions
  const canEdit = !mp.connected || mp.isGM || mp.allowEdits;
  if(!canEdit){ 
    toast('Editing disabled'); 
    return; 
  }
  
  const name = prompt('Token name:','') || 'Token';
  
  // Create the token element
  const token = document.createElement('div');
  token.className = 'token';
  
  // Use grid-aligned center positioning (map center)
  const mapContainer = document.getElementById('mapContainer');
  const centerX = mapContainer ? mapContainer.offsetWidth / 2 : 400;
  const centerY = mapContainer ? mapContainer.offsetHeight / 2 : 300;
  
  // Apply grid snapping if enabled
  const snapped = snapPoint(centerX, centerY);
  
  // Set position to center point (CSS transform will center the token on this point)
  token.style.left = snapped.x + 'px';
  token.style.top = snapped.y + 'px';
  
  // Don't override CSS - let the CSS handle size and centering
  token.title = name;
  token.dataset.id = uid();
  token.dataset.vision = '180';
  // No direction indicator - removed triangle
  
  layer.appendChild(token);
  
  saveTokens();
  if(boardSettings.visionAuto) computeVisionAuto();
  
  console.log('Token created successfully:', name);
  toast('Token added: ' + name);
}

function updateTokenDirection(token, direction) {
  const indicator = token.querySelector('.direction-indicator');
  if (indicator) {
    const degrees = direction * 180 / Math.PI;
    indicator.style.transform = `translateX(-50%) rotate(${degrees}deg)`;
  }
  
  // Update the dataset
  token.dataset.direction = direction.toString();
  
  // Refresh vision if auto-vision is enabled
  if(boardSettings.visionAuto) {
    computeVisionAuto();
  }
}

function saveTokens(){
  const layer = document.getElementById('tokenLayer'); if(!layer) return;
  const tokens=[...layer.querySelectorAll('.token')].map(t=>({
    id:t.dataset.id||uid(),
    x:parseFloat(t.style.left),
    y:parseFloat(t.style.top),
    title:t.title,
    type:t.dataset.type||'',
    bg:t.style.backgroundImage||'',
    hp:t.dataset.hp||'',
    vision:t.dataset.vision||'',
    direction:t.dataset.direction||'0'
  }));
  try { localStorage.setItem('mapTokens', JSON.stringify(tokens)); } catch{}
}
function loadTokens(){
  try { 
    const raw = localStorage.getItem('mapTokens'); 
    if(!raw) return; 
    const arr = JSON.parse(raw); 
    const layer = document.getElementById('tokenLayer'); 
    if(!layer) return; 
    layer.innerHTML = ''; 
    
    arr.forEach(tokenData => { 
      const token = document.createElement('div'); 
      token.className = 'token'; 
      token.dataset.id = tokenData.id || uid(); 
      token.style.left = tokenData.x + 'px'; 
      token.style.top = tokenData.y + 'px'; 
      token.title = tokenData.title || 'Token'; 
      
      if(tokenData.type) token.dataset.type = tokenData.type; 
      if(tokenData.bg) token.style.backgroundImage = tokenData.bg; 
      if(tokenData.hp) token.dataset.hp = tokenData.hp; 
      if(tokenData.vision) token.dataset.vision = tokenData.vision; 
      
      // Set direction (default to 0 if not specified) - but no triangle indicator
      if (tokenData.direction) {
        token.dataset.direction = tokenData.direction.toString();
      }
      
      // No direction indicator created - triangle removed
      
      layer.appendChild(token); 
      
      updateTokenBadges(token);
    }); 
    
    if(boardSettings.visionAuto) computeVisionAuto(); 
  } catch(e) {
    console.error('Error loading tokens:', e);
  }
}

// Ensure tokens have stable IDs for multiplayer references
function ensureTokenIds(){ 
  const layer = document.getElementById('tokenLayer'); 
  if(!layer) return; 
  let changed = false; 
  [...layer.querySelectorAll('.token')].forEach(t => { 
    if(!t.dataset.id){ 
      t.dataset.id = uid(); 
      changed = true; 
    } 
  }); 
  if(changed) saveTokens(); 
}

let fogCtx, fogMode='none';
function setupFog(){
  const canvas = document.getElementById('fogCanvas'); if(!canvas) return;
  fogCtx = canvas.getContext('2d');
  console.log('Setting up fog canvas:', canvas.width, 'x', canvas.height);
  
  // Make fog canvas interactive during reveal mode
  canvas.addEventListener('mousedown', e=> { 
    if(!boardModes.reveal) return;
    if(!( !mp.connected || mp.isGM || mp.allowEdits )) return; 
    console.log('Fog reveal started at:', e.offsetX, e.offsetY);
    pushFogHistory(); 
    revealAt(e.offsetX,e.offsetY,true); 
    const mv=ev=> { revealAt(ev.offsetX,ev.offsetY,false); }; 
    const up=()=>{
      document.removeEventListener('mousemove',mv);
      document.removeEventListener('mouseup',up);
      if(boardSettings.visionAuto) computeVisionAuto();
      console.log('Fog reveal ended');
    }; 
    document.addEventListener('mousemove',mv); 
    document.addEventListener('mouseup',up);
  });
  
  loadFog(); // load existing base; vision layer computed below
  if(boardSettings.visionAuto) computeVisionAuto();
}
function coverFog(){ 
  console.log('coverFog called, fogCtx:', !!fogCtx);
  if(!fogCtx) { 
    console.error('fogCtx not initialized!'); 
    return; 
  } 
  fogCtx.globalCompositeOperation='source-over'; 
  fogCtx.fillStyle='rgba(0,0,0,0.85)'; 
  fogCtx.fillRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); 
  saveFogBase(); 
  console.log('Fog covered');
}

function clearFog(){ 
  console.log('clearFog called, fogCtx:', !!fogCtx);
  if(!fogCtx) { 
    console.error('fogCtx not initialized!'); 
    return; 
  } 
  fogCtx.globalCompositeOperation='source-over'; 
  fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); 
  saveFogBase(); 
  console.log('Fog cleared');
}
function revealAt(x,y,start){ if(!fogCtx) return; const r = +document.getElementById('fogBrushSize')?.value||90; const shape = document.getElementById('fogBrushShape')?.value||'circle'; fogCtx.globalCompositeOperation='destination-out'; if(shape==='rect'){ const w=r, h=r; fogCtx.fillRect(x-w/2,y-h/2,w,h); } else { fogCtx.beginPath(); fogCtx.arc(x,y,r,0,Math.PI*2); fogCtx.fill(); } if(!start) { saveFogBaseDebounced(); } }
// Persistent base fog (manual reveals) separate from dynamic vision
function saveFogBase(){ if(!fogCtx) return; try{ localStorage.setItem('fogBaseData', fogCtx.canvas.toDataURL()); }catch{} }
let _fogSaveT=null; function saveFogBaseDebounced(){ clearTimeout(_fogSaveT); _fogSaveT=setTimeout(()=>{ saveFogBase(); if(boardSettings.visionAuto) computeVisionAuto(); }, 140); }
function loadFog(){ try { const keyData = localStorage.getItem('fogBaseData') || localStorage.getItem('fogData'); if(!keyData||!fogCtx) { coverFog(); saveFogBase(); return; } const img=new Image(); img.onload=()=> { fogCtx.globalCompositeOperation='source-over'; fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); fogCtx.drawImage(img,0,0); if(boardSettings.visionAuto) computeVisionAuto(); }; img.src=keyData; } catch { coverFog(); saveFogBase(); } }
// Legacy wrappers (no‑ops now) kept for compatibility
function saveFog() { /* dynamic vision no longer persisted; base handled via saveFogBase */ }

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
function pushFogHistory(){ if(!fogCtx) return; try{ fogHistory.push(fogCtx.canvas.toDataURL()); if(fogHistory.length>24) fogHistory.shift(); }catch{} }
function undoFogStep(){ if(!fogCtx || !fogHistory.length) return; const last=fogHistory.pop(); if(!last) return; const img=new Image(); img.onload=()=>{ fogCtx.globalCompositeOperation='source-over'; fogCtx.clearRect(0,0,fogCtx.canvas.width,fogCtx.canvas.height); fogCtx.drawImage(img,0,0); saveFogBase(); if(boardSettings.visionAuto) computeVisionAuto(); }; img.src=last; }
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

document.addEventListener('DOMContentLoaded', () => { wireHelp(); wireAdvancedMap(); wireCharacterPage(); });

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
  // Buttons - Note: Board buttons now handled in initMapBoard() with simple system
  document.getElementById('visionToggleBtn')?.addEventListener('click', () => { boardSettings.visionAuto = !boardSettings.visionAuto; persistBoardSettings(); computeVisionAuto(); });
  // Old rulerBtn listener removed - now handled in initMapBoard()
  document.getElementById('addCircleTemplateBtn')?.addEventListener('click', ()=> addTemplate('circle'));
  document.getElementById('addConeTemplateBtn')?.addEventListener('click', ()=> addTemplate('cone'));
  document.getElementById('addLineTemplateBtn')?.addEventListener('click', ()=> addTemplate('line'));
  
  // Clear buttons for More panel
  document.getElementById('clearWallsBtn')?.addEventListener('click', ()=> { 
    if(confirm('Delete all walls?')){ 
      walls=[]; 
      persistWalls(); 
      drawWalls(); 
      toast('Walls cleared'); 
      computeVisionAuto(); 
    } 
  });
  document.getElementById('clearTemplatesBtn')?.addEventListener('click', ()=> { 
    if(confirm('Delete all templates?')){ 
      templates=[]; 
      persistTemplates(); 
      drawTemplates(); 
      toast('Templates cleared'); 
    } 
  });
  
  document.getElementById('bgImageBtn')?.addEventListener('click', () => document.getElementById('bgImageInput').click());
  document.getElementById('bgImageInput')?.addEventListener('change', handleBgUpload);
  document.getElementById('exportBoardBtn')?.addEventListener('click', exportBoardState);
  document.getElementById('importBoardBtn')?.addEventListener('click', ()=> document.getElementById('importBoardInput').click());
  document.getElementById('importBoardInput')?.addEventListener('change', importBoardState);
  document.getElementById('fogUndoBtn')?.addEventListener('click', undoFogStep);
  const gmBtn=document.getElementById('gmModeBtn');
  if(gmBtn){
    gmBtn.addEventListener('click', ()=> {
      if(!mp.isGM){ toast('GM only'); return; }
      boardSettings.gmMode = !boardSettings.gmMode;
      persistBoardSettings();
      applyGmMode();
    });
  }
  document.getElementById('exportImageBtn')?.addEventListener('click', exportPngSnapshot);
  document.getElementById('visionRefreshBtn')?.addEventListener('click', ()=> computeVisionAuto());
  // Cursors toggle only (others removed for simplicity)
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
  // Old keyboard shortcut for ruler removed - buttons work simply now
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

// ---------------- Scenes Management ----------------
let _scenes=[]; const SCENES_KEY='mapScenesV1';
function loadScenes(){ try{ const raw=localStorage.getItem(SCENES_KEY); if(raw) _scenes=JSON.parse(raw)||[]; }catch{ _scenes=[]; } }
function saveScenes(){ try{ localStorage.setItem(SCENES_KEY, JSON.stringify(_scenes)); }catch{} }
function wireScenes(){ loadScenes(); refreshSceneSelect(); const sel=document.getElementById('sceneSelect'); const saveBtn=document.getElementById('sceneSaveBtn'); const loadBtn=document.getElementById('sceneLoadBtn'); const manageBtn=document.getElementById('sceneManageBtn'); const panel=document.getElementById('scenePanel'); const list=document.getElementById('sceneList'); const closeBtn=document.getElementById('scenePanelClose'); const delAll=document.getElementById('sceneDeleteAllBtn');
  saveBtn?.addEventListener('click', ()=>{ const name=prompt('Scene name:', (sel?.selectedOptions[0]?.textContent)||('Scene '+(_scenes.length+1))); if(!name) return; const snap=exportStateObj(); const existing=_scenes.find(s=> s.name===name); if(existing){ existing.data=snap; toast('Scene updated'); } else { _scenes.push({id:uid(), name, data:snap}); toast('Scene saved'); } saveScenes(); refreshSceneSelect(); renderSceneList(); });
  loadBtn?.addEventListener('click', ()=>{ const id=sel?.value; const scene=_scenes.find(s=> s.id===id); if(scene){ importStateObj(scene.data); toast('Scene loaded'); } else toast('Select a scene'); });
  manageBtn?.addEventListener('click', ()=>{ renderSceneList(); panel?.classList.remove('hidden'); });
  closeBtn?.addEventListener('click', ()=> panel?.classList.add('hidden'));
  delAll?.addEventListener('click', ()=>{ if(!confirm('Delete ALL scenes?')) return; _scenes=[]; saveScenes(); refreshSceneSelect(); renderSceneList(); });
  function renderSceneList(){ if(!list) return; list.innerHTML=''; _scenes.forEach(s=>{ const li=document.createElement('li'); li.innerHTML=`<strong>${escapeHtml(s.name)}</strong> <button data-a='load'>Load</button> <button data-a='rename'>Ren</button> <button data-a='del' class='danger'>Del</button>`; li.querySelectorAll('button').forEach(b=> b.addEventListener('click', ev=>{ const act=b.dataset.a; if(act==='load'){ importStateObj(s.data); toast('Scene loaded'); } else if(act==='del'){ if(confirm('Delete scene '+s.name+'?')){ _scenes=_scenes.filter(x=>x!==s); saveScenes(); refreshSceneSelect(); renderSceneList(); } } else if(act==='rename'){ const nn=prompt('New name:', s.name); if(nn){ s.name=nn; saveScenes(); refreshSceneSelect(); renderSceneList(); } } })); list.appendChild(li); }); if(!_scenes.length) list.innerHTML='<li class="muted">No scenes yet.</li>'; }
  function refreshSceneSelect(){ const sel=document.getElementById('sceneSelect'); if(!sel) return; sel.innerHTML=_scenes.map(s=>`<option value='${s.id}'>${escapeHtml(s.name)}</option>`).join(''); }
}

// Fallback copy helper (if not already defined globally)
if(typeof window.copyText !== 'function'){
  window.copyText = async function(txt){
    if(navigator.clipboard && window.isSecureContext){ try{ await navigator.clipboard.writeText(txt); return true; }catch{} }
    const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch{} document.body.removeChild(ta); return true;
  }
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
  tryUpdateHostCodeDisplay(room, true);
}

// --- Tab presence highlight (broadcast active view) ---
let lastViewBroadcast=0;
function broadcastActiveView(){ if(!mp.connected) return; const now=performance.now(); if(now-lastViewBroadcast<1500) return; lastViewBroadcast=now; const view=document.querySelector('.nav-btn.active')?.dataset.view||''; broadcast({type:'presence', id:mp.peerId, name:mp.name, role:(mp.isGM?'gm':'player'), view}); }
setInterval(()=> broadcastActiveView(), 2000);

// ---------------- Character Page ----------------
const CHAR_KEY='charProfileV2';
let charProfile = { 
  name:'', class:'', level: 1, race:'', background:'', 
  abilities: {str:10, dex:10, con:10, int:10, wis:10, cha:10},
  combat: {ac:10, hp:0, maxHP:0, speed:'30 ft', profBonus:2},
  saves: {str:false, dex:false, con:false, int:false, wis:false, cha:false},
  skills: {},
  features:'', backstory:'',
  inv:{weapons:'', armor:'', other:''}, 
  moves:[], img:null,
  characterMode: 'standard',
  augurio: {
    atk:0, def:0, dem:0, vel:0, vid:0, pre:0, eva:0, pas:0,
    sue:0, fza:0, con:0, int:0, sag:0, agi:0, crm:0, dst:0,
    vit:0, etk:0, eac:0, est:0, esp:0,
    hands:'', equip:'', store:''
  }
};

const D5E_SKILLS = [
  {name: 'Acrobatics', ability: 'dex'}, {name: 'Animal Handling', ability: 'wis'}, {name: 'Arcana', ability: 'int'},
  {name: 'Athletics', ability: 'str'}, {name: 'Deception', ability: 'cha'}, {name: 'History', ability: 'int'},
  {name: 'Insight', ability: 'wis'}, {name: 'Intimidation', ability: 'cha'}, {name: 'Investigation', ability: 'int'},
  {name: 'Medicine', ability: 'wis'}, {name: 'Nature', ability: 'int'}, {name: 'Perception', ability: 'wis'},
  {name: 'Performance', ability: 'cha'}, {name: 'Persuasion', ability: 'cha'}, {name: 'Religion', ability: 'int'},
  {name: 'Sleight of Hand', ability: 'dex'}, {name: 'Stealth', ability: 'dex'}, {name: 'Survival', ability: 'wis'}
];

function getAbilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

function getProficiencyBonus(level) {
  return Math.ceil(level / 4) + 1;
}

function loadChar(){ 
  try{ 
    const raw=localStorage.getItem(CHAR_KEY); 
    if(raw){ 
      const p=JSON.parse(raw); 
      if(p&&typeof p==='object') {
        charProfile={...charProfile, ...p};
        
        // Restore character mode if saved
        if (p.characterMode) {
          characterMode = p.characterMode;
          localStorage.setItem('characterMode', characterMode);
        }
      }
    } 
  }catch{} 
}

let savingChar = false;

function saveChar(){ 
  // Prevent infinite recursion
  if (savingChar) {
    console.warn('saveChar already in progress, skipping');
    return;
  }
  
  savingChar = true;
  
  try{
    // Save current mode data first
    saveCharWithMode();
    
    console.log('Saving character:', charProfile);
    
    // Ensure we have a character profile to save
    if (!charProfile) {
      console.error('No character profile to save');
      toast('Error: No character data to save');
      return;
    }
    
    // Save to localStorage (traditional save)
    localStorage.setItem(CHAR_KEY, JSON.stringify(charProfile)); 
    
    // Also save to profile system if user has a profile
    if (profileData) {
      const characterData = {
        ...charProfile,
        id: charProfile.id || 'char_' + Date.now(),
        profileId: profileData.id,
        lastModified: new Date().toISOString()
      };
      
      // Find existing character or add new one
      const existingIndex = allCharacters.findIndex(c => c.id === characterData.id || c.name === characterData.name);
      
      if (existingIndex >= 0) {
        allCharacters[existingIndex] = characterData;
      } else {
        allCharacters.push(characterData);
      }
      
      localStorage.setItem('allCharacters', JSON.stringify(allCharacters));
    }
    
    // Verify the save worked
    const saved = localStorage.getItem(CHAR_KEY);
    if (saved) {
      console.log('Character saved successfully');
      toast('Character saved successfully!');
      
      // Refresh profile view if active
      if (document.getElementById('view-profile').classList.contains('active')) {
        renderCharactersList();
      }
    } else {
      throw new Error('Save verification failed');
    }
  } catch(error) {
    console.error('Error saving character:', error);
    toast('Error saving character: ' + error.message);
  } finally {
    savingChar = false;
  }
}

function exportCharacter() {
  const dataStr = JSON.stringify(charProfile, null, 2);
  const blob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${charProfile.name || 'character'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Character exported!');
}

function wireCharacterPage(){ 
  loadChar(); 
  buildCharacterSheet(); 
  bindCharInputs(); 
  renderCharMoves(); 
}

function buildCharacterSheet(){
  // Initialize skills if not present
  if (!charProfile.skills || Object.keys(charProfile.skills).length === 0) {
    charProfile.skills = {};
    D5E_SKILLS.forEach(skill => {
      charProfile.skills[skill.name] = false;
    });
  }
  
  // Update proficiency bonus based on level
  charProfile.combat.profBonus = getProficiencyBonus(charProfile.level);
  
  updateAbilityModifiers();
  updateSkillsList();
  updateSavingThrows();
  
  // Update proficiency bonus display
  const profBonusInput = document.getElementById('charProfBonus');
  if (profBonusInput) profBonusInput.value = charProfile.combat.profBonus;
}

function updateAbilityModifiers() {
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  abilities.forEach(ability => {
    const modifier = getAbilityModifier(charProfile.abilities[ability]);
    const modEl = document.getElementById(`${ability}Mod`);
    if (modEl) {
      modEl.textContent = modifier >= 0 ? `+${modifier}` : `${modifier}`;
    }
  });
}

function updateSavingThrows() {
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  abilities.forEach(ability => {
    const modifier = getAbilityModifier(charProfile.abilities[ability]);
    const proficient = charProfile.saves[ability];
    const saveBonus = modifier + (proficient ? charProfile.combat.profBonus : 0);
    const saveEl = document.getElementById(`${ability}Save`);
    if (saveEl) {
      saveEl.textContent = saveBonus >= 0 ? `+${saveBonus}` : `${saveBonus}`;
    }
  });
}

function updateSkillsList() {
  const skillsList = document.getElementById('skillsList');
  if (!skillsList) return;
  
  skillsList.innerHTML = '';
  D5E_SKILLS.forEach(skill => {
    const abilityMod = getAbilityModifier(charProfile.abilities[skill.ability]);
    const proficient = charProfile.skills[skill.name] || false;
    const skillBonus = abilityMod + (proficient ? charProfile.combat.profBonus : 0);
    
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="checkbox" data-skill="${skill.name}" ${proficient ? 'checked' : ''}> 
      ${skill.name} (${skill.ability.toUpperCase()}) 
      <span>${skillBonus >= 0 ? '+' : ''}${skillBonus}</span>
    `;
    
    const checkbox = label.querySelector('input');
    checkbox.addEventListener('change', () => {
      charProfile.skills[skill.name] = checkbox.checked;
      updateSkillsList();
      saveChar();
    });
    
    skillsList.appendChild(label);
  });
}

function bindCharInputs(){
  // Basic info
  const inputs = [
    {id: 'charName', prop: 'name'},
    {id: 'charClass', prop: 'class'},
    {id: 'charRace', prop: 'race'},
    {id: 'charBackground', prop: 'background'},
    {id: 'charFeatures', prop: 'features'},
    {id: 'charBackstory', prop: 'backstory'}
  ];
  
  inputs.forEach(({id, prop}) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = charProfile[prop] || '';
      el.addEventListener('input', () => {
        charProfile[prop] = el.value;
        saveChar();
      });
    }
  });
  
  // Level
  const levelEl = document.getElementById('charLevel');
  if (levelEl) {
    levelEl.value = charProfile.level;
    levelEl.addEventListener('input', () => {
      charProfile.level = parseInt(levelEl.value) || 1;
      charProfile.combat.profBonus = getProficiencyBonus(charProfile.level);
      buildCharacterSheet();
      saveChar();
    });
  }
  
  // Abilities
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  abilities.forEach(ability => {
    const el = document.getElementById(`char${ability.charAt(0).toUpperCase() + ability.slice(1)}`);
    if (el) {
      el.value = charProfile.abilities[ability];
      el.addEventListener('input', () => {
        charProfile.abilities[ability] = parseInt(el.value) || 10;
        updateAbilityModifiers();
        updateSavingThrows();
        updateSkillsList();
        saveChar();
      });
    }
  });
  
  // Combat stats
  const combatInputs = [
    {id: 'charAC', prop: 'ac'},
    {id: 'charHP', prop: 'hp'},
    {id: 'charMaxHP', prop: 'maxHP'},
    {id: 'charSpeed', prop: 'speed'}
  ];
  
  combatInputs.forEach(({id, prop}) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = charProfile.combat[prop];
      el.addEventListener('input', () => {
        charProfile.combat[prop] = ['ac', 'hp', 'maxHP'].includes(prop) ? 
          parseInt(el.value) || 0 : el.value;
        saveChar();
      });
    }
  });
  
  // Saving throws
  abilities.forEach(ability => {
    const el = document.getElementById(`${ability}SaveProf`);
    if (el) {
      el.checked = charProfile.saves[ability];
      el.addEventListener('change', () => {
        charProfile.saves[ability] = el.checked;
        updateSavingThrows();
        saveChar();
      });
    }
  });
  
  // Inventory
  const invInputs = [
    {id: 'invWeapons', prop: 'weapons'},
    {id: 'invArmor', prop: 'armor'},
    {id: 'invOther', prop: 'other'}
  ];
  
  invInputs.forEach(({id, prop}) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = charProfile.inv[prop] || '';
      el.addEventListener('input', () => {
        charProfile.inv[prop] = el.value;
        saveChar();
      });
    }
  });
  
  // Image handling
  const imgWrap = document.getElementById('charImgWrap');
  const imgInput = document.getElementById('charImgInput');
  if (imgWrap && imgInput) {
    imgWrap.addEventListener('click', () => imgInput.click());
    imgInput.addEventListener('change', async ev => {
      const file = ev.target.files?.[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        charProfile.img = rd.result;
        saveChar();
        applyCharImage();
      };
      rd.readAsDataURL(file);
    });
    applyCharImage();
  }
  
  // Character Mode Switcher
  setupCharacterModes();
  
  // Action buttons
  const saveBtn = document.getElementById('saveCharacterBtn');
  const saveToProfileBtn = document.getElementById('saveToProfileBtn');
  const exportBtn = document.getElementById('exportCharacterBtn');
  
  if (saveBtn) {
    console.log('Save button found, adding event listener');
    saveBtn.addEventListener('click', (e) => {
      console.log('Save button clicked!');
      e.preventDefault();
      saveChar();
    });
  } else {
    console.error('Save character button not found!');
  }
  
  if (saveToProfileBtn) {
    saveToProfileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!profileData) {
        toast('Please create a profile first');
        document.querySelector('.nav-btn[data-view="profile"]').click();
        return;
      }
      saveCharacterToProfile();
    });
  }
  
  if (exportBtn) {
    exportBtn.addEventListener('click', exportCharacter);
  }
  
  // Setup Augurio mode auto-save listeners
  setupAugurioAutoSave();
  
  // Move/spell functionality
  const filt = document.getElementById('charMoveFilter');
  const add = document.getElementById('charMoveAdd');
  const sug = document.getElementById('charMoveSuggestions');
  if (filt) filt.addEventListener('input', () => renderCharMoves());
  if (add) {
    add.addEventListener('input', () => buildMoveSuggestions(add.value.trim(), sug));
    add.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        quickAddMove(add.value.trim());
      }
    });
  }
}
function applyCharImage(){ const imgEl=document.getElementById('charImg'); const ph=document.getElementById('charImgPh'); if(!imgEl||!ph) return; if(charProfile.img){ imgEl.src=charProfile.img; imgEl.classList.remove('hidden'); ph.classList.add('hidden'); } else { imgEl.classList.add('hidden'); ph.classList.remove('hidden'); } }
function buildMoveSuggestions(term, container){ if(!container) return; if(!term){ container.classList.add('hidden'); container.innerHTML=''; return; } term=term.toLowerCase(); const matches=(moves||[]).filter(m=> m.name.toLowerCase().includes(term) && !charProfile.moves.includes(m.name)).slice(0,10); if(!matches.length){ container.classList.add('hidden'); container.innerHTML=''; return; } container.innerHTML=''; matches.forEach(m=>{ const b=document.createElement('button'); b.textContent=m.name; b.addEventListener('click', ()=>{ quickAddMove(m.name); container.classList.add('hidden'); document.getElementById('charMoveAdd').value=''; }); container.appendChild(b); }); container.classList.remove('hidden'); }
function quickAddMove(name){ if(!name) return; const mv=(moves||[]).find(m=> m.name.toLowerCase()===name.toLowerCase()); if(!mv){ toast('Move not found'); return; } if(charProfile.moves.includes(mv.name)){ toast('Already added'); return; } charProfile.moves.push(mv.name); saveChar(); renderCharMoves(); toast('Move added'); }
function removeCharMove(name){ charProfile.moves=charProfile.moves.filter(n=> n!==name); saveChar(); renderCharMoves(); }
function renderCharMoves(){ const list=document.getElementById('charMovesList'); if(!list) return; const filt=(document.getElementById('charMoveFilter')?.value||'').toLowerCase(); list.innerHTML=''; const assigned=charProfile.moves.map(n=> (moves||[]).find(m=> m.name===n)).filter(Boolean).filter(m=> !filt || m.name.toLowerCase().includes(filt) || (m.tags||[]).some(t=>t.toLowerCase().includes(filt))); if(!assigned.length){ list.innerHTML='<div class="muted">No moves assigned.</div>'; return; } assigned.forEach(m=>{ const card=document.createElement('div'); card.className='char-move'; card.innerHTML=`<button class='remove-move' title='Remove'>&times;</button><h3>${escapeHtml(m.name)}</h3><div class='desc small'>${escapeHtml(m.description||'')}</div><div class='tags'>${(m.tags||[]).map(t=>`<span class='tag'>${escapeHtml(t)}</span>`).join('')}</div>`; card.querySelector('.remove-move').addEventListener('click', ()=> removeCharMove(m.name)); list.appendChild(card); }); }

// ----- Walls -----
let wallMode = false, wallTempPoint=null;
let revealMode = false, rulerMode = false;
let wallOverlayEl=null, wallPreviewEl=null, wallEditIndex=-1, wallDragHandle=null, wallEditing=false;
function ensureWallOverlay(){
  const stage=document.getElementById('mapStage'); if(!stage) return;
  if(!wallOverlayEl){ wallOverlayEl=document.createElement('div'); wallOverlayEl.id='wallOverlay'; wallOverlayEl.className='wall-overlay hidden'; stage.appendChild(wallOverlayEl); }
  if(!wallPreviewEl){ wallPreviewEl=document.createElement('div'); wallPreviewEl.id='wallPreview'; wallPreviewEl.className='wall-preview hidden'; stage.appendChild(wallPreviewEl); }
}
// OLD toggleWallMode function removed - now using simple button handlers
function showWallHint(msg){ if(!wallOverlayEl) return; let hint=wallOverlayEl.querySelector('.wall-hint'); if(!hint){ hint=document.createElement('div'); hint.className='wall-hint'; wallOverlayEl.appendChild(hint);} hint.textContent=msg; }
function hideWallPreview(){ if(wallPreviewEl) wallPreviewEl.classList.add('hidden'); }
function snapPoint(x,y){ const grid=+document.getElementById('gridSizeInput')?.value||50; const snap=document.getElementById('snapToggle')?.checked; return snap? {x:Math.round(x/grid)*grid, y:Math.round(y/grid)*grid} : {x,y}; }
function angleSnap(x1,y1,x2,y2){ // Snap to 45 deg if Shift
  const dx=x2-x1, dy=y2-y1; const ang=Math.atan2(dy,dx); const step=Math.PI/4; const snapAng=Math.round(ang/step)*step; const len=Math.sqrt(dx*dx+dy*dy); return {x2:x1+Math.cos(snapAng)*len, y2:y1+Math.sin(snapAng)*len}; }
function clearWallSelection(){ wallEditIndex=-1; document.getElementById('wallsCanvas')?.classList.remove('editing'); const existing=document.querySelectorAll('.wall-handle'); existing.forEach(e=>e.remove()); }
function selectWall(idx){ clearWallSelection(); if(idx<0||idx>=walls.length) return; wallEditIndex=idx; const w=walls[idx]; const stage=document.getElementById('mapStage'); if(!stage) return; const mk=(x,y,cls)=>{ const h=document.createElement('div'); h.className='wall-handle '+cls; h.style.left=(x-5)+'px'; h.style.top=(y-5)+'px'; h.dataset.kind=cls; h.addEventListener('mousedown', startWallHandleDrag); stage.appendChild(h);}; mk(w.x1,w.y1,'start'); mk(w.x2,w.y2,'end'); showWallHint('Dragging endpoints. Delete: Alt+Click wall. Esc: exit edit.');
}
// Find nearest wall segment to (x,y) within maxDist (pixels); returns index or -1
function findNearestWall(x,y,maxDist){
  let best=-1, bestD = (typeof maxDist==='number'? maxDist : 10)+1;
  for(let i=0;i<walls.length;i++){
    const w=walls[i];
    const d = typeof distPointToSeg==='function' ? distPointToSeg(x,y,w.x1,w.y1,w.x2,w.y2) : Infinity;
    if(d<bestD){ bestD=d; best=i; }
  }
  return bestD <= (typeof maxDist==='number'? maxDist : 10) ? best : -1;
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
    if(e.altKey){ 
      const idx = nearest; 
      if(idx>-1){ 
        walls.splice(idx,1); 
        persistWalls(); 
        drawWalls(); 
        computeVisionAuto(); // Update vision after wall deletion
        if(!mp.silent && mp.connected && (mp.isGM || mp.allowEdits)) broadcast({type:'op', op:{kind:'walls', walls}}); 
        toast('Wall deleted'); 
        clearWallSelection(); 
      } else {
        toast('No wall found to delete');
      }
      return; 
    }
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
// Updated drawWalls to use modern system
function drawWalls() { 
  redrawWalls(); // Use the new modern wall rendering
}
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

// ----- Vision System (Rebuilt from scratch) -----
let visionDebounce = null;

function computeVisionAuto() {
  if (!boardSettings.visionAuto || !fogCtx) return;
  
  const base = localStorage.getItem('fogBaseData');
  if (base) {
    const img = new Image();
    img.onload = () => {
      fogCtx.globalCompositeOperation = 'source-over';
      fogCtx.clearRect(0, 0, fogCtx.canvas.width, fogCtx.canvas.height);
      fogCtx.drawImage(img, 0, 0);
      applyTokenVision();
    };
    img.src = base;
  } else {
    coverFog();
    applyTokenVision();
  }
}

function applyTokenVision() {
  const tokens = document.querySelectorAll('.token');
  if (!tokens.length) return;
  
  fogCtx.globalCompositeOperation = 'destination-out';
  
  tokens.forEach(token => {
    // Token position is already centered due to CSS transform
    const x = parseFloat(token.style.left);
    const y = parseFloat(token.style.top);
    const radius = parseInt(token.dataset.vision || '180');
    const direction = parseFloat(token.dataset.direction || '0'); // Radians
    const fovAngle = Math.PI / 3; // 60 degrees
    
    // If there are walls, use line-of-sight calculation
    if (walls.length > 0) {
      // Create vision polygon using line-of-sight
      const losPoints = computeLOS(x, y, radius);
      
      // Filter points to vision cone
      const startAngle = direction - fovAngle / 2;
      const endAngle = direction + fovAngle / 2;
      
      const conePoints = [];
      conePoints.push({x, y}); // Start at token center
      
      for (let point of losPoints) {
        const dx = point.x - x;
        const dy = point.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist <= radius) {
          let angle = Math.atan2(dy, dx);
          
          // Normalize angle to 0-2π
          while (angle < 0) angle += Math.PI * 2;
          while (angle >= Math.PI * 2) angle -= Math.PI * 2;
          
          // Check if point is within FOV cone
          let normalizedStart = startAngle;
          let normalizedEnd = endAngle;
          
          // Handle angle wrapping
          while (normalizedStart < 0) normalizedStart += Math.PI * 2;
          while (normalizedStart >= Math.PI * 2) normalizedStart -= Math.PI * 2;
          while (normalizedEnd < 0) normalizedEnd += Math.PI * 2;
          while (normalizedEnd >= Math.PI * 2) normalizedEnd -= Math.PI * 2;
          
          let withinCone = false;
          if (normalizedStart <= normalizedEnd) {
            withinCone = angle >= normalizedStart && angle <= normalizedEnd;
          } else {
            // Cone wraps around 0°
            withinCone = angle >= normalizedStart || angle <= normalizedEnd;
          }
          
          if (withinCone) {
            conePoints.push(point);
          }
        }
      }
      
      // Add cone edges if no walls block them
      const edgePoints = [];
      for (let i = 0; i <= 10; i++) {
        const angle = startAngle + (endAngle - startAngle) * (i / 10);
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        edgePoints.push({x: px, y: py});
      }
      
      // Add edge points that aren't blocked
      for (let edgePoint of edgePoints) {
        const rayHit = castRay(x, y, Math.atan2(edgePoint.y - y, edgePoint.x - x), radius, walls);
        conePoints.push(rayHit);
      }
      
      // Draw the vision polygon
      if (conePoints.length > 2) {
        drawPoly(fogCtx, conePoints, true);
      }
    } else {
      // No walls - use simple triangular cone
      const startAngle = direction - fovAngle / 2;
      const endAngle = direction + fovAngle / 2;
      
      fogCtx.beginPath();
      fogCtx.moveTo(x, y); // Start at token center
      
      // Draw the vision cone arc
      for (let i = 0; i <= 20; i++) {
        const angle = startAngle + (endAngle - startAngle) * (i / 20);
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        fogCtx.lineTo(px, py);
      }
      
      fogCtx.closePath();
      fogCtx.fill();
    }
  });
  
  fogCtx.globalCompositeOperation = 'source-over';
}

function revealVisionForToken(token) {
  // This function is kept for compatibility but vision is handled in applyTokenVision
  console.log('revealVisionForToken called - redirecting to applyTokenVision');
}
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

// Moves feature (lightweight list independent from sheet)
function snapshotMoves(){ try{return JSON.stringify(moves);}catch{return '[]';} }
function pushMovesUndo(){ movesUndoStack.push(snapshotMoves()); if(movesUndoStack.length>50) movesUndoStack.shift(); movesRedoStack.length=0; }
function wireMoves(){
  const addBtn = document.getElementById('addMoveBtn');
  if(!addBtn) return; // view not present
  addBtn.addEventListener('click', saveMoveFromForm);
  document.getElementById('resetMoveBtn').addEventListener('click', ()=> { editingMove=null; document.getElementById('moveForm').reset(); });
  document.getElementById('moveSearch').addEventListener('input', renderMoves);
  document.getElementById('categoryFilter')?.addEventListener('change', renderMoves);
  document.getElementById('exportMovesBtn').addEventListener('click', exportMovesExcel);
  document.getElementById('importMovesBtn').addEventListener('click', ()=> document.getElementById('importMovesInput').click());
  document.getElementById('importMovesInput').addEventListener('change', importMovesExcel);
  
  // Image upload functionality
  const imageFile = document.querySelector('input[name="imageFile"]');
  if (imageFile) {
    imageFile.addEventListener('change', handleImageUpload);
  }
  
  const removeImageBtn = document.getElementById('removeImage');
  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', removeImagePreview);
  }
  
  renderMoves();
}

function exportMovesExcel() {
  try {
    const data = moves.map(move => ({
      Name: move.name || '',
      Description: move.description || '',
      Tags: (move.tags || []).join(', '),
      Notes: move.notes || ''
    }));
    
    if (data.length === 0) {
      toast('No moves to export');
      return;
    }
    
    // Simple CSV export
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'moves.csv';
    a.click();
    URL.revokeObjectURL(url);
    
    toast('Moves exported to CSV');
  } catch (error) {
    console.error('Export error:', error);
    toast('Export failed');
  }
}

function importMovesExcel(event) {
  try {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
          toast('No data found in file');
          return;
        }
        
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const imported = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
          const move = {};
          headers.forEach((header, index) => {
            if (header.toLowerCase() === 'name') move.name = values[index] || '';
            else if (header.toLowerCase() === 'description') move.description = values[index] || '';
            else if (header.toLowerCase() === 'tags') move.tags = values[index] ? values[index].split(',').map(t => t.trim()) : [];
            else if (header.toLowerCase() === 'notes') move.notes = values[index] || '';
          });
          
          if (move.name) {
            move.id = uid();
            imported.push(move);
          }
        }
        
        if (imported.length > 0) {
          pushMovesUndo();
          moves.push(...imported);
          persistMoves();
          renderMoves();
          toast(`Imported ${imported.length} moves`);
        } else {
          toast('No valid moves found in file');
        }
      } catch (error) {
        console.error('Import error:', error);
        toast('Import failed - invalid file format');
      }
    };
    reader.readAsText(file);
  } catch (error) {
    console.error('Import error:', error);
    toast('Import failed');
  }
}
function saveMoveFromForm(){
  const form = document.getElementById('moveForm');
  if (!form) {
    toast('Form not found');
    return;
  }
  
  const data = Object.fromEntries([...form.querySelectorAll('input,textarea,select')].map(i=>[i.name,i.value.trim()]));
  if(!data.name){ 
    toast('Move name is required'); 
    return; 
  }
  
  // Handle image data from file upload
  if (form.dataset.imageData) {
    data.image = form.dataset.imageData;
  }
  
  // Remove the imageFile field since we store the data
  delete data.imageFile;
  
  // Improve description formatting with line breaks
  if (data.description) {
    data.description = data.description.replace(/\n/g, '<br>');
  }
  
  data.tags = data.tags? data.tags.split(/[,;]+/).map(t=>t.trim()).filter(Boolean):[];
  
  // Ensure unique ID for new moves
  if (!editingMove) {
    data.id = uid();
  }
  
  pushMovesUndo();
  if(editingMove){ 
    Object.assign(editingMove,data); 
    toast('Move updated');
  } else { 
    moves.push(data);
    toast('Move added');
  }
  editingMove = null;
  persistMoves();
  renderMoves();
  form.reset();
  removeImagePreview();
}

function renderMoves(){
  const body = document.querySelector('#movesTable tbody'); if(!body) return;
  const term = (document.getElementById('moveSearch')?.value||'').toLowerCase();
  const categoryFilter = document.getElementById('categoryFilter')?.value || '';
  
  const rows = moves.filter(m=> {
    const matchesSearch = !term || 
      m.name.toLowerCase().includes(term) || 
      (m.description||'').toLowerCase().includes(term) ||
      (m.category||'').toLowerCase().includes(term) ||
      (m.tags||[]).some(t=>t.toLowerCase().includes(term));
    
    const matchesCategory = !categoryFilter || (m.category === categoryFilter);
    
    return matchesSearch && matchesCategory;
  });
  
  body.innerHTML='';
  rows.forEach(m=> {
    const tr=document.createElement('tr');
    
    // Category badge
    const categoryBadge = m.category ? 
      `<span class="category-badge category-${m.category}">${m.category}</span>` : 
      '<span class="category-badge category-other">none</span>';
    
    // Damage/Range column
    const damageRange = [m.damage, m.range].filter(Boolean).join(' • ') || '—';
    
    // Handle line breaks in description for better formatting
    const formattedDesc = (m.description || '').replace(/<br>/g, '\n');
    
    tr.innerHTML = `
      <td><strong>${escapeHtml(m.name)}</strong></td>
      <td>${categoryBadge}</td>
      <td style="white-space: pre-wrap; max-width: 300px;">${escapeHtml(formattedDesc)}</td>
      <td><small style="color: var(--text-dim);">${escapeHtml(damageRange)}</small></td>
      <td>${(m.tags||[]).map(t=>`<span class='tag'>${escapeHtml(t)}</span>`).join('')}</td>
      <td>
        <button class='mini-btn' data-act='edit'>Edit</button>
        <button class='mini-btn danger' data-act='del'>Delete</button>
      </td>
    `;
    
    tr.querySelector('[data-act=edit]').addEventListener('click', ()=> { editingMove = m; fillMoveForm(m); });
    tr.querySelector('[data-act=del]').addEventListener('click', ()=> { 
      if(confirm(`Delete "${m.name}"?`)) { 
        pushMovesUndo(); 
        moves = moves.filter(x=>x!==m); 
        persistMoves(); 
        renderMoves(); 
        toast('Move deleted'); 
      } 
    });
    body.appendChild(tr);
  });
  
  document.getElementById('movesEmpty')?.classList.toggle('hidden', rows.length>0);
}

// Image Upload and Cropping Functions
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    toast('Please select an image file');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const imageData = e.target.result;
    showImagePreview(imageData);
    
    // Store the image data in the form
    const form = document.getElementById('moveForm');
    if (form) {
      form.dataset.imageData = imageData;
    }
  };
  reader.readAsDataURL(file);
}

function showImagePreview(imageData) {
  const container = document.getElementById('imagePreviewContainer');
  const preview = document.getElementById('imagePreview');
  
  if (container && preview) {
    preview.src = imageData;
    container.classList.remove('hidden');
  }
}

function removeImagePreview() {
  const container = document.getElementById('imagePreviewContainer');
  const preview = document.getElementById('imagePreview');
  const fileInput = document.querySelector('input[name="imageFile"]');
  const form = document.getElementById('moveForm');
  
  if (container) container.classList.add('hidden');
  if (preview) preview.src = '';
  if (fileInput) fileInput.value = '';
  if (form) delete form.dataset.imageData;
}

// Character Image Cropping Functions
// Global cropping variables
let currentCropData = null;
let isDragging = false;
let currentHandle = null;
let lastMousePos = { x: 0, y: 0 };
let dragStartPos = { x: 0, y: 0 };
let initialCropData = null;

function initCharacterImageCropping() {
  const charImgWrap = document.getElementById('charImgWrap');
  const charImgInput = document.getElementById('charImgInput');
  const contextMenu = document.getElementById('imageContextMenu');
  
  if (charImgWrap && charImgInput) {
    // Left click - upload new image if no image exists
    charImgWrap.addEventListener('click', (e) => {
      const charImg = document.getElementById('charImg');
      if (!charImg || charImg.classList.contains('hidden') || !charImg.src) {
        charImgInput.click();
      }
    });
    
    // Right click - show context menu if image exists
    charImgWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const charImg = document.getElementById('charImg');
      
      if (charImg && !charImg.classList.contains('hidden') && charImg.src) {
        showContextMenu(e.clientX, e.clientY);
      } else {
        charImgInput.click();
      }
    });
    
    charImgInput.addEventListener('change', handleCharacterImageUpload);
  }
  
  // Hide context menu when clicking elsewhere
  document.addEventListener('click', hideContextMenu);
  
  // Initialize crop modal controls
  const cropCancel = document.getElementById('cropCancel');
  const cropApply = document.getElementById('cropApply');
  
  if (cropCancel) cropCancel.addEventListener('click', closeCropModal);
  if (cropApply) cropApply.addEventListener('click', applyCrop);
}

function showContextMenu(x, y) {
  const contextMenu = document.getElementById('imageContextMenu');
  if (contextMenu) {
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
  }
}

function hideContextMenu() {
  const contextMenu = document.getElementById('imageContextMenu');
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }
}

function changeCharacterImage() {
  hideContextMenu();
  const charImgInput = document.getElementById('charImgInput');
  if (charImgInput) {
    charImgInput.click();
  }
}

function resizeCharacterImage() {
  hideContextMenu();
  const charImg = document.getElementById('charImg');
  if (charImg && charImg.src) {
    openCropModal(charImg.src);
  }
}

function deleteCharacterImage() {
  hideContextMenu();
  const charImg = document.getElementById('charImg');
  const charImgPh = document.getElementById('charImgPh');
  
  if (charImg && charImgPh) {
    charImg.src = '';
    charImg.classList.add('hidden');
    charImgPh.classList.remove('hidden');
    
    // Clear from character profile
    if (typeof charProfile !== 'undefined') {
      charProfile.img = '';
      saveChar();
    }
    
    toast('Character image removed');
  }
}

function handleCharacterImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    toast('Please select an image file');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    openCropModal(e.target.result);
  };
  reader.readAsDataURL(file);
}

function openCropModal(imageData) {
  console.log('Opening crop modal with smooth cropping system');
  
  const modal = document.getElementById('imageCropperModal');
  const cropImage = document.getElementById('cropImage');
  const cropOverlay = document.getElementById('cropOverlay');
  
  if (!modal || !cropImage || !cropOverlay) {
    console.error('Missing crop modal elements');
    return;
  }
  
  cropImage.src = imageData;
  modal.classList.remove('hidden');
  
  // Setup smooth dragging system
  setupSmoothCropping();
  
  // Initialize crop area with smooth animation
  setTimeout(() => {
    const container = cropImage.parentElement;
    const imgRect = cropImage.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Calculate initial crop size and position
    const size = Math.min(imgRect.width, imgRect.height) * 0.7;
    const x = (imgRect.width - size) / 2;
    const y = (imgRect.height - size) / 2;
    
    currentCropData = { 
      x, y, 
      width: size, 
      height: size, 
      imageData,
      imageRect: {
        width: imgRect.width,
        height: imgRect.height,
        left: imgRect.left - containerRect.left,
        top: imgRect.top - containerRect.top
      }
    };
    
    updateCropOverlay();
    updateCropPreview();
  }, 150);
}

function setupSmoothCropping() {
  const overlay = document.getElementById('cropOverlay');
  const handles = overlay.querySelectorAll('.crop-handle');
  
  // Setup overlay dragging
  overlay.addEventListener('mousedown', startDragOverlay);
  
  // Setup handle dragging
  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => startDragHandle(e, handle));
  });
  
  // Global mouse events for smooth dragging
  document.addEventListener('mousemove', onSmoothDrag);
  document.addEventListener('mouseup', endSmoothDrag);
  
  // Prevent text selection during drag
  document.addEventListener('selectstart', preventSelection);
}

function startDragOverlay(e) {
  if (e.target.classList.contains('crop-handle')) return;
  
  e.preventDefault();
  isDragging = true;
  currentHandle = null;
  
  const overlay = document.getElementById('cropOverlay');
  overlay.classList.add('dragging');
  
  const overlayRect = overlay.getBoundingClientRect();
  dragStartPos = {
    x: e.clientX - overlayRect.left,
    y: e.clientY - overlayRect.top
  };
  
  lastMousePos = { x: e.clientX, y: e.clientY };
}

function startDragHandle(e, handle) {
  e.preventDefault();
  e.stopPropagation();
  
  isDragging = true;
  currentHandle = handle.classList[1]; // Get direction class
  
  handle.classList.add('dragging');
  
  initialCropData = { ...currentCropData };
  lastMousePos = { x: e.clientX, y: e.clientY };
  dragStartPos = { x: e.clientX, y: e.clientY };
}

function onSmoothDrag(e) {
  if (!isDragging || !currentCropData) return;
  
  e.preventDefault();
  
  const deltaX = e.clientX - lastMousePos.x;
  const deltaY = e.clientY - lastMousePos.y;
  
  if (currentHandle) {
    // Handle resizing with smooth constraints
    resizeCropArea(deltaX, deltaY);
  } else {
    // Handle moving with smooth boundaries
    moveCropArea(deltaX, deltaY);
  }
  
  lastMousePos = { x: e.clientX, y: e.clientY };
  updateCropOverlay();
  updateCropPreview();
}

function resizeCropArea(deltaX, deltaY) {
  const minSize = 50;
  const maxSize = Math.min(currentCropData.imageRect.width, currentCropData.imageRect.height);
  
  let { x, y, width, height } = currentCropData;
  
  switch (currentHandle) {
    case 'nw':
      const newWidth1 = width - deltaX;
      const newHeight1 = height - deltaY;
      if (newWidth1 >= minSize && x + deltaX >= 0) {
        width = newWidth1;
        x += deltaX;
      }
      if (newHeight1 >= minSize && y + deltaY >= 0) {
        height = newHeight1;
        y += deltaY;
      }
      // Keep square
      const size1 = Math.min(width, height);
      width = height = size1;
      break;
      
    case 'ne':
      const newWidth2 = width + deltaX;
      const newHeight2 = height - deltaY;
      if (newWidth2 >= minSize && x + newWidth2 <= currentCropData.imageRect.width) {
        width = newWidth2;
      }
      if (newHeight2 >= minSize && y + deltaY >= 0) {
        height = newHeight2;
        y += deltaY;
      }
      const size2 = Math.min(width, height);
      width = height = size2;
      break;
      
    case 'sw':
      const newWidth3 = width - deltaX;
      const newHeight3 = height + deltaY;
      if (newWidth3 >= minSize && x + deltaX >= 0) {
        width = newWidth3;
        x += deltaX;
      }
      if (newHeight3 >= minSize && y + newHeight3 <= currentCropData.imageRect.height) {
        height = newHeight3;
      }
      const size3 = Math.min(width, height);
      width = height = size3;
      break;
      
    case 'se':
      const newWidth4 = width + deltaX;
      const newHeight4 = height + deltaY;
      if (newWidth4 >= minSize && x + newWidth4 <= currentCropData.imageRect.width) {
        width = newWidth4;
      }
      if (newHeight4 >= minSize && y + newHeight4 <= currentCropData.imageRect.height) {
        height = newHeight4;
      }
      const size4 = Math.min(width, height);
      width = height = size4;
      break;
      
    case 'n':
      const newHeight5 = height - deltaY;
      if (newHeight5 >= minSize && y + deltaY >= 0) {
        height = newHeight5;
        y += deltaY;
      }
      break;
      
    case 's':
      const newHeight6 = height + deltaY;
      if (newHeight6 >= minSize && y + newHeight6 <= currentCropData.imageRect.height) {
        height = newHeight6;
      }
      break;
      
    case 'w':
      const newWidth7 = width - deltaX;
      if (newWidth7 >= minSize && x + deltaX >= 0) {
        width = newWidth7;
        x += deltaX;
      }
      break;
      
    case 'e':
      const newWidth8 = width + deltaX;
      if (newWidth8 >= minSize && x + newWidth8 <= currentCropData.imageRect.width) {
        width = newWidth8;
      }
      break;
  }
  
  // Ensure crop stays within image bounds
  x = Math.max(0, Math.min(x, currentCropData.imageRect.width - width));
  y = Math.max(0, Math.min(y, currentCropData.imageRect.height - height));
  
  currentCropData = { ...currentCropData, x, y, width, height };
}

function moveCropArea(deltaX, deltaY) {
  let newX = currentCropData.x + deltaX;
  let newY = currentCropData.y + deltaY;
  
  // Smooth boundary constraints
  newX = Math.max(0, Math.min(newX, currentCropData.imageRect.width - currentCropData.width));
  newY = Math.max(0, Math.min(newY, currentCropData.imageRect.height - currentCropData.height));
  
  currentCropData = { ...currentCropData, x: newX, y: newY };
}

function endSmoothDrag() {
  if (!isDragging) return;
  
  isDragging = false;
  
  // Remove visual drag states
  const overlay = document.getElementById('cropOverlay');
  const handles = overlay.querySelectorAll('.crop-handle');
  
  overlay.classList.remove('dragging');
  handles.forEach(handle => handle.classList.remove('dragging'));
  
  currentHandle = null;
  initialCropData = null;
}

function preventSelection(e) {
  if (isDragging) e.preventDefault();
}

function updateCropOverlay() {
  const cropOverlay = document.getElementById('cropOverlay');
  if (!cropOverlay || !currentCropData) return;
  
  // Smooth position updates
  cropOverlay.style.left = currentCropData.x + 'px';
  cropOverlay.style.top = currentCropData.y + 'px';
  cropOverlay.style.width = currentCropData.width + 'px';
  cropOverlay.style.height = currentCropData.height + 'px';
}

function closeCropModal() {
  const modal = document.getElementById('imageCropperModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // Clean up all event listeners
  document.removeEventListener('mousemove', onSmoothDrag);
  document.removeEventListener('mouseup', endSmoothDrag);
  document.removeEventListener('selectstart', preventSelection);
  
  // Reset states
  currentCropData = null;
  isDragging = false;
  currentHandle = null;
  lastMousePos = { x: 0, y: 0 };
  dragStartPos = { x: 0, y: 0 };
  initialCropData = null;
}

function updateCropPreview() {
  if (!currentCropData) return;
  
  const preview = document.getElementById('cropPreviewImg');
  if (!preview) return;
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    const cropImage = document.getElementById('cropImage');
    
    // Calculate scale factors between displayed image and actual image
    const scaleX = img.naturalWidth / cropImage.offsetWidth;
    const scaleY = img.naturalHeight / cropImage.offsetHeight;
    
    // Convert crop coordinates to actual image space
    const actualCropX = currentCropData.x * scaleX;
    const actualCropY = currentCropData.y * scaleY;
    const actualCropWidth = currentCropData.width * scaleX;
    const actualCropHeight = currentCropData.height * scaleY;
    
    // Set preview canvas size
    canvas.width = 80;
    canvas.height = 80;
    
    // Draw the cropped portion scaled to preview size
    ctx.drawImage(
      img,
      actualCropX,
      actualCropY,
      actualCropWidth,
      actualCropHeight,
      0,
      0,
      80,
      80
    );
    
    preview.src = canvas.toDataURL('image/jpeg', 0.9);
  };
  
  img.src = currentCropData.imageData;
}

function applyCrop() {
  if (!currentCropData) return;
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    const cropImage = document.getElementById('cropImage');
    
    // Calculate the actual displayed size of the image
    const displayedWidth = cropImage.offsetWidth;
    const displayedHeight = cropImage.offsetHeight;
    
    // Calculate scale factors between displayed image and actual image
    const scaleX = img.naturalWidth / displayedWidth;
    const scaleY = img.naturalHeight / displayedHeight;
    
    // Convert crop coordinates from displayed image space to actual image space
    const actualCropX = currentCropData.x * scaleX;
    const actualCropY = currentCropData.y * scaleY;
    const actualCropWidth = currentCropData.width * scaleX;
    const actualCropHeight = currentCropData.height * scaleY;
    
    // Set canvas size to desired output size (square for profile picture)
    const outputSize = 200;
    canvas.width = outputSize;
    canvas.height = outputSize;
    
    // Draw the cropped portion, scaling it to fit the output size
    ctx.drawImage(
      img,
      actualCropX,
      actualCropY,
      actualCropWidth,
      actualCropHeight,
      0,
      0,
      outputSize,
      outputSize
    );
    
    const croppedImageData = canvas.toDataURL('image/jpeg', 0.9);
    setCharacterImage(croppedImageData);
    closeCropModal();
  };
  
  img.src = currentCropData.imageData;
}

function setCharacterImage(imageData) {
  const charImg = document.getElementById('charImg');
  const charImgPh = document.getElementById('charImgPh');
  
  if (charImg && charImgPh) {
    charImg.src = imageData;
    charImg.classList.remove('hidden');
    charImgPh.classList.add('hidden');
    
    // Store in character profile
    if (typeof charProfile !== 'undefined') {
      charProfile.img = imageData;
      saveChar();
    }
    
    toast('Character image updated');
  }
}

function fillMoveForm(m){
  const f = document.getElementById('moveForm'); if(!f) return;
  f.name.value = m.name||''; 
  f.category.value = m.category||'';
  // Convert <br> back to newlines for editing
  f.description.value = (m.description||'').replace(/<br>/g, '\n'); 
  f.damage.value = m.damage||'';
  f.range.value = m.range||'';
  f.tags.value = (m.tags||[]).join(', '); 
  f.image.value = m.image||''; 
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

// ---------------- Missing Table / Upload / Editing Helpers ----------------
function wireUpload(){ if(!els.uploadBtn || !els.fileInput) return; els.uploadBtn.addEventListener('click', ()=> els.fileInput.click()); els.fileInput.addEventListener('change', async e=>{ const file=e.target.files?.[0]; if(!file) return; try{ const name=file.name.toLowerCase(); const t0=performance.now(); if(name.endsWith('.csv')){ const text=await file.text(); const rows=parseCsv(text); const headers=rows.shift()||[]; const objects=rows.map(r=> Object.fromEntries(headers.map((h,i)=>[h,r[i]||'']))); state.headers=headers; state.objects=objects; state.filtered=[...objects]; state.numericCols=[]; } else if(/\.xlsx?$/.test(name)){ const data=new Uint8Array(await file.arrayBuffer()); const wb=XLSX.read(data,{type:'array'}); const sheetName=wb.SheetNames[0]; const sheet=wb.Sheets[sheetName]; const json=XLSX.utils.sheet_to_json(sheet,{header:1}); const headers=json.shift()||[]; const objects=json.map(r=> Object.fromEntries(headers.map((h,i)=>[h,r[i]||'']))); state.headers=headers; state.objects=objects; state.filtered=[...objects]; } else { toast('Unsupported file'); return; } buildTable(); buildColumnFilter(); applyFilters(); Persist.saveCache(state); toast('Loaded '+state.objects.length+' rows'); console.log('Upload parse ms', (performance.now()-t0)|0); }catch(err){ console.error(err); toast('Load failed'); } finally { e.target.value=''; } }); }
function wireSample(){ 
  if(!els.sampleBtn) return; 
  els.sampleBtn.addEventListener('click', ()=>{
    if(state.objects.length && !confirm('Replace current data with sample?')) return; 
    state.headers=['Name','Type','HP','AC','Description','Image']; 
    state.objects=[
      {Name:'Goblin',Type:'Enemy',HP:'7',AC:'15',Description:'Small, nimble humanoid with darkvision',Image:'https://www.dndbeyond.com/avatars/thumbnails/0/351/1000/1000/636252777818652432.jpeg'}, 
      {Name:'Cleric',Type:'Player',HP:'22',AC:'18',Description:'Divine spellcaster with healing abilities',Image:'https://www.dndbeyond.com/avatars/thumbnails/6/371/420/618/636272701936746707.png'}, 
      {Name:'Healing Potion',Type:'Item',HP:'',AC:'',Description:'Restores 2d4+2 hit points when consumed',Image:'https://www.dndbeyond.com/avatars/thumbnails/7/269/1000/1000/636284740371444255.jpeg'},
      {Name:'Orc Warrior',Type:'Enemy',HP:'15',AC:'13',Description:'Fierce tribal warrior with battle axe',Image:'https://www.dndbeyond.com/avatars/thumbnails/0/301/1000/1000/636252771691385727.jpeg'},
      {Name:'Wizard',Type:'Player',HP:'18',AC:'12',Description:'Arcane spellcaster with extensive spell knowledge',Image:'https://www.dndbeyond.com/avatars/thumbnails/6/357/420/618/636271993374462837.png'},
      {Name:'Longsword',Type:'Item',HP:'',AC:'',Description:'Versatile martial weapon, 1d8 slashing damage',Image:'https://www.dndbeyond.com/avatars/thumbnails/7/301/1000/1000/636284753267863871.jpeg'},
      {Name:'Dragon Wyrmling',Type:'Enemy',HP:'58',AC:'17',Description:'Young dragon with breath weapon and flight',Image:'https://www.dndbeyond.com/avatars/thumbnails/0/439/1000/1000/636252784654804190.jpeg'},
      {Name:'Rogue',Type:'Player',HP:'20',AC:'14',Description:'Stealthy combatant with sneak attack',Image:'https://www.dndbeyond.com/avatars/thumbnails/6/384/420/618/636272820319276620.png'}
    ]; 
    state.filtered=[...state.objects]; 
    buildTable(); 
    buildColumnFilter(); 
    applyFilters(); 
    Persist.saveCache(state); 
    toast('Sample D&D entities inserted'); 
  }); 
}
function wireEditing(){ const save=document.getElementById('saveRowBtn'); const del=document.getElementById('deleteRowBtn'); if(save){ save.addEventListener('click', saveCurrentEdit); } if(del){ del.addEventListener('click', deleteCurrentEdit); } }
let _editingRow=null; function openEditor(obj){ const modal=document.getElementById('editorModal'); const form=document.getElementById('editForm'); if(!modal||!form) return; _editingRow=obj; form.innerHTML=''; state.headers.forEach(h=>{ const wrap=document.createElement('label'); wrap.textContent=h; const inp=document.createElement('input'); inp.value=obj[h]||''; inp.dataset.field=h; wrap.appendChild(inp); form.appendChild(wrap); }); modal.classList.remove('hidden'); }
function saveCurrentEdit(){ if(!_editingRow) return; const form=document.getElementById('editForm'); [...form.querySelectorAll('input')].forEach(inp=>{ _editingRow[inp.dataset.field]=inp.value; }); Persist.saveCache(state); applyFilters(); // ensure entities gallery updates if active
  const active=document.querySelector('.nav-btn.active')?.dataset.view; if(active==='entities' || active==='compendium'){ try{ buildCompendium(); }catch{} }
  document.getElementById('editorModal').classList.add('hidden'); _editingRow=null; }
function deleteCurrentEdit(){ if(!_editingRow) return; state.objects=state.objects.filter(o=> o!==_editingRow); _editingRow=null; Persist.saveCache(state); applyFilters(); document.getElementById('editorModal').classList.add('hidden'); }
function wireCompendiumSearch(){ const comp=document.getElementById('compSearch'); if(!comp) return; comp.addEventListener('input', ()=> applyFilters()); }
function wireNewEntry(){ const btn=document.getElementById('newEntryBtn'); if(!btn) return; btn.addEventListener('click', ()=>{
  if(!state.headers.length){
    const cols = prompt('Enter column names (comma separated):','Name,Type,HP,Notes');
    if(!cols) return;
    state.headers = cols.split(/[,;]+/).map(c=>c.trim()).filter(Boolean);
    if(!state.headers.length){ toast('No columns'); return; }
    buildTable(); buildColumnFilter(); applyFilters();
  }
  const row=Object.fromEntries(state.headers.map(h=>[h,'']));
  state.objects.push(row); state.filtered=[...state.objects];
  Persist.saveCache(state);
  const active=document.querySelector('.nav-btn.active')?.dataset.view; if(active==='entities' || active==='compendium'){ try{ buildCompendium(); }catch{} }
  openEditor(row);
}); }

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
function copyJoinLink(){ if(!mp.room){ toast('Start a session first'); return; } navigator.clipboard?.writeText(mp.room).then(()=> toast('Code copied')).catch(()=> toast('Copy failed')); }
function parseJoinHash(){ try{ const h=location.hash||''; const fb=h.match(/#join=fb\|([^&]+)/); if(fb) return { transport:'fb', server:'', room: decodeURIComponent(fb[1]) }; const m=h.match(/#join=([^|#&]+)/); if(m) return { transport:(mp.transport||'ws'), server: (mp.server||''), room: decodeURIComponent(m[1]) }; return null; }catch{ return null; } }
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
  console.log('=== INIT WELCOME LANDING ===');
  const modal=document.getElementById('welcomeModal'); 
  if(!modal) {
    console.error('welcomeModal not found!');
    return;
  }
  const nameI=document.getElementById('wlName');
  const createBtn=document.getElementById('wlCreate');
  const joinBtn=document.getElementById('wlJoin');
  const soloBtn=document.getElementById('wlSolo');
  const inviteI=document.getElementById('wlInvite');
  
  console.log('Welcome buttons found:', {
    nameI: !!nameI,
    createBtn: !!createBtn, 
    joinBtn: !!joinBtn,
    soloBtn: !!soloBtn,
    inviteI: !!inviteI
  });
  // Advanced inline fields removed (relay/firebase saved via multiplayer modal if needed)
  // Load prefs
  const prefs=loadMpPrefs();
  if(nameI) nameI.value = prefs.name || '';
  // Legacy inline relay/firebase inputs removed from simplified welcome

  function open(){ modal.classList.remove('hidden'); }
  function close(){ modal.classList.add('hidden'); }
  // Always show on first load if not already connected
  if(!mp.connected && !sessionStorage.getItem('welcomeShown')){ open(); sessionStorage.setItem('welcomeShown','1'); }

  createBtn?.addEventListener('click', ()=>{
    const name=(nameI?.value||'').trim()||'GM';
    mp.name=name; mp.isGM=true; mp.connected=false; mp.room=genShortRoom();
    // Choose transport preference: Firebase if config present else relay if present else offline
  // Transport preference decided by saved prefs (Firebase config or relay set elsewhere) else offline local
  const prefs2=loadMpPrefs();
  if(prefs2.fbConfig){ mp.transport='fb'; mp.fb={config:prefs2.fbConfig, app:null, db:null, unsub:null}; }
  else if(prefs2.server){ mp.transport='ws'; mp.server=prefs2.server; }
  else { mp.transport='ws'; mp.server=''; }
    saveMpPrefs();
    if(mp.transport==='fb') connectFirebase(); else if(mp.server) connectWs(); else { setMpStatus('Solo'); }
    toast('Room '+mp.room);
  tryUpdateHostCodeDisplay(mp.room, true);
    close();
    // Jump to map
    document.querySelector(".nav-btn[data-view='map']")?.click();
    renderSessionBanner();
  });

  joinBtn?.addEventListener('click', ()=>{
    const raw=(inviteI?.value||'').trim(); if(!raw){ toast('Enter code'); return; }
    let parsed=null;
    if(/#join=/.test(raw) || raw.startsWith('http')){ // legacy link
      let hash=''; if(raw.startsWith('http')){ try{ hash=new URL(raw).hash; }catch{ hash=raw; } } else hash=raw.startsWith('#')? raw : '#'+raw; location.hash=hash; parsed=parseJoinHash();
    } else { // plain code
      parsed={ transport:(mp.transport||'ws'), server:(mp.server||''), room: raw }; }
    if(!parsed){ toast('Bad code'); return; }
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
    console.log('SOLO BUTTON CLICKED!');
    const name=(nameI?.value||'').trim()||'GM'; 
    mp.name=name; 
    mp.isGM=true; 
    mp.room=''; 
    mp.connected=false; 
    mp.transport='ws'; 
    mp.server=''; 
    saveMpPrefs(); 
    setMpStatus('Solo'); 
    close(); 
    document.querySelector(".nav-btn[data-view='map']")?.click(); 
    renderSessionBanner(); 
  });

  // Removed relaySave/fbSave buttons in simplified UI
}

function tryUpdateHostCodeDisplay(code, autoCopy){
  const el=document.getElementById('hostCodeDisplay'); if(!el) return;
  el.style.display='block';
  el.textContent='Code: '+code;
  if(autoCopy){
    copyText(code).then(()=>{ el.classList.add('copied'); el.textContent='Code: '+code+' (copied)'; setTimeout(()=>{ if(el.textContent.startsWith('Code: '+code)) el.textContent='Code: '+code; el.classList.remove('copied'); }, 1600); }).catch(()=>{});
  }
  el.onclick=()=>{ copyText(code).then(()=>{ el.classList.add('copied'); el.textContent='Code: '+code+' (copied)'; setTimeout(()=>{ if(el.textContent.startsWith('Code: '+code)) el.textContent='Code: '+code; el.classList.remove('copied'); }, 1600); }); };
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
  if(mp.room){ parts.push(`<button id="sbShare" class="mini-btn" title="Copy code">Copy Code</button>`); }
  el.innerHTML=parts.join(' • ');
  el.querySelector('#sbShare')?.addEventListener('click', copyJoinLink);
}

function applyGmMode(){
  const on = !!boardSettings.gmMode;
  document.body.classList.toggle('gm-mode', on);
  const gmBtn=document.getElementById('gmModeBtn');
  if(gmBtn){ gmBtn.textContent = on? 'Disable GM Mode' : 'Enable GM Mode'; }
  // Hide GM enable button for players (non-GM in multiplayer)
  if(gmBtn){ gmBtn.style.display = (mp.connected && !mp.isGM) ? 'none' : 'inline-block'; }
  // Restrict some controls when not GM (if in multiplayer and not GM) or GM mode disabled
  const restrictedIds=['wallModeBtn','fogRevealBtn','fogFullBtn','fogClearBtn','fogUndoBtn','addCircleTemplateBtn','addConeTemplateBtn','addLineTemplateBtn','sceneSaveBtn','sceneLoadBtn','sceneManageBtn','clearWallsBtn','clearTemplatesBtn'];
  restrictedIds.forEach(id=> { const el=document.getElementById(id); if(!el) return; if(mp.connected && !mp.isGM){ el.disabled=true; el.classList.add('disabled'); } else { el.disabled = !on; el.classList.toggle('disabled', !on); } });
}

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

// Old startRulerMode function removed - now using simple ruler in initMapBoard()

// ================ CHARACTER MODE SYSTEM ================

let characterMode = localStorage.getItem('characterMode') || 'standard'; // 'standard' or 'augurio'

function setupCharacterModes() {
  const standardBtn = document.getElementById('standardModeBtn');
  const augurioBtn = document.getElementById('augurioModeBtn');
  
  if (standardBtn && augurioBtn) {
    // Set initial mode
    updateCharacterMode(characterMode, false);
    
    // Add click handlers
    standardBtn.addEventListener('click', () => switchCharacterMode('standard'));
    augurioBtn.addEventListener('click', () => switchCharacterMode('augurio'));
  }
}

function switchCharacterMode(mode) {
  if (mode === characterMode) return; // Already in this mode
  
  // Save current character data before switching
  if (characterMode === 'standard') {
    saveStandardModeData();
  } else if (characterMode === 'augurio') {
    saveAugurioModeData();
  }
  
  characterMode = mode;
  localStorage.setItem('characterMode', mode);
  updateCharacterMode(mode, true);
  
  toast(`Switched to ${mode === 'standard' ? 'Standard D&D' : 'Augurio'} mode`);
}

function updateCharacterMode(mode, loadData = false) {
  const standardBtn = document.getElementById('standardModeBtn');
  const augurioBtn = document.getElementById('augurioModeBtn');
  const standardSection = document.getElementById('standardAbilities');
  const augurioSection = document.getElementById('augurioAbilities');
  
  // Update button states
  if (standardBtn && augurioBtn) {
    standardBtn.classList.toggle('active', mode === 'standard');
    augurioBtn.classList.toggle('active', mode === 'augurio');
  }
  
  // Show/hide sections
  if (standardSection && augurioSection) {
    if (mode === 'standard') {
      standardSection.classList.remove('hidden');
      augurioSection.classList.add('hidden');
      if (loadData) loadStandardModeData();
    } else {
      standardSection.classList.add('hidden');
      augurioSection.classList.remove('hidden');
      if (loadData) loadAugurioModeData();
    }
  }
}

let savingStandardMode = false;

function saveStandardModeData() {
  // Prevent infinite recursion
  if (savingStandardMode) {
    console.warn('saveStandardModeData already in progress, skipping');
    return;
  }
  
  savingStandardMode = true;
  
  try {
    // Save current standard mode data to charProfile
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    abilities.forEach(ability => {
      const input = document.getElementById('char' + ability.charAt(0).toUpperCase() + ability.slice(1));
      if (input) {
        charProfile.abilities[ability] = parseInt(input.value) || 10;
      }
    });
    
    // Save combat stats
    const combatFields = {
      'charAC': 'ac',
      'charHP': 'hp',
      'charMaxHP': 'maxHP',
      'charSpeed': 'speed'
    };
    
    Object.entries(combatFields).forEach(([inputId, profileKey]) => {
      const input = document.getElementById(inputId);
      if (input) {
        charProfile.combat[profileKey] = input.type === 'number' ? (parseInt(input.value) || 0) : input.value;
      }
    });
  } finally {
    savingStandardMode = false;
  }
}

function loadStandardModeData() {
  // Load standard mode data from charProfile
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  abilities.forEach(ability => {
    const input = document.getElementById('char' + ability.charAt(0).toUpperCase() + ability.slice(1));
    if (input && charProfile.abilities[ability] !== undefined) {
      input.value = charProfile.abilities[ability];
    }
  });
  
  // Load combat stats
  const combatFields = {
    'charAC': 'ac',
    'charHP': 'hp',
    'charMaxHP': 'maxHP',
    'charSpeed': 'speed'
  };
  
  Object.entries(combatFields).forEach(([inputId, profileKey]) => {
    const input = document.getElementById(inputId);
    if (input && charProfile.combat[profileKey] !== undefined) {
      input.value = charProfile.combat[profileKey];
    }
  });
  
  updateAbilityModifiers();
}

function saveAugurioModeData() {
  // Initialize augurio data if it doesn't exist
  if (!charProfile.augurio) {
    charProfile.augurio = {};
  }
  
  // Save all Augurio stats
  const augurioStats = [
    'ATK', 'DEF', 'DEM', 'VEL', 'VID', 'PRE', 'EVA', 'PAS',
    'SUE', 'FZA', 'CON', 'INT', 'SAG', 'AGI', 'CRM', 'DST',
    'VIT', 'ETK', 'EAC', 'EST', 'ESP'
  ];
  
  augurioStats.forEach(stat => {
    const input = document.getElementById('aug' + stat);
    if (input) {
      charProfile.augurio[stat.toLowerCase()] = parseInt(input.value) || 0;
    }
  });
  
  // Save text fields
  const textFields = ['Hands', 'Equip', 'Store'];
  textFields.forEach(field => {
    const input = document.getElementById('aug' + field);
    if (input) {
      charProfile.augurio[field.toLowerCase()] = input.value || '';
    }
  });
}

function loadAugurioModeData() {
  // Initialize augurio data if it doesn't exist
  if (!charProfile.augurio) {
    charProfile.augurio = {};
  }
  
  // Load all Augurio stats
  const augurioStats = [
    'ATK', 'DEF', 'DEM', 'VEL', 'VID', 'PRE', 'EVA', 'PAS',
    'SUE', 'FZA', 'CON', 'INT', 'SAG', 'AGI', 'CRM', 'DST',
    'VIT', 'ETK', 'EAC', 'EST', 'ESP'
  ];
  
  augurioStats.forEach(stat => {
    const input = document.getElementById('aug' + stat);
    if (input) {
      input.value = charProfile.augurio[stat.toLowerCase()] || 0;
    }
  });
  
  // Load text fields
  const textFields = ['Hands', 'Equip', 'Store'];
  textFields.forEach(field => {
    const input = document.getElementById('aug' + field);
    if (input) {
      input.value = charProfile.augurio[field.toLowerCase()] || '';
    }
  });
}

function setupAugurioAutoSave() {
  // Setup auto-save for all Augurio mode inputs
  const augurioStats = [
    'ATK', 'DEF', 'DEM', 'VEL', 'VID', 'PRE', 'EVA', 'PAS',
    'SUE', 'FZA', 'CON', 'INT', 'SAG', 'AGI', 'CRM', 'DST',
    'VIT', 'ETK', 'EAC', 'EST', 'ESP'
  ];
  
  augurioStats.forEach(stat => {
    const input = document.getElementById('aug' + stat);
    if (input) {
      input.addEventListener('input', () => {
        if (characterMode === 'augurio') {
          saveAugurioModeData();
          saveChar();
        }
      });
    }
  });
  
  // Setup auto-save for text fields
  const textFields = ['Hands', 'Equip', 'Store'];
  textFields.forEach(field => {
    const input = document.getElementById('aug' + field);
    if (input) {
      input.addEventListener('input', () => {
        if (characterMode === 'augurio') {
          saveAugurioModeData();
          saveChar();
        }
      });
    }
  });
}

// Enhanced save character function to handle both modes
let savingCharWithMode = false;

function saveCharWithMode() {
  // Prevent infinite recursion
  if (savingCharWithMode) {
    console.warn('saveCharWithMode already in progress, skipping');
    return;
  }
  
  savingCharWithMode = true;
  
  try {
    // Save current mode data
    if (characterMode === 'standard') {
      saveStandardModeData();
    } else if (characterMode === 'augurio') {
      saveAugurioModeData();
    }
    
    // Save character mode preference
    charProfile.characterMode = characterMode;
  } finally {
    savingCharWithMode = false;
  }
}

// ================ PROFILE & ACCOUNT SYSTEM ================

let profileData = JSON.parse(localStorage.getItem('profileData') || 'null');
let allCharacters = JSON.parse(localStorage.getItem('allCharacters') || '[]');

function buildProfile() {
  const authSection = document.getElementById('profileAuthSection');
  const dashboardSection = document.getElementById('profileDashboardSection');
  
  if (profileData) {
    // User is logged in - show dashboard
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    renderProfileDashboard();
  } else {
    // User needs to create profile
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    setupProfileAuth();
  }
}

function setupProfileAuth() {
  const createBtn = document.getElementById('createProfileBtn');
  const importBtn = document.getElementById('importProfileBtn');
  const avatarInput = document.getElementById('profileAvatar');
  const avatarPreview = document.getElementById('profileAvatarPreview');
  
  createBtn.onclick = createProfile;
  importBtn.onclick = importProfile;
  
  avatarInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        document.getElementById('profileAvatarImg').src = event.target.result;
        avatarPreview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  };
}

function createProfile() {
  const name = document.getElementById('profileName').value.trim();
  const email = document.getElementById('profileEmail').value.trim();
  const avatarImg = document.getElementById('profileAvatarImg');
  
  if (!name) {
    toast('Please enter a display name');
    return;
  }
  
  profileData = {
    id: 'profile_' + Date.now(),
    name: name,
    email: email || '',
    avatar: avatarImg.src || '',
    createdAt: new Date().toISOString(),
    settings: {
      autoSave: true,
      darkMode: false,
      analytics: false
    },
    lastSync: null
  };
  
  localStorage.setItem('profileData', JSON.stringify(profileData));
  
  // Migrate current character if exists
  if (getCurrentCharacterData()) {
    const currentChar = getCurrentCharacterData();
    currentChar.id = currentChar.id || 'char_' + Date.now();
    currentChar.profileId = profileData.id;
    currentChar.lastModified = new Date().toISOString();
    allCharacters.push(currentChar);
    localStorage.setItem('allCharacters', JSON.stringify(allCharacters));
  }
  
  toast('Profile created successfully!');
  buildProfile();
}

function importProfile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (data.profileData) {
        profileData = data.profileData;
        localStorage.setItem('profileData', JSON.stringify(profileData));
      }
      
      if (data.characters) {
        allCharacters = data.characters;
        localStorage.setItem('allCharacters', JSON.stringify(allCharacters));
      }
      
      toast('Profile imported successfully!');
      buildProfile();
    } catch (error) {
      toast('Failed to import profile: ' + error.message);
    }
  };
  input.click();
}

function renderProfileDashboard() {
  // Update profile display
  document.getElementById('currentProfileName').textContent = profileData.name;
  document.getElementById('currentProfileEmail').textContent = profileData.email || 'No email';
  document.getElementById('characterCount').textContent = allCharacters.length + ' characters';
  
  const avatar = document.getElementById('currentProfileAvatar');
  if (profileData.avatar) {
    avatar.src = profileData.avatar;
    avatar.style.display = 'block';
  } else {
    avatar.style.display = 'none';
  }
  
  // Setup dashboard actions
  setupProfileActions();
  renderCharactersList();
  updateSyncStatus();
}

function setupProfileActions() {
  document.getElementById('editProfileBtn').onclick = editProfile;
  document.getElementById('logoutBtn').onclick = logoutProfile;
  document.getElementById('newCharacterBtn').onclick = createNewCharacter;
  document.getElementById('exportAllDataBtn').onclick = exportAllData;
  document.getElementById('importAllDataBtn').onclick = () => document.getElementById('importDataInput').click();
  document.getElementById('importDataInput').onchange = importAllData;
  document.getElementById('syncToCloudBtn').onclick = syncToCloud;
  document.getElementById('syncFromCloudBtn').onclick = syncFromCloud;
  
  // Settings
  const autoSaveCheck = document.getElementById('autoSaveEnabled');
  const darkModeCheck = document.getElementById('darkModeEnabled');
  const analyticsCheck = document.getElementById('analyticsEnabled');
  
  autoSaveCheck.checked = profileData.settings.autoSave;
  darkModeCheck.checked = profileData.settings.darkMode;
  analyticsCheck.checked = profileData.settings.analytics;
  
  autoSaveCheck.onchange = () => updateSetting('autoSave', autoSaveCheck.checked);
  darkModeCheck.onchange = () => updateSetting('darkMode', darkModeCheck.checked);
  analyticsCheck.onchange = () => updateSetting('analytics', analyticsCheck.checked);
}

function renderCharactersList() {
  const grid = document.getElementById('charactersList');
  
  if (allCharacters.length === 0) {
    grid.innerHTML = '<div class="no-characters" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No characters yet. Create your first one!</div>';
    return;
  }
  
  grid.innerHTML = allCharacters.map(char => `
    <div class="character-card">
      <div class="character-card-header">
        ${char.image ? `<img src="${char.image}" class="character-avatar" alt="${char.name}" />` : '<div class="character-avatar"></div>'}
        <div class="character-info">
          <h4>${escapeHtml(char.name || 'Unnamed Character')}</h4>
          <p>${escapeHtml(char.ancestry || '')} ${escapeHtml(char.heritage || '')} ${escapeHtml(char.background || '')}</p>
        </div>
      </div>
      <div class="character-card-actions">
        <button class="mini-btn" onclick="loadCharacter('${char.id}')">Load</button>
        <button class="mini-btn" onclick="duplicateCharacter('${char.id}')">Copy</button>
        <button class="ghost-btn" onclick="deleteCharacter('${char.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function createNewCharacter() {
  // Switch to character view and clear current data
  document.querySelector('.nav-btn[data-view="character"]').click();
  clearCharacterSheet();
  toast('New character sheet ready');
}

function loadCharacter(characterId) {
  const character = allCharacters.find(c => c.id === characterId);
  if (!character) {
    toast('Character not found');
    return;
  }
  
  // Load character data into the character sheet
  loadCharacterData(character);
  
  // Switch to character view
  document.querySelector('.nav-btn[data-view="character"]').click();
  toast(`Loaded ${character.name}`);
}

function duplicateCharacter(characterId) {
  const character = allCharacters.find(c => c.id === characterId);
  if (!character) return;
  
  const duplicate = {
    ...character,
    id: 'char_' + Date.now(),
    name: (character.name || 'Unnamed') + ' (Copy)',
    lastModified: new Date().toISOString()
  };
  
  allCharacters.push(duplicate);
  localStorage.setItem('allCharacters', JSON.stringify(allCharacters));
  renderCharactersList();
  toast('Character duplicated');
}

function deleteCharacter(characterId) {
  if (!confirm('Delete this character permanently?')) return;
  
  allCharacters = allCharacters.filter(c => c.id !== characterId);
  localStorage.setItem('allCharacters', JSON.stringify(allCharacters));
  renderCharactersList();
  toast('Character deleted');
}

function exportAllData() {
  const data = {
    profileData: profileData,
    characters: allCharacters,
    moves: moves,
    exportDate: new Date().toISOString(),
    version: '1.0'
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `organizer-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  toast('Data exported successfully');
}

async function importAllData(e) {
  try {
    const file = e.target.files[0];
    if (!file) return;
    
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (data.profileData) {
      profileData = data.profileData;
      localStorage.setItem('profileData', JSON.stringify(profileData));
    }
    
    if (data.characters) {
      allCharacters = data.characters;
      localStorage.setItem('allCharacters', JSON.stringify(allCharacters));
    }
    
    if (data.moves) {
      moves = data.moves;
      localStorage.setItem('movesStore', JSON.stringify(moves));
    }
    
    toast('Data imported successfully');
    buildProfile();
    
  } catch (error) {
    toast('Import failed: ' + error.message);
  }
  
  e.target.value = '';
}

function syncToCloud() {
  toast('Cloud sync feature coming soon!');
  // Placeholder for future cloud integration
}

function syncFromCloud() {
  toast('Cloud sync feature coming soon!');
  // Placeholder for future cloud integration
}

function updateSetting(key, value) {
  profileData.settings[key] = value;
  localStorage.setItem('profileData', JSON.stringify(profileData));
  toast(`Setting updated: ${key}`);
}

function editProfile() {
  toast('Profile editing coming soon!');
  // Future: open modal to edit profile details
}

function logoutProfile() {
  if (!confirm('Sign out? Your data will remain saved locally.')) return;
  
  profileData = null;
  localStorage.removeItem('profileData');
  buildProfile();
  toast('Signed out');
}

function updateSyncStatus() {
  const status = document.getElementById('syncStatus');
  status.textContent = profileData.lastSync ? 
    `Last sync: ${new Date(profileData.lastSync).toLocaleDateString()}` : 
    'Local only';
}

// Helper functions for character management
function getCurrentCharacterData() {
  // Extract current character data from the charProfile
  return {
    ...charProfile,
    id: charProfile.id || 'current',
    lastModified: new Date().toISOString()
  };
}

function loadCharacterData(character) {
  // Load complete character data into charProfile
  charProfile = { ...charProfile, ...character };
  
  // Update character mode if specified
  if (character.characterMode) {
    characterMode = character.characterMode;
    localStorage.setItem('characterMode', characterMode);
    updateCharacterMode(characterMode, true);
  }
  
  // Refresh the character sheet display
  buildCharacterSheet();
  applyCharImage();
}

function clearCharacterSheet() {
  // Clear all character sheet fields
  const inputs = document.querySelectorAll('#view-character input, #view-character textarea, #view-character select');
  inputs.forEach(input => {
    if (input.type === 'checkbox' || input.type === 'radio') {
      input.checked = false;
    } else {
      input.value = '';
    }
  });
  
  const charImg = document.getElementById('charImg');
  if (charImg) charImg.src = 'images/char-placeholder.png';
}

// Enhanced save character function to work with profile system
function saveCharacterToProfile() {
  if (!profileData) {
    toast('Please create a profile first');
    return;
  }
  
  const characterData = getCurrentCharacterData();
  characterData.profileId = profileData.id;
  
  // Check if this is an existing character or new one
  const existingIndex = allCharacters.findIndex(c => c.id === characterData.id);
  
  if (existingIndex >= 0) {
    allCharacters[existingIndex] = characterData;
  } else {
    characterData.id = 'char_' + Date.now();
    allCharacters.push(characterData);
  }
  
  localStorage.setItem('allCharacters', JSON.stringify(allCharacters));
  toast('Character saved to profile');
  
  // Refresh profile view if active
  if (document.getElementById('view-profile').classList.contains('active')) {
    renderCharactersList();
  }
}

