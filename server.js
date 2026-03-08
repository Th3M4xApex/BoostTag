const fs = require('fs');
const http = require('http');
const path = require('path');
const proxy = require('./gateway/proxy');

const PORT = process.env.PORT || 3000;
const cssPath = path.join(__dirname, 'styling', 'style.css');

const serveFile = (res, filePath, contentType, errorMessage) => {
  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(errorMessage);
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/style.css') {
    serveFile(res, cssPath, 'text/css; charset=utf-8', 'Failed to load CSS');
    return;
  }

  if (req.method === 'GET' && req.url === '/api/items') {
    try {
      const items = await proxy.getHubData();
      sendJson(res, 200, { items });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }

    return;
  }

  if (req.method === 'POST' && req.url === '/api/scan') {
    try {
      const scanResult = await proxy.getHubData({ simulateScan: true });
      sendJson(res, 200, scanResult);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }

    return;
  }

  const dashboardHtml = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Asset Management Dashboard</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <div class="card">
      <div class="header">
        <span>Asset Management Dashboard</span>
        <div class="header-actions">
          <button id="scan-button" class="scan-btn" type="button">Scan</button>
          <span id="scan-status" class="scan-status"></span>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Last Location</th>
            <th>Last Update</th>
          </tr>
        </thead>
        <tbody id="items-body">
          <tr>
            <td colspan="3">Loading items...</td>
          </tr>
        </tbody>
      </table>
    </div>

    <script>
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
          tbody.innerHTML =
            '<tr><td colspan="3">' + escapeHtml(error.message) + '</td></tr>';
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

      loadItems();
    </script>
  </body>
</html>
`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHtml);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
