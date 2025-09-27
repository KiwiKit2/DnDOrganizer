// Conditions Management System
(function() {
  let conditions = JSON.parse(localStorage.getItem('conditions') || '[]');
  let currentCondition = null;
  let isEditing = false;

  // Initialize conditions system
  function initConditions() {
    if (conditions.length === 0) {
      // Add some sample conditions
      conditions = [
        {
          id: Date.now() + '_1',
          name: 'Poisoned',
          type: 'debuff',
          severity: 'moderate',
          duration: '1 minute',
          description: 'A poisoned creature has disadvantage on attack rolls and ability checks.',
          effects: 'Disadvantage on attack rolls and ability checks',
          tags: ['debuff', 'poison', 'status'],
          removal: 'Lesser restoration, immunity to poison, or the condition ends naturally',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_2',
          name: 'Blessed',
          type: 'buff',
          severity: 'minor',
          duration: '1 minute',
          description: 'A blessed creature gains a bonus to attack rolls and saving throws.',
          effects: '+1d4 to attack rolls and saving throws',
          tags: ['buff', 'divine', 'beneficial'],
          removal: 'Dispel magic or the spell duration ends',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_3',
          name: 'Paralyzed',
          type: 'debuff',
          severity: 'severe',
          duration: 'Until saved',
          description: 'A paralyzed creature is incapacitated and cannot move or speak.',
          effects: 'Incapacitated, cannot move or speak, fails Strength and Dexterity saves, attacks have advantage and auto-crit within 5 feet',
          tags: ['debuff', 'paralysis', 'incapacitated'],
          removal: 'Greater restoration, save ends, or immunity to paralysis',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_4',
          name: 'Charmed',
          type: 'status',
          severity: 'moderate',
          duration: 'Varies',
          description: 'A charmed creature cannot attack the charmer and the charmer has advantage on social interactions.',
          effects: 'Cannot attack the charmer or target them with harmful abilities/spells',
          tags: ['charm', 'mind-control', 'social'],
          removal: 'Damage to the charmed creature, calm emotions, or spell duration',
          created: new Date().toISOString()
        }
      ];
      saveConditions();
    }
    bindEvents();
    renderConditions();
  }

  // Save conditions to localStorage
  function saveConditions() {
    localStorage.setItem('conditions', JSON.stringify(conditions));
  }

  // Bind event listeners
  function bindEvents() {
    const addBtn = document.getElementById('addConditionBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => openConditionModal());
    }

    const searchInput = document.getElementById('conditionSearch');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(renderConditions, 300));
    }

    const clearBtn = document.getElementById('clearConditionSearchBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        document.getElementById('conditionSearch').value = '';
        renderConditions();
      });
    }

    ['showDebuffConditions', 'showBuffConditions', 'showStatusConditions', 'showMagicalConditions', 'showPhysicalConditions', 'showOtherConditions'].forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', renderConditions);
      }
    });

    const sortSelect = document.getElementById('sortConditionsSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', renderConditions);
    }

    // Modal events
    const modal = document.getElementById('conditionModal');
    const closeBtn = document.getElementById('closeConditionModal');
    const cancelBtn = document.getElementById('cancelConditionBtn');
    const form = document.getElementById('conditionForm');
    const deleteBtn = document.getElementById('deleteConditionBtn');

    if (closeBtn) closeBtn.addEventListener('click', closeConditionModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeConditionModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeConditionModal();
      });
    }
    if (form) form.addEventListener('submit', saveCondition);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteCondition);
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

  function renderConditions() {
    const grid = document.getElementById('conditionsGrid');
    if (!grid) return;

    const searchTerm = document.getElementById('conditionSearch')?.value.toLowerCase() || '';
    const showDebuff = document.getElementById('showDebuffConditions')?.checked ?? true;
    const showBuff = document.getElementById('showBuffConditions')?.checked ?? true;
    const showStatus = document.getElementById('showStatusConditions')?.checked ?? true;
    const showMagical = document.getElementById('showMagicalConditions')?.checked ?? true;
    const showPhysical = document.getElementById('showPhysicalConditions')?.checked ?? true;
    const showOther = document.getElementById('showOtherConditions')?.checked ?? true;
    const sortBy = document.getElementById('sortConditionsSelect')?.value || 'name';

    let filteredConditions = conditions.filter(condition => {
      if (searchTerm) {
        const searchableText = `${condition.name} ${condition.type} ${condition.description} ${condition.effects} ${condition.tags.join(' ')}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      const typeMap = {
        debuff: showDebuff,
        buff: showBuff,
        status: showStatus,
        magical: showMagical,
        physical: showPhysical,
        other: showOther
      };

      return typeMap[condition.type] ?? showOther;
    });

    filteredConditions.sort((a, b) => {
      switch (sortBy) {
        case 'type':
          return a.type.localeCompare(b.type);
        case 'severity':
          const severityOrder = { minor: 0, moderate: 1, major: 2, severe: 3, critical: 4 };
          return (severityOrder[a.severity] || 0) - (severityOrder[b.severity] || 0);
        case 'created':
          return new Date(b.created) - new Date(a.created);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    grid.innerHTML = '';
    
    if (filteredConditions.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">
          <h3>No conditions found</h3>
          <p>Try adjusting your filters or search terms.</p>
        </div>
      `;
      return;
    }

    filteredConditions.forEach(condition => {
      const card = createConditionCard(condition);
      grid.appendChild(card);
    });
  }

  function createConditionCard(condition) {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.addEventListener('click', () => openConditionModal(condition));

    const tags = condition.tags.map(tag => `<span class="entity-tag">${tag}</span>`).join('');
    const severityColors = {
      minor: '#10b981',
      moderate: '#3b82f6',
      major: '#8b5cf6',
      severe: '#f59e0b',
      critical: '#ef4444'
    };

    const typeColors = {
      buff: '#10b981',
      debuff: '#ef4444',
      status: '#3b82f6',
      magical: '#8b5cf6',
      physical: '#f59e0b',
      other: '#6b7280'
    };
    
    card.innerHTML = `
      <div class="entity-card-header">
        <h3 class="entity-name">${condition.name}</h3>
        <span class="entity-type" style="background: ${typeColors[condition.type] || '#6b7280'}">${condition.type}</span>
      </div>
      
      <p class="entity-description">${condition.description || 'No description available.'}</p>
      
      <div class="entity-tags">${tags}</div>
      
      <div class="entity-meta">
        <span class="entity-value">${condition.duration || 'No duration set'}</span>
        <span class="entity-rarity" style="color: ${severityColors[condition.severity] || '#6b7280'}">${condition.severity}</span>
      </div>
    `;

    return card;
  }

  function openConditionModal(condition = null) {
    const modal = document.getElementById('conditionModal');
    const title = document.getElementById('conditionModalTitle');
    const deleteBtn = document.getElementById('deleteConditionBtn');
    
    currentCondition = condition;
    isEditing = !!condition;

    if (isEditing) {
      title.textContent = 'Edit Condition';
      deleteBtn.classList.remove('hidden');
      populateForm(condition);
    } else {
      title.textContent = 'Add New Condition';
      deleteBtn.classList.add('hidden');
      clearForm();
    }

    modal.classList.remove('hidden');
  }

  function closeConditionModal() {
    const modal = document.getElementById('conditionModal');
    modal.classList.add('hidden');
    currentCondition = null;
    isEditing = false;
  }

  function populateForm(condition) {
    document.getElementById('conditionName').value = condition.name || '';
    document.getElementById('conditionType').value = condition.type || '';
    document.getElementById('conditionSeverity').value = condition.severity || 'moderate';
    document.getElementById('conditionDuration').value = condition.duration || '';
    document.getElementById('conditionDescription').value = condition.description || '';
    document.getElementById('conditionEffects').value = condition.effects || '';
    document.getElementById('conditionTags').value = condition.tags ? condition.tags.join(', ') : '';
    document.getElementById('conditionRemoval').value = condition.removal || '';
  }

  function clearForm() {
    document.getElementById('conditionForm').reset();
  }

  function saveCondition(e) {
    e.preventDefault();
    
    const formData = {
      name: document.getElementById('conditionName').value.trim(),
      type: document.getElementById('conditionType').value,
      severity: document.getElementById('conditionSeverity').value,
      duration: document.getElementById('conditionDuration').value.trim(),
      description: document.getElementById('conditionDescription').value.trim(),
      effects: document.getElementById('conditionEffects').value.trim(),
      tags: document.getElementById('conditionTags').value.split(',').map(tag => tag.trim()).filter(tag => tag),
      removal: document.getElementById('conditionRemoval').value.trim()
    };

    if (!formData.name || !formData.type) {
      alert('Please fill in all required fields');
      return;
    }

    if (isEditing && currentCondition) {
      const index = conditions.findIndex(condition => condition.id === currentCondition.id);
      if (index !== -1) {
        conditions[index] = { ...conditions[index], ...formData, updated: new Date().toISOString() };
      }
    } else {
      const newCondition = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        ...formData,
        created: new Date().toISOString()
      };
      conditions.push(newCondition);
    }

    saveConditions();
    renderConditions();
    closeConditionModal();
    
    // Cloud sync
    if (window.userDocRef) {
      const conditionToSync = isEditing && currentCondition ? 
        conditions.find(condition => condition.id === currentCondition.id) : 
        conditions[conditions.length - 1];
      if (conditionToSync) {
        window.userDocRef.collection('conditions').doc(conditionToSync.id).set(conditionToSync)
          .catch(err => console.error('Failed to sync condition to cloud:', err));
      }
    }
  }

  function deleteCondition() {
    if (!currentCondition || !confirm('Are you sure you want to delete this condition?')) {
      return;
    }

    const conditionId = currentCondition.id;
    conditions = conditions.filter(condition => condition.id !== currentCondition.id);
    saveConditions();
    renderConditions();
    closeConditionModal();
    
    // Cloud sync
    if (window.userDocRef) {
      window.userDocRef.collection('conditions').doc(conditionId).delete()
        .catch(err => console.error('Failed to delete condition from cloud:', err));
    }
  }

  // Export for global access
  window.ConditionsManager = {
    init: initConditions,
    getConditions: () => conditions,
    addCondition: (condition) => {
      conditions.push({ ...condition, id: Date.now() + '_' + Math.random().toString(36).substr(2, 9), created: new Date().toISOString() });
      saveConditions();
      renderConditions();
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConditions);
  } else {
    initConditions();
  }
})();