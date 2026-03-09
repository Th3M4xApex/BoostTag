const appShell = document.getElementById('app-shell');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const navItems = document.querySelectorAll('.nav-item');
const views = {
  dashboard: document.getElementById('view-dashboard'),
  settings: document.getElementById('view-settings')
};

const tbody = document.getElementById('items-body');
const scanButton = document.getElementById('scan-button');
const scanStatus = document.getElementById('scan-status');

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

const renderRows = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3">No items found</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map((item) => {
      const name = escapeHtml(item.name ?? '');
      const location = escapeHtml(item.lastLocation ?? '');
      const lastUpdate = escapeHtml(item.lastUpdate ?? 'Not scanned yet');
      return '<tr><td>' + name + '</td><td>' + location + '</td><td>' + lastUpdate + '</td></tr>';
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

    renderRows(payload.items);
    setStatus('Ready');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="3">' + escapeHtml(error.message) + '</td></tr>';
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

    renderRows(payload.items);
    setStatus('Scan complete: ' + (payload.updatedCount ?? 0) + ' items updated');
  } catch (error) {
    setStatus('Scan failed: ' + error.message);
  } finally {
    scanButton.disabled = false;
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
