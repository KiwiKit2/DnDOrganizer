function buildStats() {
  const state = window.__getState();
  const canvas = document.getElementById('statsChart');
  const ctx = canvas.getContext('2d');
  if (!state.numericCols.length) { ctx.font = '14px Inter'; ctx.fillStyle = '#888'; ctx.fillText('No numeric columns detected', 20, 40); return; }
  const col = state.numericCols[0];
  const vals = state.filtered.map(o=> parseFloat((o[col]||'').replace(/[$,%\s]/g,''))).filter(v=>!isNaN(v));
  const labels = vals.map((_,i)=> i+1);
  if (window._chart) { window._chart.destroy(); }
  window._chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: col, data: vals, borderColor: '#4f8dff', tension:.25, pointRadius:0, fill:false }]},
    options: { plugins: { legend: { labels: { color: '#bbb' } } }, scales: { x: { ticks:{ color:'#666'} }, y: { ticks:{ color:'#666'} } } }
  });
  buildSummary(state, col, vals);
}

function buildSummary(state, col, vals) {
  const sum = vals.reduce((a,b)=>a+b,0);
  const avg = vals.length? sum/vals.length : 0;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const statsDiv = document.getElementById('statsSummary');
  statsDiv.innerHTML = '';
  const makeBox = (title, value) => `<div class="stat-box"><h3>${title}</h3><div class="value">${value}</div></div>`;
  statsDiv.innerHTML += makeBox('Column', col);
  statsDiv.innerHTML += makeBox('Count', vals.length);
  statsDiv.innerHTML += makeBox('Sum', fmt(sum));
  statsDiv.innerHTML += makeBox('Average', fmt(avg));
  statsDiv.innerHTML += makeBox('Min', fmt(min));
  statsDiv.innerHTML += makeBox('Max', fmt(max));
}

function fmt(n) { return Intl.NumberFormat().format(Math.round(n*100)/100); }
