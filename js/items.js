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
          description: 'A magical sword that ignites with flames when activated, dealing extra fire damage.',
          tags: ['!weapon', 'magic', 'fire', 'rare'],
          image: '',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_2',
          name: 'Potion of Greater Healing',
          description: 'A potent healing potion that restores 4d4+4 hit points when consumed.',
          tags: ['!potion', 'healing', '!consumable', 'uncommon'],
          image: '',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_3',
          name: 'Studded Leather Armor +1',
          description: 'Enhanced leather armor reinforced with metal studs, providing AC 12 + Dex modifier + 1.',
          tags: ['!armor', 'protection', 'light', 'magic'],
          image: '',
          created: new Date().toISOString()
        }
      ];
      saveItems();
    }
    buildTagFilters();
    bindEvents();
    renderItems();
  }

  // Build dynamic tag filter checkboxes
  function buildTagFilters() {
    const tagFiltersContainer = document.getElementById('itemTagFilters');
    if (!tagFiltersContainer) return;

    // Collect all unique tags from all items
    const allTags = new Set();
    items.forEach(item => {
      item.tags.forEach(tag => allTags.add(tag));
    });

    // Sort tags alphabetically
    const sortedTags = Array.from(allTags).sort();

    // Build checkboxes
    tagFiltersContainer.innerHTML = '';
    sortedTags.forEach(tag => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.className = 'tag-filter-checkbox';
      checkbox.dataset.tag = tag;
      checkbox.addEventListener('change', renderItems);
      
      const displayText = tag.startsWith('!') ? tag.substring(1).toUpperCase() : tag;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(' ' + displayText));
      
      tagFiltersContainer.appendChild(label);
    });
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
    const sortBy = document.getElementById('sortItemsSelect')?.value || 'name';

    // Get selected tags from checkboxes
    const selectedTags = new Set();
    document.querySelectorAll('.tag-filter-checkbox:checked').forEach(checkbox => {
      selectedTags.add(checkbox.dataset.tag);
    });

    let filteredItems = items.filter(item => {
      // Search filter
      if (searchTerm) {
        const searchableText = `${item.name} ${item.description} ${item.tags.join(' ')}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      // Tag filter - item must have at least one selected tag
      if (selectedTags.size > 0) {
        const hasSelectedTag = item.tags.some(tag => selectedTags.has(tag));
        if (!hasSelectedTag) return false;
      }

      return true;
    });

    filteredItems.sort((a, b) => {
      switch (sortBy) {
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

    // Separate special tags (starting with !) from regular tags
    const specialTags = item.tags.filter(tag => tag.startsWith('!'));
    const regularTags = item.tags.filter(tag => !tag.startsWith('!'));
    
    const regularTagsHtml = regularTags.map(tag => `<span class="entity-tag">${tag}</span>`).join('');
    const specialBadgesHtml = specialTags.map(tag => {
      const badgeText = tag.substring(1).toUpperCase(); // Remove ! and uppercase
      return `<span class="entity-type-badge">${badgeText}</span>`;
    }).join('');
    
    card.innerHTML = `
      ${specialBadgesHtml}
      <div class="entity-card-header">
        <h3 class="entity-name">${item.name}</h3>
      </div>
      
      <p class="entity-description">${item.description || 'No description available.'}</p>
      
      <div class="entity-tags">${regularTagsHtml}</div>
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
    document.getElementById('itemDescription').value = item.description || '';
    document.getElementById('itemTags').value = item.tags ? item.tags.join(', ') : '';
    document.getElementById('itemImage').value = item.image || '';
  }

  function clearForm() {
    document.getElementById('itemForm').reset();
  }

  function saveItem(e) {
    e.preventDefault();
    
    const formData = {
      name: document.getElementById('itemName').value.trim(),
      description: document.getElementById('itemDescription').value.trim(),
      tags: document.getElementById('itemTags').value.split(',').map(tag => tag.trim()).filter(tag => tag),
      image: document.getElementById('itemImage').value.trim()
    };

    if (!formData.name) {
      alert('Please fill in the name field');
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
    buildTagFilters();
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
    buildTagFilters();
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