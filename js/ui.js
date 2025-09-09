import { loadSheet, exportJson, exportCsv } from './sheet.js';
import { saveCache, loadCache, diffCounts } from './persist.js';

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
  const cached = loadCache();
  if (cached) {
    state.headers = cached.headers;
    state.objects = cached.objects;
    state.filtered = [...state.objects];
    buildTable();
    buildColumnFilter();
    applyFilters();
    document.querySelector('#statusLine').textContent = 'Loaded cached data';
  }
  await reload();
  autoLoop();
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
}

function wireNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      document.querySelectorAll('.view').forEach(sec=>sec.classList.remove('active'));
      document.querySelector('#view-' + v).classList.add('active');
      if (v === 'stats') buildStats();
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
  document.getElementById('exportJson').addEventListener('click', ()=> exportJson(state.filtered));
  document.getElementById('exportCsv').addEventListener('click', ()=> exportCsv(state.headers, state.filtered));
  wireSheetModal();
}

async function reload() {
  try {
    els.statusLine.textContent = 'Loading…';
  const before = { headers: state.headers, objects: state.objects };
  const data = await loadSheet();
  state.headers = data.headers;
  state.objects = data.objects;
    state.numericCols = data.numericCols;
    state.lastLoad = new Date();
    buildTable();
    buildColumnFilter();
    applyFilters();
    buildKanban();
  saveCache(state);
  const after = { headers: state.headers, objects: state.objects };
  const { added, removed } = diffCounts(before.headers.length? before : null, after);
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
  if (document.querySelector('.nav-btn.active')?.dataset.view === 'board') buildKanban();
  if (document.querySelector('.nav-btn.active')?.dataset.view === 'stats') buildStats();
}

function buildKanban() {
  const container = document.getElementById('kanban');
  container.innerHTML = '';
  if (!state.headers.includes(KANBAN_GROUP_COLUMN)) { container.textContent = 'Column '+KANBAN_GROUP_COLUMN+' missing.'; return; }
  const groups = groupBy(state.filtered, o => o[KANBAN_GROUP_COLUMN] || '—');
  Object.entries(groups).forEach(([k, items]) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.innerHTML = `<header>${k} <span>${items.length}</span></header><div class="kanban-cards"></div>`;
    const wrap = col.querySelector('.kanban-cards');
    items.forEach(o => wrap.appendChild(makeCard(o)));
    container.appendChild(col);
  });
  enableDrag();
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
  state.objects[idx][KANBAN_GROUP_COLUMN] = status;
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
}

init();
