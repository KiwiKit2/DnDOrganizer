// Events Management System
(function() {
  let events = JSON.parse(localStorage.getItem('events') || '[]');
  let currentEvent = null;
  let isEditing = false;

  // Initialize events system
  function initEvents() {
    if (events.length === 0) {
      // Add some sample events
      events = [
        {
          id: Date.now() + '_1',
          name: 'Goblin Ambush',
          type: 'combat',
          difficulty: 'moderate',
          duration: '30 minutes',
          description: 'A band of goblins attacks the party from the roadside bushes.',
          setup: 'Place 4 goblins behind cover. Roll initiative. Goblins use hit-and-run tactics.',
          tags: ['combat', 'ambush', 'outdoors', 'low-level'],
          rewards: '100 XP each, 2d6 gold pieces, crude weapons',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_2',
          name: 'Mysterious Merchant',
          type: 'social',
          difficulty: 'easy',
          duration: '15 minutes',
          description: 'A traveling merchant offers rare items but seems suspicious.',
          setup: 'Determine merchant\'s true motives. Prepare prices for items. Set DC for Insight checks.',
          tags: ['social', 'roleplay', 'merchant', 'intrigue'],
          rewards: 'Information, magic items, potential plot hooks',
          created: new Date().toISOString()
        },
        {
          id: Date.now() + '_3',
          name: 'Ancient Riddle Door',
          type: 'puzzle',
          difficulty: 'hard',
          duration: '20 minutes',
          description: 'An ancient door blocks the way, sealed with a complex riddle.',
          setup: 'Prepare riddle and alternative solutions. Set consequences for wrong answers.',
          tags: ['puzzle', 'dungeon', 'ancient', 'riddle'],
          rewards: '200 XP each, access to treasure chamber',
          created: new Date().toISOString()
        }
      ];
      saveEvents();
    }
    bindEvents();
    renderEvents();
  }

  // Save events to localStorage
  function saveEvents() {
    localStorage.setItem('events', JSON.stringify(events));
  }

  // Bind event listeners
  function bindEvents() {
    const addBtn = document.getElementById('addEventBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => openEventModal());
    }

    const searchInput = document.getElementById('eventSearch');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(renderEvents, 300));
    }

    const clearBtn = document.getElementById('clearEventSearchBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        document.getElementById('eventSearch').value = '';
        renderEvents();
      });
    }

    ['showCombatEvents', 'showSocialEvents', 'showExplorationEvents', 'showPuzzleEvents', 'showStoryEvents', 'showRandomEvents'].forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', renderEvents);
      }
    });

    const sortSelect = document.getElementById('sortEventsSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', renderEvents);
    }

    // Modal events
    const modal = document.getElementById('eventModal');
    const closeBtn = document.getElementById('closeEventModal');
    const cancelBtn = document.getElementById('cancelEventBtn');
    const form = document.getElementById('eventForm');
    const deleteBtn = document.getElementById('deleteEventBtn');

    if (closeBtn) closeBtn.addEventListener('click', closeEventModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeEventModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeEventModal();
      });
    }
    if (form) form.addEventListener('submit', saveEvent);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteEvent);
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

  function renderEvents() {
    const grid = document.getElementById('eventsGrid');
    if (!grid) return;

    const searchTerm = document.getElementById('eventSearch')?.value.toLowerCase() || '';
    const showCombat = document.getElementById('showCombatEvents')?.checked ?? true;
    const showSocial = document.getElementById('showSocialEvents')?.checked ?? true;
    const showExploration = document.getElementById('showExplorationEvents')?.checked ?? true;
    const showPuzzle = document.getElementById('showPuzzleEvents')?.checked ?? true;
    const showStory = document.getElementById('showStoryEvents')?.checked ?? true;
    const showRandom = document.getElementById('showRandomEvents')?.checked ?? true;
    const sortBy = document.getElementById('sortEventsSelect')?.value || 'name';

    let filteredEvents = events.filter(event => {
      if (searchTerm) {
        const searchableText = `${event.name} ${event.type} ${event.description} ${event.tags.join(' ')}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      const typeMap = {
        combat: showCombat,
        social: showSocial,
        exploration: showExploration,
        puzzle: showPuzzle,
        story: showStory,
        random: showRandom
      };

      return typeMap[event.type] ?? true;
    });

    filteredEvents.sort((a, b) => {
      switch (sortBy) {
        case 'type':
          return a.type.localeCompare(b.type);
        case 'difficulty':
          const difficultyOrder = { trivial: 0, easy: 1, moderate: 2, hard: 3, deadly: 4 };
          return (difficultyOrder[a.difficulty] || 0) - (difficultyOrder[b.difficulty] || 0);
        case 'created':
          return new Date(b.created) - new Date(a.created);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    grid.innerHTML = '';
    
    if (filteredEvents.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">
          <h3>No events found</h3>
          <p>Try adjusting your filters or search terms.</p>
        </div>
      `;
      return;
    }

    filteredEvents.forEach(event => {
      const card = createEventCard(event);
      grid.appendChild(card);
    });
  }

  function createEventCard(event) {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.addEventListener('click', () => openEventModal(event));

    const tags = event.tags.map(tag => `<span class="entity-tag">${tag}</span>`).join('');
    const difficultyColors = {
      trivial: '#6b7280',
      easy: '#10b981',
      moderate: '#3b82f6',
      hard: '#8b5cf6',
      deadly: '#ef4444'
    };
    
    card.innerHTML = `
      <div class="entity-card-header">
        <h3 class="entity-name">${event.name}</h3>
        <span class="entity-type">${event.type}</span>
      </div>
      
      <p class="entity-description">${event.description || 'No description available.'}</p>
      
      <div class="entity-tags">${tags}</div>
      
      <div class="entity-meta">
        <span class="entity-value">${event.duration || 'No duration set'}</span>
        <span class="entity-rarity" style="color: ${difficultyColors[event.difficulty] || '#6b7280'}">${event.difficulty}</span>
      </div>
    `;

    return card;
  }

  function openEventModal(event = null) {
    const modal = document.getElementById('eventModal');
    const title = document.getElementById('eventModalTitle');
    const deleteBtn = document.getElementById('deleteEventBtn');
    
    currentEvent = event;
    isEditing = !!event;

    if (isEditing) {
      title.textContent = 'Edit Event';
      deleteBtn.classList.remove('hidden');
      populateForm(event);
    } else {
      title.textContent = 'Add New Event';
      deleteBtn.classList.add('hidden');
      clearForm();
    }

    modal.classList.remove('hidden');
  }

  function closeEventModal() {
    const modal = document.getElementById('eventModal');
    modal.classList.add('hidden');
    currentEvent = null;
    isEditing = false;
  }

  function populateForm(event) {
    document.getElementById('eventName').value = event.name || '';
    document.getElementById('eventType').value = event.type || '';
    document.getElementById('eventDifficulty').value = event.difficulty || 'moderate';
    document.getElementById('eventDuration').value = event.duration || '';
    document.getElementById('eventDescription').value = event.description || '';
    document.getElementById('eventSetup').value = event.setup || '';
    document.getElementById('eventTags').value = event.tags ? event.tags.join(', ') : '';
    document.getElementById('eventRewards').value = event.rewards || '';
  }

  function clearForm() {
    document.getElementById('eventForm').reset();
  }

  function saveEvent(e) {
    e.preventDefault();
    
    const formData = {
      name: document.getElementById('eventName').value.trim(),
      type: document.getElementById('eventType').value,
      difficulty: document.getElementById('eventDifficulty').value,
      duration: document.getElementById('eventDuration').value.trim(),
      description: document.getElementById('eventDescription').value.trim(),
      setup: document.getElementById('eventSetup').value.trim(),
      tags: document.getElementById('eventTags').value.split(',').map(tag => tag.trim()).filter(tag => tag),
      rewards: document.getElementById('eventRewards').value.trim()
    };

    if (!formData.name || !formData.type) {
      alert('Please fill in all required fields');
      return;
    }

    if (isEditing && currentEvent) {
      const index = events.findIndex(event => event.id === currentEvent.id);
      if (index !== -1) {
        events[index] = { ...events[index], ...formData, updated: new Date().toISOString() };
      }
    } else {
      const newEvent = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        ...formData,
        created: new Date().toISOString()
      };
      events.push(newEvent);
    }

    saveEvents();
    renderEvents();
    closeEventModal();
    
    // Cloud sync
    if (window.userDocRef) {
      const eventToSync = isEditing && currentEvent ? 
        events.find(event => event.id === currentEvent.id) : 
        events[events.length - 1];
      if (eventToSync) {
        window.userDocRef.collection('events').doc(eventToSync.id).set(eventToSync)
          .catch(err => console.error('Failed to sync event to cloud:', err));
      }
    }
  }

  function deleteEvent() {
    if (!currentEvent || !confirm('Are you sure you want to delete this event?')) {
      return;
    }

    const eventId = currentEvent.id;
    events = events.filter(event => event.id !== currentEvent.id);
    saveEvents();
    renderEvents();
    closeEventModal();
    
    // Cloud sync
    if (window.userDocRef) {
      window.userDocRef.collection('events').doc(eventId).delete()
        .catch(err => console.error('Failed to delete event from cloud:', err));
    }
  }

  // Export for global access
  window.EventsManager = {
    init: initEvents,
    getEvents: () => events,
    addEvent: (event) => {
      events.push({ ...event, id: Date.now() + '_' + Math.random().toString(36).substr(2, 9), created: new Date().toISOString() });
      saveEvents();
      renderEvents();
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEvents);
  } else {
    initEvents();
  }
})();