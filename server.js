const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 3000;
const cssPath = path.join(__dirname, 'style.css');

const server = http.createServer((req, res) => {
  if (req.url === '/style.css') {
    fs.readFile(cssPath, 'utf8', (err, css) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Failed to load CSS');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(css);
    });

    return;
  }

  const dashboardHtml = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Simple Dashboard</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <div class="card">
      <div class="header">Dashboard</div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Last Seen</th>
            <th>Last Update</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Device A</td>
            <td>2026-03-08 13:20</td>
            <td>2026-03-08 13:30</td>
          </tr>
        </tbody>
      </table>
    </div>
  </body>
</html>
`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHtml);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
