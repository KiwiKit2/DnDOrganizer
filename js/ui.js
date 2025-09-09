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
  if (v === 'compendium') buildCompendium();
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
  Object.entries(groups).forEach(([k, items]) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.innerHTML = `<header>${k} <span>${items.length}</span></header><div class="kanban-cards"></div>`;
    const wrap = col.querySelector('.kanban-cards');
    items.forEach(o => wrap.appendChild(makeCard(o)));
    container.appendChild(col);
  });
  enableDrag();
  document.getElementById('kanbanEmpty').classList.toggle('hidden', container.children.length>0);
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
      const status = col.parentElement.querySelector('header').childNodes[0].textContent.trim();
  const groupCol = els.groupSelect?.value || KANBAN_GROUP_COLUMN;
  state.objects[idx][groupCol] = status;
  state.dirty = true;
  markDirty();
    });
  });
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
  if (clearBtn) clearBtn.addEventListener('click', () => { document.getElementById('tokenLayer').innerHTML=''; });
  const gridInput = document.getElementById('gridSizeInput');
  if (gridInput) gridInput.addEventListener('change', refreshMap);
  const layer = document.getElementById('tokenLayer');
  layer?.addEventListener('mousedown', e=> { if (e.target.classList.contains('token')) dragToken(e); });
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
      testImage(url, ok => { div.style.backgroundImage = `url(${ok?url:PLACEHOLDER_IMG})`; });
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
      { Name:'Aria', Type:'Player', Status:'Active', HP:24, Notes:'Half-elf bard', Image:'https://placekitten.com/200/200' },
      { Name:'Borin', Type:'Player', Status:'Active', HP:31, Notes:'Dwarf fighter', Image:'https://placekitten.com/210/210' },
      { Name:'Goblin', Type:'Enemy', Status:'Spotted', HP:7, Notes:'Ambusher', Image:'https://placekitten.com/190/190' },
      { Name:'Potion of Healing', Type:'Item', Status:'Inventory', Notes:'2d4+2 restore', Image:'https://placekitten.com/205/205' }
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
