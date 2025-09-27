// Items Management System
(function() {
  let items = JSON.parse(localStorage.getItem('items') || '[]');
  let currentItem = null;
  let isEditing = false;

  // Initialize items system
  function initItems() {
    if (items.length === 0) {
      // Add some sample items
      items = [
        {
          id: Date.now() + '_1',
          name: 'Flame Tongue Sword',
          type: 'weapon',
          description: 'A magical sword that ignites with flames when activated, dealing extra fire damage.',
          tags: ['magic', 'weapon', 'fire', 'rare'],
          value: 5000,
          weight: 3,
          rarity: 'rare',
          image: '',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_2',
          name: 'Potion of Greater Healing',
          type: 'potion',
          description: 'A potent healing potion that restores 4d4+4 hit points when consumed.',
          tags: ['healing', 'consumable', 'uncommon'],
          value: 150,
          weight: 0.5,
          rarity: 'uncommon',
          image: '',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_3',
          name: 'Studded Leather Armor +1',
          type: 'armor',
          description: 'Enhanced leather armor reinforced with metal studs, providing AC 12 + Dex modifier + 1.',
          tags: ['armor', 'protection', 'light', 'magic'],
          value: 1500,
          weight: 13,
          rarity: 'uncommon',
          image: '',
          created: new Date().toISOString()
        }
      ];
      saveItems();
    }
    bindEvents();
    renderItems();
  }

  // Save items to localStorage
  function saveItems() {
    localStorage.setItem('items', JSON.stringify(items));
  }

  // Bind event listeners
  function bindEvents() {
    const addBtn = document.getElementById('addItemBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => openItemModal());
    }

    const searchInput = document.getElementById('itemSearch');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(renderItems, 300));
    }

    const clearBtn = document.getElementById('clearItemSearchBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        document.getElementById('itemSearch').value = '';
        renderItems();
      });
    }

    ['showWeaponsItems', 'showArmorItems', 'showPotionsItems', 'showMagicItems', 'showToolsItems', 'showOtherItems'].forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', renderItems);
      }
    });

    const sortSelect = document.getElementById('sortItemsSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', renderItems);
    }

    // Modal events
    const modal = document.getElementById('itemModal');
    const closeBtn = document.getElementById('closeItemModal');
    const cancelBtn = document.getElementById('cancelItemBtn');
    const form = document.getElementById('itemForm');
    const deleteBtn = document.getElementById('deleteItemBtn');

    if (closeBtn) closeBtn.addEventListener('click', closeItemModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeItemModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeItemModal();
      });
    }
    if (form) form.addEventListener('submit', saveItem);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteItem);
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

  function renderItems() {
    const grid = document.getElementById('itemsGrid');
    if (!grid) return;

    const searchTerm = document.getElementById('itemSearch')?.value.toLowerCase() || '';
    const showWeapons = document.getElementById('showWeaponsItems')?.checked ?? true;
    const showArmor = document.getElementById('showArmorItems')?.checked ?? true;
    const showPotions = document.getElementById('showPotionsItems')?.checked ?? true;
    const showMagic = document.getElementById('showMagicItems')?.checked ?? true;
    const showTools = document.getElementById('showToolsItems')?.checked ?? true;
    const showOther = document.getElementById('showOtherItems')?.checked ?? true;
    const sortBy = document.getElementById('sortItemsSelect')?.value || 'name';

    let filteredItems = items.filter(item => {
      if (searchTerm) {
        const searchableText = `${item.name} ${item.type} ${item.description} ${item.tags.join(' ')}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      const typeMap = {
        weapon: showWeapons,
        armor: showArmor,
        potion: showPotions,
        scroll: showMagic,
        wondrous: showMagic,
        tool: showTools,
        treasure: showOther,
        other: showOther
      };

      return typeMap[item.type] ?? showOther;
    });

    filteredItems.sort((a, b) => {
      switch (sortBy) {
        case 'type':
          return a.type.localeCompare(b.type);
        case 'value':
          return (b.value || 0) - (a.value || 0);
        case 'created':
          return new Date(b.created) - new Date(a.created);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    grid.innerHTML = '';
    
    if (filteredItems.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">
          <h3>No items found</h3>
          <p>Try adjusting your filters or search terms.</p>
        </div>
      `;
      return;
    }

    filteredItems.forEach(item => {
      const card = createItemCard(item);
      grid.appendChild(card);
    });
  }

  function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.addEventListener('click', () => openItemModal(item));

    const tags = item.tags.map(tag => `<span class="entity-tag">${tag}</span>`).join('');
    
    card.innerHTML = `
      <div class="entity-card-header">
        <h3 class="entity-name">${item.name}</h3>
        <span class="entity-type">${item.type}</span>
      </div>
      
      <p class="entity-description">${item.description || 'No description available.'}</p>
      
      <div class="entity-tags">${tags}</div>
      
      <div class="entity-meta">
        <span class="entity-value">${item.value ? item.value + ' gp' : 'No value'}</span>
        <span class="entity-rarity ${item.rarity}">${item.rarity}</span>
      </div>
    `;

    return card;
  }

  function openItemModal(item = null) {
    const modal = document.getElementById('itemModal');
    const title = document.getElementById('itemModalTitle');
    const deleteBtn = document.getElementById('deleteItemBtn');
    
    currentItem = item;
    isEditing = !!item;

    if (isEditing) {
      title.textContent = 'Edit Item';
      deleteBtn.classList.remove('hidden');
      populateForm(item);
    } else {
      title.textContent = 'Add New Item';
      deleteBtn.classList.add('hidden');
      clearForm();
    }

    modal.classList.remove('hidden');
  }

  function closeItemModal() {
    const modal = document.getElementById('itemModal');
    modal.classList.add('hidden');
    currentItem = null;
    isEditing = false;
  }

  function populateForm(item) {
    document.getElementById('itemName').value = item.name || '';
    document.getElementById('itemType').value = item.type || '';
    document.getElementById('itemDescription').value = item.description || '';
    document.getElementById('itemTags').value = item.tags ? item.tags.join(', ') : '';
    document.getElementById('itemValue').value = item.value || '';
    document.getElementById('itemWeight').value = item.weight || '';
    document.getElementById('itemRarity').value = item.rarity || 'common';
    document.getElementById('itemImage').value = item.image || '';
  }

  function clearForm() {
    document.getElementById('itemForm').reset();
  }

  function saveItem(e) {
    e.preventDefault();
    
    const formData = {
      name: document.getElementById('itemName').value.trim(),
      type: document.getElementById('itemType').value,
      description: document.getElementById('itemDescription').value.trim(),
      tags: document.getElementById('itemTags').value.split(',').map(tag => tag.trim()).filter(tag => tag),
      value: parseFloat(document.getElementById('itemValue').value) || 0,
      weight: parseFloat(document.getElementById('itemWeight').value) || 0,
      rarity: document.getElementById('itemRarity').value,
      image: document.getElementById('itemImage').value.trim()
    };

    if (!formData.name || !formData.type) {
      alert('Please fill in all required fields');
      return;
    }

    if (isEditing && currentItem) {
      const index = items.findIndex(item => item.id === currentItem.id);
      if (index !== -1) {
        items[index] = { ...items[index], ...formData, updated: new Date().toISOString() };
      }
    } else {
      const newItem = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        ...formData,
        created: new Date().toISOString()
      };
      items.push(newItem);
    }

    saveItems();
    renderItems();
    closeItemModal();
    
    // Cloud sync
    if (window.userDocRef) {
      const itemToSync = isEditing && currentItem ? 
        items.find(item => item.id === currentItem.id) : 
        items[items.length - 1];
      if (itemToSync) {
        window.userDocRef.collection('items').doc(itemToSync.id).set(itemToSync)
          .catch(err => console.error('Failed to sync item to cloud:', err));
      }
    }
  }

  function deleteItem() {
    if (!currentItem || !confirm('Are you sure you want to delete this item?')) {
      return;
    }

    const itemId = currentItem.id;
    items = items.filter(item => item.id !== currentItem.id);
    saveItems();
    renderItems();
    closeItemModal();
    
    // Cloud sync
    if (window.userDocRef) {
      window.userDocRef.collection('items').doc(itemId).delete()
        .catch(err => console.error('Failed to delete item from cloud:', err));
    }
  }

  // Export for global access
  window.ItemsManager = {
    init: initItems,
    getItems: () => items,
    addItem: (item) => {
      items.push({ ...item, id: Date.now() + '_' + Math.random().toString(36).substr(2, 9), created: new Date().toISOString() });
      saveItems();
      renderItems();
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initItems);
  } else {
    initItems();
  }
})();