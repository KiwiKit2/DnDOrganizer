// Simple compendium gallery using current state (players/items/enemies inferred)
(function(){
  const TYPE_FIELD_CANDIDATES = ['Type','Category','Kind'];
  const IMG_FIELD_CANDIDATES = ['Image','Img','Picture','Art','Avatar'];

  function infer(state) {
    const headers = state.headers;
    const typeField = TYPE_FIELD_CANDIDATES.find(c=> headers.includes(c));
    const imgField = IMG_FIELD_CANDIDATES.find(c=> headers.includes(c));
    const nameField = headers.find(h=> /name|title/i.test(h)) || headers[0];
    const descField = headers.find(h=> /desc|notes|text/i.test(h)) || null;
    return { typeField, imgField, nameField, descField };
  }

  function buildGallery() {
    if (!window.__getState) return;
    const state = window.__getState();
    if (!state.objects.length) return;
    const { typeField, imgField, nameField, descField } = infer(state);
    const showPlayers = document.getElementById('showPlayers').checked;
    const showItems = document.getElementById('showItems').checked;
    const showEnemies = document.getElementById('showEnemies').checked;
    const gallery = document.getElementById('compGallery');
    const detail = document.getElementById('compDetail');
    gallery.innerHTML = '';
    detail.classList.add('hidden');

    const classify = o => {
      const t = (o[typeField]||'').toLowerCase();
      if (/player|pc|hero|character/.test(t)) return 'player';
      if (/enemy|monster|foe|npc/.test(t)) return 'enemy';
      if (/item|loot|gear|weapon|armor/.test(t)) return 'item';
      return 'other';
    };

    state.filtered.forEach(o => {
      const tag = classify(o);
      if ((tag==='player' && !showPlayers) || (tag==='enemy' && !showEnemies) || (tag==='item' && !showItems)) return;
      const card = document.createElement('div');
      card.className = 'grid-token';
      const img = document.createElement('img');
      const original = imgField && o[imgField] ? o[imgField] : '';
      if (!original) { img.src = PLACEHOLDER_IMG; img.style.opacity = .4; }
      else {
        // optimistic set then swap to placeholder if blocked
        img.src = original;
        let watchdog = setTimeout(()=> { img.src = PLACEHOLDER_IMG; img.style.opacity=.55; }, 4500);
        img.onerror = () => { clearTimeout(watchdog); img.src = PLACEHOLDER_IMG; img.style.opacity=.6; };
      }
      const h5 = document.createElement('h5');
      h5.textContent = o[nameField] || '(unnamed)';
      const tags = document.createElement('div');
      tags.className = 'tag-row';
      tags.textContent = o[typeField] || tag;
      card.appendChild(img); card.appendChild(h5); card.appendChild(tags);
      card.addEventListener('click', () => showDetail(o, { nameField, imgField, descField, typeField }));
      gallery.appendChild(card);
    });
  }

  function showDetail(o, f) {
    const detail = document.getElementById('compDetail');
    detail.className = 'comp-detail';
    detail.innerHTML = '';
    const close = document.createElement('button');
    close.textContent = '×';
    close.className = 'close-btn';
    close.style.float = 'right';
    close.onclick = ()=> detail.classList.add('hidden');
    const h2 = document.createElement('h2');
    h2.textContent = o[f.nameField] || '(unnamed)';
  if (f.imgField && o[f.imgField]) { const img = document.createElement('img'); img.src = o[f.imgField]; img.onerror = () => { img.src = PLACEHOLDER_IMG; img.style.opacity = .6; };
      img.style.maxWidth = '180px';
      img.style.borderRadius = '14px';
      img.style.border = '1px solid var(--border)';
      detail.appendChild(img);
    }
    const p = document.createElement('p');
    p.textContent = (f.descField && o[f.descField]) || 'No description.';
    const meta = document.createElement('pre');
    meta.textContent = JSON.stringify(o, null, 2);
    meta.style.background = 'var(--bg-raised)';
    meta.style.padding = '14px 16px';
    meta.style.border = '1px solid var(--border)';
    meta.style.borderRadius = '14px';
    meta.style.maxHeight = '300px';
    meta.style.overflow = 'auto';
    detail.appendChild(close);
    detail.appendChild(h2);
    detail.appendChild(p);
    detail.appendChild(meta);
  }

  function hook() {
    ['showPlayers','showItems','showEnemies'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', buildGallery);
    });
  }

  window.buildCompendium = buildGallery;
  hook();
  setInterval(()=> { if (document.querySelector('#view-compendium.view.active')) buildGallery(); }, 2500);
})();
