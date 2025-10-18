// Items & Entities Information Tab - Loads data from Google Spreadsheet "Items" sheet
(function() {
  let infoData = [];
  let filteredData = [];
  let allSheetData = null;

  // Initialize the Items & Entities info system
  function initItemsEntitiesInfo() {
    bindEvents();
    loadInfoData();
  }

  // Bind event listeners
  function bindEvents() {
    const refreshBtn = document.getElementById('refreshInfoBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadInfoData);
    }

    const searchInput = document.getElementById('infoSearch');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(filterAndRenderData, 300));
    }

    const sortSelect = document.getElementById('infoSortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', filterAndRenderData);
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

  // Load data from Google Spreadsheet
  async function loadInfoData() {
    try {
      // Show loading state
      showLoading();

      // Get the sheet URL and modify it to fetch from "Items" sheet if available
      const baseUrl = window.getSheetUrl();
      
      if (!baseUrl || baseUrl.startsWith('PUT_')) {
        showError('Please configure your Google Sheet URL in settings.');
        return;
      }

      // Try to load from "Items" sheet specifically
      // Google Sheets published CSV URL format: .../pub?gid=SHEET_ID&single=true&output=csv
      // We'll try to get the Items sheet by modifying the URL
      let itemsUrl = baseUrl;
      
      // If the URL has gid parameter, we might need to find the Items sheet
      // For now, we'll just load the default sheet and look for Items data
      const { headers, rows, ms } = await fetchSheetCsv(itemsUrl);
      
      if (!headers || headers.length === 0) {
        showError('No data found in the spreadsheet.');
        return;
      }

      // Convert to objects
      infoData = rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] || '';
        });
        return obj;
      });

      allSheetData = { headers, data: infoData };
      
      filterAndRenderData();
      
      console.log(`Loaded ${infoData.length} items from spreadsheet in ${ms.toFixed(0)}ms`);
    } catch (error) {
      console.error('Error loading info data:', error);
      showError('Failed to load data: ' + error.message);
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

  // Filter and render data
  function filterAndRenderData() {
    if (!allSheetData) return;

    const searchTerm = document.getElementById('infoSearch')?.value.toLowerCase() || '';
    const sortBy = document.getElementById('infoSortSelect')?.value || 'original';

    // Filter data
    filteredData = infoData.filter(item => {
      if (!searchTerm) return true;
      
      // Search across all fields
      return Object.values(item).some(value => 
        String(value).toLowerCase().includes(searchTerm)
      );
    });

    // Sort data
    if (sortBy === 'name') {
      // Try to find a Name field
      const nameField = allSheetData.headers.find(h => 
        h.toLowerCase().includes('name') || h.toLowerCase().includes('nombre')
      );
      
      if (nameField) {
        filteredData.sort((a, b) => 
          String(a[nameField] || '').localeCompare(String(b[nameField] || ''))
        );
      }
    }

    renderTable();
  }

  // Render the table
  function renderTable() {
    const tableHead = document.getElementById('infoTableHead');
    const tableBody = document.getElementById('infoTableBody');
    const emptyState = document.getElementById('infoEmptyState');
    const table = document.getElementById('infoTable');

    if (!allSheetData || filteredData.length === 0) {
      table.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    emptyState.style.display = 'none';

    // Render header
    tableHead.innerHTML = '<tr>' + 
      allSheetData.headers.map(header => `<th>${header}</th>`).join('') +
      '</tr>';

    // Render body
    tableBody.innerHTML = filteredData.map(item => {
      return '<tr>' + 
        allSheetData.headers.map(header => `<td>${item[header] || ''}</td>`).join('') +
        '</tr>';
    }).join('');
  }

  // Show loading state
  function showLoading() {
    const tableBody = document.getElementById('infoTableBody');
    const emptyState = document.getElementById('infoEmptyState');
    const table = document.getElementById('infoTable');
    
    table.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = '<h3>Loading...</h3><p>Fetching data from Google Spreadsheet...</p>';
  }

  // Show error
  function showError(message) {
    const tableBody = document.getElementById('infoTableBody');
    const emptyState = document.getElementById('infoEmptyState');
    const table = document.getElementById('infoTable');
    
    table.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.innerHTML = `<h3>Error</h3><p>${message}</p>`;
  }

  // Export for global access
  window.ItemsEntitiesInfo = {
    init: initItemsEntitiesInfo,
    reload: loadInfoData
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initItemsEntitiesInfo);
  } else {
    initItemsEntitiesInfo();
  }
})();
