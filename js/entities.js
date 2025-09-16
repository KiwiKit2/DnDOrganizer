// Enhanced Entities System
(function() {
  let entities = JSON.parse(localStorage.getItem('entities') || '[]');
  let currentEntity = null;
  let isEditing = false;

  // Initialize entities system
  function initEntities() {
    if (entities.length === 0) {
      // Add some sample items
      entities = [
        {
          id: Date.now() + '_1',
          name: 'Longsword +1',
          type: 'weapon',
          description: 'A finely crafted longsword with a magical enhancement. Provides +1 to attack and damage rolls.',
          tags: ['magic', 'combat', 'weapon'],
          value: 150,
          weight: 3,
          rarity: 'uncommon',
          image: '',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_2',
          name: 'Healing Potion',
          type: 'potion',
          description: 'A small vial of red liquid that restores 2d4+2 hit points when consumed.',
          tags: ['healing', 'consumable', 'common'],
          value: 50,
          weight: 0.5,
          rarity: 'common',
          image: '',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_3',
          name: 'Leather Armor',
          type: 'armor',
          description: 'Boiled leather armor that provides AC 11 + Dex modifier.',
          tags: ['armor', 'protection', 'light'],
          value: 10,
          weight: 10,
          rarity: 'common',
          image: '',
          created: new Date().toISOString()
        }
      ];
      saveEntities();
    }
    bindEvents();
    renderEntities();
  }

  // Save entities to localStorage
  function saveEntities() {
    localStorage.setItem('entities', JSON.stringify(entities));
  }

  // Bind event listeners
  function bindEvents() {
    // Add new entity button
    const addBtn = document.getElementById('addEntityBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => openEntityModal());
    }

    // Search functionality
    const searchInput = document.getElementById('entitySearch');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(renderEntities, 300));
    }

    // Clear search
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        document.getElementById('entitySearch').value = '';
        renderEntities();
      });
    }

    // Filter checkboxes
    ['showWeapons', 'showArmor', 'showItems', 'showMagic', 'showOther'].forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', renderEntities);
      }
    });

    // Sort dropdown
    const sortSelect = document.getElementById('sortBySelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', renderEntities);
    }

    // Modal events
    const modal = document.getElementById('entityModal');
    const closeBtn = document.getElementById('closeEntityModal');
    const cancelBtn = document.getElementById('cancelEntityBtn');
    const form = document.getElementById('entityForm');
    const deleteBtn = document.getElementById('deleteEntityBtn');

    if (closeBtn) closeBtn.addEventListener('click', closeEntityModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeEntityModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeEntityModal();
      });
    }
    if (form) form.addEventListener('submit', saveEntity);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteEntity);

    // Import/Export buttons
    const importBtn = document.getElementById('importExcelBtn');
    const exportBtn = document.getElementById('exportExcelBtn');
    if (importBtn) importBtn.addEventListener('click', importFromExcel);
    if (exportBtn) exportBtn.addEventListener('click', exportToExcel);
  }

  // Debounce function for search
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

  // Render entities grid
  function renderEntities() {
    const grid = document.getElementById('entitiesGrid');
    if (!grid) return;

    // Get filters
    const searchTerm = document.getElementById('entitySearch')?.value.toLowerCase() || '';
    const showWeapons = document.getElementById('showWeapons')?.checked ?? true;
    const showArmor = document.getElementById('showArmor')?.checked ?? true;
    const showItems = document.getElementById('showItems')?.checked ?? true;
    const showMagic = document.getElementById('showMagic')?.checked ?? true;
    const showOther = document.getElementById('showOther')?.checked ?? true;
    const sortBy = document.getElementById('sortBySelect')?.value || 'name';

    // Filter entities
    let filteredEntities = entities.filter(entity => {
      // Search filter
      if (searchTerm) {
        const searchableText = `${entity.name} ${entity.type} ${entity.description} ${entity.tags.join(' ')}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      // Type filters
      const typeMap = {
        weapon: showWeapons,
        armor: showArmor,
        potion: showItems,
        scroll: showItems,
        tool: showItems,
        treasure: showItems,
        wondrous: showMagic,
        other: showOther
      };

      return typeMap[entity.type] ?? showOther;
    });

    // Sort entities
    filteredEntities.sort((a, b) => {
      switch (sortBy) {
        case 'type':
          return a.type.localeCompare(b.type);
        case 'created':
          return new Date(b.created) - new Date(a.created);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    // Render grid
    grid.innerHTML = '';
    
    if (filteredEntities.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">
          <h3>No items found</h3>
          <p>Try adjusting your filters or search terms.</p>
        </div>
      `;
      return;
    }

    filteredEntities.forEach(entity => {
      const card = createEntityCard(entity);
      grid.appendChild(card);
    });
  }

  // Create entity card element
  function createEntityCard(entity) {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.addEventListener('click', () => openEntityModal(entity));

    const tags = entity.tags.map(tag => `<span class="entity-tag">${tag}</span>`).join('');
    
    card.innerHTML = `
      <div class="entity-card-header">
        <h3 class="entity-name">${entity.name}</h3>
        <span class="entity-type">${entity.type}</span>
      </div>
      
      <p class="entity-description">${entity.description || 'No description available.'}</p>
      
      <div class="entity-tags">${tags}</div>
      
      <div class="entity-meta">
        <span class="entity-value">${entity.value ? entity.value + ' gp' : 'No value'}</span>
        <span class="entity-rarity ${entity.rarity}">${entity.rarity}</span>
      </div>
    `;

    return card;
  }

  // Open entity modal
  function openEntityModal(entity = null) {
    const modal = document.getElementById('entityModal');
    const title = document.getElementById('entityModalTitle');
    const deleteBtn = document.getElementById('deleteEntityBtn');
    
    currentEntity = entity;
    isEditing = !!entity;

    if (isEditing) {
      title.textContent = 'Edit Item';
      deleteBtn.classList.remove('hidden');
      populateForm(entity);
    } else {
      title.textContent = 'Add New Item';
      deleteBtn.classList.add('hidden');
      clearForm();
    }

    modal.classList.remove('hidden');
  }

  // Close entity modal
  function closeEntityModal() {
    const modal = document.getElementById('entityModal');
    modal.classList.add('hidden');
    currentEntity = null;
    isEditing = false;
  }

  // Populate form with entity data
  function populateForm(entity) {
    document.getElementById('entityName').value = entity.name;
    document.getElementById('entityType').value = entity.type;
    document.getElementById('entityDescription').value = entity.description;
    document.getElementById('entityTags').value = entity.tags.join(', ');
    document.getElementById('entityValue').value = entity.value || '';
    document.getElementById('entityWeight').value = entity.weight || '';
    document.getElementById('entityRarity').value = entity.rarity;
    document.getElementById('entityImage').value = entity.image || '';
  }

  // Clear form
  function clearForm() {
    document.getElementById('entityForm').reset();
    document.getElementById('entityRarity').value = 'common';
  }

  // Save entity
  function saveEntity(e) {
    e.preventDefault();

    const formData = {
      name: document.getElementById('entityName').value.trim(),
      type: document.getElementById('entityType').value,
      description: document.getElementById('entityDescription').value.trim(),
      tags: document.getElementById('entityTags').value.split(',').map(tag => tag.trim()).filter(tag => tag),
      value: parseFloat(document.getElementById('entityValue').value) || 0,
      weight: parseFloat(document.getElementById('entityWeight').value) || 0,
      rarity: document.getElementById('entityRarity').value,
      image: document.getElementById('entityImage').value.trim()
    };

    if (!formData.name || !formData.type) {
      alert('Please fill in all required fields (Name and Type).');
      return;
    }

    if (isEditing) {
      // Update existing entity
      const index = entities.findIndex(e => e.id === currentEntity.id);
      if (index !== -1) {
        entities[index] = { ...entities[index], ...formData };
      }
    } else {
      // Create new entity
      const newEntity = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        ...formData,
        created: new Date().toISOString()
      };
      entities.push(newEntity);
    }

    saveEntities();
    renderEntities();
    closeEntityModal();
    
    toast(isEditing ? 'Item updated successfully!' : 'Item added successfully!');
  }

  // Delete entity
  function deleteEntity() {
    if (!currentEntity) return;

    if (confirm(`Are you sure you want to delete "${currentEntity.name}"?`)) {
      entities = entities.filter(e => e.id !== currentEntity.id);
      saveEntities();
      renderEntities();
      closeEntityModal();
      toast('Item deleted successfully!');
    }
  }

  // Import from Excel (placeholder)
  function importFromExcel() {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.addEventListener('change', handleFileImport);
    input.click();
  }

  // Handle file import
  function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    // For now, show a placeholder message
    toast('Excel import will be implemented in the next iteration!');
    console.log('File selected for import:', file.name);
  }

  // Export to Excel
  function exportToExcel() {
    // Convert entities to CSV format
    const headers = ['Name', 'Type', 'Description', 'Tags', 'Value (gp)', 'Weight (lbs)', 'Rarity', 'Image URL'];
    const csvContent = [
      headers.join(','),
      ...entities.map(entity => [
        `"${entity.name}"`,
        `"${entity.type}"`,
        `"${entity.description.replace(/"/g, '""')}"`,
        `"${entity.tags.join(', ')}"`,
        entity.value || 0,
        entity.weight || 0,
        `"${entity.rarity}"`,
        `"${entity.image}"`
      ].join(','))
    ].join('\n');

    // Download CSV file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'entities.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast('Entities exported to CSV file!');
  }

  // Toast notification function
  function toast(message) {
    // Use existing toast function if available, otherwise simple alert
    if (window.toast) {
      window.toast(message);
    } else {
      console.log('Toast:', message);
    }
  }

  // Initialize when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEntities);
  } else {
    initEntities();
  }

  // Expose functions globally for debugging
  window.entitiesSystem = {
    entities,
    renderEntities,
    openEntityModal,
    saveEntities
  };
})();