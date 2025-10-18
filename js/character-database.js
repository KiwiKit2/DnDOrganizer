// Character Database - Loads data from Google Spreadsheet "PJ" sheet
(function() {
  let characters = [];
  let filteredCharacters = [];
  let allSheetData = null;
  let allTags = new Set();
  let allMoves = new Set();

  // Initialize the Character Database system
  function initCharacterDatabase() {
    bindEvents();
    loadCharacterData();
  }

  // Bind event listeners
  function bindEvents() {
    const refreshBtn = document.getElementById('refreshCharDbBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadCharacterData);
    }

    const searchInput = document.getElementById('charDbSearch');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(filterAndRenderCharacters, 300));
    }

    const sortSelect = document.getElementById('charDbSortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', filterAndRenderCharacters);
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Load data from Google Spreadsheet "PJ" sheet
  async function loadCharacterData() {
    try {
      showLoading();

      const baseUrl = window.getSheetUrl();
      
      if (!baseUrl || baseUrl.startsWith('PUT_')) {
        showError('Please configure your Google Sheet URL in settings.');
        return;
      }

      // Load from the default sheet (assuming it's the PJ sheet)
      const { headers, rows, ms } = await fetchSheetCsv(baseUrl);
      
      if (!headers || headers.length === 0) {
        showError('No data found in the spreadsheet.');
        return;
      }

      // Convert to objects
      characters = rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] || '';
        });
        return obj;
      });

      allSheetData = { headers, data: characters };
      
      // Extract unique tags and moves for filters
      extractFilters();
      buildFilterCheckboxes();
      filterAndRenderCharacters();
      
      console.log(`Loaded ${characters.length} characters from PJ sheet in ${ms.toFixed(0)}ms`);
    } catch (error) {
      console.error('Error loading character data:', error);
      showError('Failed to load data: ' + error.message);
    }
  }

  // Extract unique tags and moves from characters
  function extractFilters() {
    allTags.clear();
    allMoves.clear();

    characters.forEach(char => {
      // Extract tags (assuming Tags column contains comma-separated values)
      if (char.Tags) {
        char.Tags.split(',').forEach(tag => {
          const cleaned = tag.trim();
          if (cleaned) allTags.add(cleaned);
        });
      }

      // Extract moves (assuming Moves column contains comma-separated values)
      if (char.Moves) {
        char.Moves.split(',').forEach(move => {
          const cleaned = move.trim();
          if (cleaned) allMoves.add(cleaned);
        });
      }
    });
  }

  // Build filter checkboxes
  function buildFilterCheckboxes() {
    const tagFiltersContainer = document.getElementById('charDbTagFilters');
    const moveFiltersContainer = document.getElementById('charDbMoveFilters');

    // Build tag filters
    if (tagFiltersContainer) {
      tagFiltersContainer.innerHTML = '';
      const sortedTags = Array.from(allTags).sort();
      
      if (sortedTags.length === 0) {
        tagFiltersContainer.innerHTML = '<span style="color: var(--text-dim); font-size: 12px;">No tags found</span>';
      } else {
        sortedTags.forEach(tag => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = true;
          checkbox.className = 'tag-filter-checkbox';
          checkbox.dataset.tag = tag;
          checkbox.addEventListener('change', filterAndRenderCharacters);
          
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(' ' + tag));
          tagFiltersContainer.appendChild(label);
        });
      }
    }

    // Build move filters
    if (moveFiltersContainer) {
      moveFiltersContainer.innerHTML = '';
      const sortedMoves = Array.from(allMoves).sort();
      
      if (sortedMoves.length === 0) {
        moveFiltersContainer.innerHTML = '<span style="color: var(--text-dim); font-size: 12px;">No moves found</span>';
      } else {
        sortedMoves.forEach(move => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = true;
          checkbox.className = 'move-filter-checkbox';
          checkbox.dataset.move = move;
          checkbox.addEventListener('change', filterAndRenderCharacters);
          
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(' ' + move));
          moveFiltersContainer.appendChild(label);
        });
      }
    }
  }

  // Fetch CSV from Google Sheets
  async function fetchSheetCsv(url) {
    const t0 = performance.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Sheet fetch failed ' + res.status);
    const text = await res.text();
    const rows = parseCsv(text);
    const headers = rows.shift();
    return { headers, rows, ms: (performance.now() - t0) };
  }

  // Parse CSV text
  function parseCsv(text) {
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

  // Filter and render characters
  function filterAndRenderCharacters() {
    if (!allSheetData) return;

    const searchTerm = document.getElementById('charDbSearch')?.value.toLowerCase() || '';
    const sortBy = document.getElementById('charDbSortSelect')?.value || 'original';

    // Get selected tags and moves
    const selectedTags = new Set();
    document.querySelectorAll('.tag-filter-checkbox:checked').forEach(cb => {
      selectedTags.add(cb.dataset.tag);
    });

    const selectedMoves = new Set();
    document.querySelectorAll('.move-filter-checkbox:checked').forEach(cb => {
      selectedMoves.add(cb.dataset.move);
    });

    // Filter characters
    filteredCharacters = characters.filter(char => {
      // Search filter
      if (searchTerm) {
        const searchableText = Object.values(char).join(' ').toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      // Tags filter
      if (selectedTags.size > 0 && char.Tags) {
        const charTags = char.Tags.split(',').map(t => t.trim());
        const hasSelectedTag = charTags.some(tag => selectedTags.has(tag));
        if (!hasSelectedTag) return false;
      }

      // Moves filter
      if (selectedMoves.size > 0 && char.Moves) {
        const charMoves = char.Moves.split(',').map(m => m.trim());
        const hasSelectedMove = charMoves.some(move => selectedMoves.has(move));
        if (!hasSelectedMove) return false;
      }

      return true;
    });

    // Sort characters
    if (sortBy !== 'original') {
      filteredCharacters.sort((a, b) => {
        let valA, valB;
        
        if (sortBy === 'name') {
          valA = (a.Name || '').toLowerCase();
          valB = (b.Name || '').toLowerCase();
          return valA.localeCompare(valB);
        } else if (sortBy === 'hp' || sortBy === 'vel') {
          const key = sortBy.toUpperCase();
          valA = parseFloat(a[key]) || 0;
          valB = parseFloat(b[key]) || 0;
          return valB - valA; // Descending order for numeric values
        }
        
        return 0;
      });
    }

    renderCharacters();
  }

  // Render characters as cards
  function renderCharacters() {
    const grid = document.getElementById('charDbGrid');
    const emptyState = document.getElementById('charDbEmptyState');

    if (!allSheetData || filteredCharacters.length === 0) {
      grid.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    grid.style.display = 'grid';
    emptyState.style.display = 'none';

    grid.innerHTML = filteredCharacters.map(char => createCharacterCard(char)).join('');
  }

  // Create a character card
  function createCharacterCard(char) {
    const name = char.Name || 'Unnamed';
    const description = char.Description || '';
    const img = char.IMG || '';
    const moves = char.Moves || '';
    const tags = char.Tags || '';
    const hp = char.HP || '';
    const vel = char.VEL || '';
    
    // Build stat badges
    const statBadges = [];
    const statColumns = ['HP', 'VEL', 'FRE', 'EVA', 'ATK', 'ATM', 'PAS', 'DEF', 'DEM', 'FZA', 'CON', 'INT', 'SAG', 'AGI', 'CRM', 'DST', 'VIT', 'ETK', 'EAC', 'EST', 'EPA'];
    
    statColumns.forEach(col => {
      if (char[col] && char[col] !== '0') {
        statBadges.push(`<span class="stat-badge" title="${col}">${col}: ${char[col]}</span>`);
      }
    });

    return `
      <div class="char-db-card">
        ${img ? `<img src="${img}" alt="${name}" class="char-db-img" onerror="this.style.display='none'">` : ''}
        <div class="char-db-content">
          <h3 class="char-db-name">${name}</h3>
          ${description ? `<p class="char-db-description">${description}</p>` : ''}
          
          ${moves ? `
            <div class="char-db-section">
              <strong>Moves:</strong>
              <p>${moves}</p>
            </div>
          ` : ''}
          
          ${tags ? `
            <div class="char-db-tags">
              ${tags.split(',').map(tag => `<span class="char-tag">${tag.trim()}</span>`).join('')}
            </div>
          ` : ''}
          
          ${statBadges.length > 0 ? `
            <div class="char-db-stats">
              ${statBadges.join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Show loading state
  function showLoading() {
    const grid = document.getElementById('charDbGrid');
    const emptyState = document.getElementById('charDbEmptyState');
    
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = '<h3>Loading...</h3><p>Fetching character data from Google Spreadsheet...</p>';
  }

  // Show error
  function showError(message) {
    const grid = document.getElementById('charDbGrid');
    const emptyState = document.getElementById('charDbEmptyState');
    
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = `<h3>Error</h3><p>${message}</p>`;
  }

  // Export for global access
  window.CharacterDatabase = {
    init: initCharacterDatabase,
    reload: loadCharacterData
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCharacterDatabase);
  } else {
    initCharacterDatabase();
  }
})();
