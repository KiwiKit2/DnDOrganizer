async function fetchSheetCsv(url) {
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Sheet fetch failed ' + res.status);
  const text = await res.text();
  const rows = parseCsv(text);
  const headers = rows.shift();
  return { headers, rows, ms: (performance.now() - t0) };
}

function parseCsv(text) {
  // minimal CSV parser (handles quoted commas & newlines)
  const out = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur.trim()); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (cur.length || row.length) { row.push(cur.trim()); out.push(row); row = []; cur=''; }
      } else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur.trim()); out.push(row); }
  return out.filter(r => r.some(v => v !== ''));
}

function toObjects(headers, rows) {
  return rows.map(r => Object.fromEntries(headers.map((h,i)=>[h, r[i] ?? ''])));
}

function detectNumeric(columns, objects) {
  const numeric = new Set();
  columns.forEach(col => {
    if (NUMERIC_HINTS.some(h=> col.toLowerCase().includes(h.toLowerCase()))) { numeric.add(col); return; }
    let nums = 0, samples = 0;
    for (const o of objects) {
      const v = o[col].replace(/[$,%\s]/g,'');
      if (v) { samples++; if (!isNaN(+v)) nums++; }
      if (samples >= 12) break;
    }
    if (samples && nums / samples > 0.7) numeric.add(col);
  });
  return [...numeric];
}

export async function loadSheet() {
  if (!GOOGLE_SHEET_CSV_URL || GOOGLE_SHEET_CSV_URL.startsWith('PUT_')) throw new Error('Set GOOGLE_SHEET_CSV_URL in config.js');
  const { headers, rows, ms } = await fetchSheetCsv(GOOGLE_SHEET_CSV_URL);
  const objects = toObjects(headers, rows);
  const numericCols = detectNumeric(headers, objects);
  return { headers, rows, objects, numericCols, ms };
}

export function exportJson(data) {
  downloadFile('export.json', JSON.stringify(data, null, 2));
}

export function exportCsv(headers, objects) {
  const esc = v => /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  const body = objects.map(o => headers.map(h=> esc(o[h]||'')).join(',')).join('\n');
  downloadFile('export.csv', headers.join(',') + '\n' + body);
}

function downloadFile(name, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
