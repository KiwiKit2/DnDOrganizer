// Excel Integration for Character Data
(function() {
  
  // Character Excel format mapping
  const EXCEL_CHARACTER_MAPPING = {
    // Basic info
    'Name': 'name',
    'IMG': 'image',
    'Description': 'description',
    
    // Augurio Mode stats
    'ATK': 'atk',
    'DEF': 'def', 
    'DEM': 'dem',
    'VEL': 'vel',
    'VID': 'vid',
    'PRE': 'pre',
    'EVA': 'eva',
    'PAS': 'pas',
    'SUE': 'sue',
    'FZA': 'fza',
    'CON': 'con',
    'INT': 'int',
    'SAG': 'sag',
    'AGI': 'agi',
    'CRM': 'crm',
    'DST': 'dst',
    'VIT': 'vit',
    'ETK': 'etk',
    'EAC': 'eac',
    'EST': 'est',
    'ESP': 'esp',
    
    // Additional fields
    'Hands': 'hands',
    'Equip': 'equip',
    'Store': 'store',
    'Moves': 'moves'
  };

  // Initialize Excel integration
  function initExcelIntegration() {
    // Add Excel import/export buttons to character section
    addCharacterExcelButtons();
    bindExcelEvents();
  }

  // Add Excel buttons to character section
  function addCharacterExcelButtons() {
    const characterHeader = document.querySelector('#view-character .character-header');
    if (!characterHeader) {
      // Try to find a suitable place in the character view
      const characterView = document.querySelector('#view-character');
      if (characterView) {
        const header = document.createElement('div');
        header.className = 'character-excel-controls';
        header.style.cssText = 'margin-bottom: 1rem; text-align: right;';
        
        header.innerHTML = `
          <button id="importCharacterExcel" class="secondary-btn" style="margin-right: 0.5rem;">
            📊 Import from Excel
          </button>
          <button id="exportCharacterExcel" class="secondary-btn">
            📤 Export to Excel
          </button>
        `;
        
        characterView.insertBefore(header, characterView.firstChild);
      }
    }
  }

  // Bind Excel-related events
  function bindExcelEvents() {
    // Character Excel import
    const importCharBtn = document.getElementById('importCharacterExcel');
    if (importCharBtn) {
      importCharBtn.addEventListener('click', importCharacterFromExcel);
    }

    // Character Excel export
    const exportCharBtn = document.getElementById('exportCharacterExcel');
    if (exportCharBtn) {
      exportCharBtn.addEventListener('click', exportCharacterToExcel);
    }
  }

  // Import character from Excel
  function importCharacterFromExcel() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.addEventListener('change', handleCharacterExcelImport);
    input.click();
  }

  // Handle character Excel import
  function handleCharacterExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Use first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          toast('No data found in Excel file');
          return;
        }

        // Process first row as character data
        const excelRow = jsonData[0];
        const characterData = convertExcelToCharacter(excelRow);
        
        // Apply to current character
        applyCharacterData(characterData);
        
        toast(`Character data imported from Excel: ${characterData.name || 'Unnamed'}`);
        
      } catch (error) {
        console.error('Excel import error:', error);
        toast('Error reading Excel file: ' + error.message);
      }
    };
    
    reader.readAsArrayBuffer(file);
  }

  // Convert Excel row to character data
  function convertExcelToCharacter(excelRow) {
    const characterData = {
      augurio: {}
    };

    // Map Excel columns to character properties
    Object.entries(EXCEL_CHARACTER_MAPPING).forEach(([excelCol, charProp]) => {
      const value = excelRow[excelCol];
      if (value !== undefined && value !== null && value !== '') {
        // Check if it's an Augurio stat
        const augurioStats = ['atk', 'def', 'dem', 'vel', 'vid', 'pre', 'eva', 'pas', 'sue', 'fza', 'con', 'int', 'sag', 'agi', 'crm', 'dst', 'vit', 'etk', 'eac', 'est', 'esp'];
        
        if (augurioStats.includes(charProp)) {
          characterData.augurio[charProp] = parseInt(value) || 0;
        } else {
          characterData[charProp] = value;
        }
      }
    });

    return characterData;
  }

  // Apply character data to the current character
  function applyCharacterData(characterData) {
    // Update basic character info
    if (characterData.name) {
      const nameInput = document.getElementById('charName');
      if (nameInput) nameInput.value = characterData.name;
      if (charProfile) charProfile.name = characterData.name;
    }

    if (characterData.description) {
      const descInput = document.getElementById('charBackstory');
      if (descInput) descInput.value = characterData.description;
      if (charProfile) charProfile.backstory = characterData.description;
    }

    // Update Augurio mode stats
    if (characterData.augurio && Object.keys(characterData.augurio).length > 0) {
      // Switch to Augurio mode if not already
      if (window.characterMode !== 'augurio') {
        if (window.switchCharacterMode) {
          window.switchCharacterMode('augurio');
        }
      }

      // Update Augurio stats
      Object.entries(characterData.augurio).forEach(([stat, value]) => {
        const input = document.getElementById(`augurio-${stat}`);
        if (input) {
          input.value = value;
        }
        
        // Update charProfile if available
        if (charProfile && charProfile.augurio) {
          charProfile.augurio[stat] = value;
        }
      });
    }

    // Handle additional fields
    if (characterData.moves) {
      // Could integrate with moves system
      console.log('Moves from Excel:', characterData.moves);
    }

    // Save character data
    if (window.saveChar) {
      window.saveChar();
    }
  }

  // Export character to Excel
  function exportCharacterToExcel() {
    try {
      const characterData = getCurrentCharacterData();
      const excelData = convertCharacterToExcel(characterData);
      
      // Create workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet([excelData]);
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Character');
      
      // Generate filename
      const characterName = characterData.name || 'Character';
      const filename = `${characterName.replace(/[^a-zA-Z0-9]/g, '_')}_augurio.xlsx`;
      
      // Download file
      XLSX.writeFile(workbook, filename);
      
      toast(`Character exported to ${filename}`);
      
    } catch (error) {
      console.error('Excel export error:', error);
      toast('Error exporting to Excel: ' + error.message);
    }
  }

  // Get current character data
  function getCurrentCharacterData() {
    const data = {
      name: '',
      description: '',
      augurio: {},
      additional: {}
    };

    // Get name
    const nameInput = document.getElementById('charName');
    if (nameInput) data.name = nameInput.value;

    // Get description/backstory
    const descInput = document.getElementById('charBackstory');
    if (descInput) data.description = descInput.value;

    // Get Augurio stats
    const augurioStats = ['atk', 'def', 'dem', 'vel', 'vid', 'pre', 'eva', 'pas', 'sue', 'fza', 'con', 'int', 'sag', 'agi', 'crm', 'dst', 'vit', 'etk', 'eac', 'est', 'esp'];
    
    augurioStats.forEach(stat => {
      const input = document.getElementById(`augurio-${stat}`);
      if (input) {
        data.augurio[stat] = parseInt(input.value) || 0;
      }
    });

    // Get from charProfile if available
    if (window.charProfile) {
      data.name = data.name || window.charProfile.name || '';
      data.description = data.description || window.charProfile.backstory || '';
      
      if (window.charProfile.augurio) {
        Object.assign(data.augurio, window.charProfile.augurio);
      }
    }

    return data;
  }

  // Convert character data to Excel format
  function convertCharacterToExcel(characterData) {
    const excelRow = {};

    // Map character properties to Excel columns
    Object.entries(EXCEL_CHARACTER_MAPPING).forEach(([excelCol, charProp]) => {
      let value = '';

      // Check if it's an Augurio stat
      const augurioStats = ['atk', 'def', 'dem', 'vel', 'vid', 'pre', 'eva', 'pas', 'sue', 'fza', 'con', 'int', 'sag', 'agi', 'crm', 'dst', 'vit', 'etk', 'eac', 'est', 'esp'];
      
      if (augurioStats.includes(charProp)) {
        value = characterData.augurio[charProp] || 0;
      } else {
        value = characterData[charProp] || '';
      }

      excelRow[excelCol] = value;
    });

    return excelRow;
  }

  // Enhanced Entities Excel Integration
  function exportEntitiesToExcel() {
    try {
      const entities = JSON.parse(localStorage.getItem('entities') || '[]');
      
      if (entities.length === 0) {
        toast('No entities to export');
        return;
      }

      // Convert entities to Excel format
      const excelData = entities.map(entity => ({
        'Name': entity.name,
        'Type': entity.type,
        'Description': entity.description,
        'Tags': entity.tags.join(', '),
        'Value (gp)': entity.value || 0,
        'Weight (lbs)': entity.weight || 0,
        'Rarity': entity.rarity,
        'Image URL': entity.image || '',
        'Created': entity.created
      }));

      // Create workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      
      // Auto-size columns
      const colWidths = [
        { wch: 20 }, // Name
        { wch: 15 }, // Type
        { wch: 40 }, // Description
        { wch: 20 }, // Tags
        { wch: 10 }, // Value
        { wch: 10 }, // Weight
        { wch: 12 }, // Rarity
        { wch: 30 }, // Image URL
        { wch: 20 }  // Created
      ];
      worksheet['!cols'] = colWidths;
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Entities');
      
      // Download file
      const filename = `entities_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, filename);
      
      toast(`${entities.length} entities exported to ${filename}`);
      
    } catch (error) {
      console.error('Entities Excel export error:', error);
      toast('Error exporting entities to Excel: ' + error.message);
    }
  }

  // Import entities from Excel
  function importEntitiesFromExcel() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.addEventListener('change', handleEntitiesExcelImport);
    input.click();
  }

  // Handle entities Excel import
  function handleEntitiesExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Use first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          toast('No data found in Excel file');
          return;
        }

        // Convert Excel data to entities
        const importedEntities = jsonData.map(row => convertExcelToEntity(row)).filter(entity => entity.name);
        
        if (importedEntities.length === 0) {
          toast('No valid entities found in Excel file');
          return;
        }

        // Get existing entities
        const existingEntities = JSON.parse(localStorage.getItem('entities') || '[]');
        
        // Merge with imported entities
        const mergedEntities = [...existingEntities, ...importedEntities];
        
        // Save to localStorage
        localStorage.setItem('entities', JSON.stringify(mergedEntities));
        
        // Refresh entities view if active
        if (window.entitiesSystem && window.entitiesSystem.renderEntities) {
          window.entitiesSystem.renderEntities();
        }
        
        toast(`${importedEntities.length} entities imported from Excel`);
        
      } catch (error) {
        console.error('Entities Excel import error:', error);
        toast('Error reading Excel file: ' + error.message);
      }
    };
    
    reader.readAsArrayBuffer(file);
  }

  // Convert Excel row to entity
  function convertExcelToEntity(excelRow) {
    const entity = {
      id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      name: excelRow['Name'] || '',
      type: (excelRow['Type'] || 'other').toLowerCase(),
      description: excelRow['Description'] || '',
      tags: (excelRow['Tags'] || '').split(',').map(tag => tag.trim()).filter(tag => tag),
      value: parseFloat(excelRow['Value (gp)']) || 0,
      weight: parseFloat(excelRow['Weight (lbs)']) || 0,
      rarity: (excelRow['Rarity'] || 'common').toLowerCase(),
      image: excelRow['Image URL'] || '',
      created: new Date().toISOString()
    };

    return entity;
  }

  // Override entities export function
  function enhanceEntitiesExport() {
    // Find and update entities export button
    const exportBtn = document.getElementById('exportExcelBtn');
    if (exportBtn) {
      exportBtn.removeEventListener('click', exportBtn._originalHandler);
      exportBtn.addEventListener('click', exportEntitiesToExcel);
    }

    // Find and update entities import button
    const importBtn = document.getElementById('importExcelBtn');
    if (importBtn) {
      importBtn.removeEventListener('click', importBtn._originalHandler);
      importBtn.addEventListener('click', importEntitiesFromExcel);
    }
  }

  // Toast notification function
  function toast(message) {
    if (window.toast) {
      window.toast(message);
    } else {
      console.log('Toast:', message);
    }
  }

  // Initialize Excel integration
  function init() {
    // Wait for DOM and other scripts to load
    setTimeout(() => {
      initExcelIntegration();
      enhanceEntitiesExport();
    }, 1000);
  }

  // Initialize when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose functions globally
  window.excelIntegration = {
    exportCharacterToExcel,
    importCharacterFromExcel,
    exportEntitiesToExcel,
    importEntitiesFromExcel
  };

})();