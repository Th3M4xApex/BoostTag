const appShell = document.getElementById('app-shell');
const sidebarToggle = document.getElementById('sidebar-toggle');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const views = {
  dashboard: document.getElementById('view-dashboard'),
  settings: document.getElementById('view-settings')
};

const tbody = document.getElementById('items-body');
const scanButton = document.getElementById('scan-button');
const scanStatus = document.getElementById('scan-status');

const ITEM_NAME_OPTIONS = [
  'Cabernet Sauvignon',
  'Pinot Noir',
  'Merlot Reserve',
  'Chardonnay Classic',
  'Sauvignon Blanc',
  'Syrah Estate',
  'Malbec Select',
  'Riesling Dry',
  'Zinfandel Old Vine',
  'Rose Provence'
];

let itemsState = [];

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const setStatus = (message) => {
  scanStatus.textContent = message;
};

const renderRows = () => {
  if (!Array.isArray(itemsState) || itemsState.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No items found</td></tr>';
    return;
  }

  tbody.innerHTML = itemsState
    .map((item) => {
      const barcode = escapeHtml(item.barcode);
      const selectedName = item.name ?? '';
      const lastUpdate = escapeHtml(item.lastUpdate ?? 'Not scanned yet');

      const options = Array.from(new Set([...ITEM_NAME_OPTIONS, selectedName]))
        .map((option) => {
          const safeOption = escapeHtml(option);
          const selected = option === selectedName ? ' selected' : '';
          return '<option value="' + safeOption + '"' + selected + '>' + safeOption + '</option>';
        })
        .join('');

      const isEditing = item.isEditing ? '' : ' disabled';
      const editLabel = item.isEditing ? 'Save' : 'Edit';

      return (
        '<tr data-barcode="' + barcode + '">' +
        '<td>' + barcode + '</td>' +
        '<td><select class="name-select" data-barcode="' + barcode + '"' + isEditing + '>' + options + '</select></td>' +
        '<td>' + lastUpdate + '</td>' +
        '<td class="action-cell">' +
        '<button class="edit-btn" type="button" data-barcode="' + barcode + '">' + editLabel + '</button>' +
        '<button class="delete-btn" type="button" data-barcode="' + barcode + '">Delete</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
};

const loadItems = async () => {
  try {
    setStatus('Loading');
    const response = await fetch('/api/items');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load items');
    }

    itemsState = (payload.items || []).map((item) => ({
      barcode: item.barcode ?? '',
      name: item.name ?? '',
      lastUpdate: item.lastUpdate ?? 'Not scanned yet',
      isEditing: false
    }));

    renderRows();
    setStatus('Ready');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="4">' + escapeHtml(error.message) + '</td></tr>';
    setStatus('Load failed');
  }
};

scanButton.addEventListener('click', async () => {
  try {
    scanButton.disabled = true;
    setStatus('Scanning');

    const response = await fetch('/api/scan', { method: 'POST' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Scan failed');
    }

    const scannedByBarcode = new Map((payload.items || []).map((item) => [item.barcode, item]));
    itemsState = itemsState.map((item) => {
      const scanned = scannedByBarcode.get(item.barcode);
      if (!scanned) {
        return item;
      }

      return {
        ...item,
        lastUpdate: scanned.lastUpdate ?? item.lastUpdate
      };
    });

    renderRows();
    setStatus('Scan complete: ' + (payload.updatedCount ?? 0) + ' items updated');
  } catch (error) {
    setStatus('Scan failed: ' + error.message);
  } finally {
    scanButton.disabled = false;
  }
});

tbody.addEventListener('change', (event) => {
  const select = event.target.closest('.name-select');
  if (!select) {
    return;
  }

  const barcode = select.dataset.barcode;
  itemsState = itemsState.map((item) =>
    item.barcode === barcode
      ? {
          ...item,
          name: select.value
        }
      : item
  );
});

tbody.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('.delete-btn');
  if (deleteButton) {
    const barcode = deleteButton.dataset.barcode;
    try {
      deleteButton.disabled = true;
      setStatus('Deleting');

      const response = await fetch('/api/items/' + encodeURIComponent(barcode), {
        method: 'DELETE'
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete item');
      }

      itemsState = itemsState.filter((item) => item.barcode !== barcode);
      renderRows();
      setStatus('Item deleted');
    } catch (error) {
      setStatus('Delete failed: ' + error.message);
      deleteButton.disabled = false;
    }
    return;
  }

  const editButton = event.target.closest('.edit-btn');
  if (!editButton) {
    return;
  }

  const barcode = editButton.dataset.barcode;
  const targetItem = itemsState.find((item) => item.barcode === barcode);
  if (!targetItem) {
    return;
  }

  if (!targetItem.isEditing) {
    itemsState = itemsState.map((item) =>
      item.barcode === barcode
        ? {
            ...item,
            isEditing: true
          }
        : item
    );
    renderRows();
    return;
  }

  try {
    setStatus('Saving');
    editButton.disabled = true;

    const response = await fetch('/api/items/name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        barcode,
        name: targetItem.name
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to update item');
    }

    itemsState = itemsState.map((item) =>
      item.barcode === barcode
        ? {
            ...item,
            name: payload.item.name,
            isEditing: false
          }
        : item
    );

    renderRows();
    setStatus('Item updated');
  } catch (error) {
    setStatus('Update failed: ' + error.message);
    editButton.disabled = false;
  }
});

const setView = (viewName) => {
  Object.entries(views).forEach(([name, section]) => {
    section.classList.toggle('active', name === viewName);
  });

  navItems.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewName);
  });

  appShell.classList.remove('sidebar-open');
};

navItems.forEach((button) => {
  button.addEventListener('click', () => {
    setView(button.dataset.view);
  });
});

sidebarToggle.addEventListener('click', () => {
  appShell.classList.toggle('sidebar-open');
});

loadItems();
