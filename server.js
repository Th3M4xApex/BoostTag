const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const proxy = require('./gateway/proxy');

const PORT = process.env.PORT || 3000;
const cssPath = path.join(__dirname, 'styling', 'style.css');
const dashboardJsPath = path.join(__dirname, 'public', 'dashboard.js');
const loginHtmlPath = path.join(__dirname, 'views', 'login.html');
const dashboardHtmlPath = path.join(__dirname, 'views', 'dashboard.html');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-env';

const SESSION_TTL_SECONDS = 60 * 60 * 8;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

const loginAttempts = new Map();

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
};

const timingSafeEqual = (a, b) => {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
};

const parseCookies = (cookieHeader = '') => {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = part.slice(0, separatorIndex);
      const value = decodeURIComponent(part.slice(separatorIndex + 1));
      acc[key] = value;
      return acc;
    }, {});
};

const sign = (value) => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');

const createSessionToken = () => {
  const payload = {
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
    nonce: crypto.randomBytes(12).toString('hex')
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

const verifySessionToken = (token) => {
  if (!token || !token.includes('.')) {
    return false;
  }

  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = sign(encodedPayload);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > Number(payload.exp)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

const readFileUtf8 = (filePath) =>
  new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(content);
    });
  });

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', () => reject(new Error('Failed to read request body')));
  });

const readJsonBody = async (req) => {
  const rawBody = await readRequestBody(req);
  try {
    return JSON.parse(rawBody || '{}');
  } catch {
    throw new Error('Invalid JSON body');
  }
};

const buildCookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
};

const sendHtml = (res, statusCode, html, extraHeaders = {}) => {
  res.writeHead(statusCode, {
    ...securityHeaders,
    'Content-Type': 'text/html; charset=utf-8',
    ...extraHeaders
  });
  res.end(html);
};

const sendJson = (res, statusCode, payload, extraHeaders = {}) => {
  res.writeHead(statusCode, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
};

const sendText = (res, statusCode, message) => {
  res.writeHead(statusCode, {
    ...securityHeaders,
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end(message);
};

const redirect = (res, location, extraHeaders = {}) => {
  res.writeHead(302, {
    ...securityHeaders,
    Location: location,
    ...extraHeaders
  });
  res.end();
};

const serveStaticUtf8 = (res, filePath, contentType, errorMessage) => {
  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) {
      sendText(res, 500, errorMessage);
      return;
    }

    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': contentType
    });
    res.end(content);
  });
};

const checkRateLimit = (ip) => {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) {
    return { blocked: false };
  }

  if (record.blockedUntil && now < record.blockedUntil) {
    return { blocked: true };
  }

  if (now - record.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { blocked: false };
  }

  return { blocked: false };
};

const recordFailedAttempt = (ip) => {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now - record.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(ip, {
      count: 1,
      windowStart: now,
      blockedUntil: 0
    });
    return;
  }

  record.count += 1;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.blockedUntil = now + LOGIN_BLOCK_MS;
  }
};

const clearAttempts = (ip) => {
  loginAttempts.delete(ip);
};

const renderLoginPage = async ({ showError, csrfToken }) => {
  const loginTemplate = await readFileUtf8(loginHtmlPath);
  const errorHtml = showError ? '<p class="login-error">Invalid credentials or blocked attempt.</p>' : '';

  return loginTemplate
    .replace('{{LOGIN_ERROR}}', errorHtml)
    .replace('{{CSRF_TOKEN}}', csrfToken);
};

const isAuthenticated = (req) => {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySessionToken(cookies.session);
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const secureCookie = requestUrl.protocol === 'https:';

  if (req.method === 'GET' && requestUrl.pathname === '/style.css') {
    serveStaticUtf8(res, cssPath, 'text/css; charset=utf-8', 'Failed to load CSS');
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/dashboard.js') {
    serveStaticUtf8(
      res,
      dashboardJsPath,
      'application/javascript; charset=utf-8',
      'Failed to load dashboard.js'
    );
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/login') {
    if (isAuthenticated(req)) {
      redirect(res, '/');
      return;
    }

    const csrfToken = crypto.randomBytes(24).toString('hex');
    const showError = requestUrl.searchParams.get('error') === '1';

    try {
      const html = await renderLoginPage({ showError, csrfToken });
      sendHtml(res, 200, html, {
        'Set-Cookie': buildCookie('login_csrf', csrfToken, {
          maxAge: 300,
          secure: secureCookie
        })
      });
    } catch {
      sendText(res, 500, 'Failed to render login page');
    }

    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/login') {
    const ip = getClientIp(req);
    const rateStatus = checkRateLimit(ip);

    if (rateStatus.blocked) {
      redirect(res, '/login?error=1');
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const params = new URLSearchParams(rawBody);
      const username = params.get('username') || '';
      const password = params.get('password') || '';
      const csrf = params.get('csrf') || '';

      const cookies = parseCookies(req.headers.cookie || '');
      const csrfFromCookie = cookies.login_csrf || '';

      const validCsrf = csrfFromCookie && timingSafeEqual(csrfFromCookie, csrf);
      const validUser = timingSafeEqual(username, ADMIN_USERNAME);
      const validPassword = timingSafeEqual(password, ADMIN_PASSWORD);

      if (validCsrf && validUser && validPassword) {
        clearAttempts(ip);
        const sessionToken = createSessionToken();
        redirect(res, '/', {
          'Set-Cookie': [
            buildCookie('session', sessionToken, { maxAge: SESSION_TTL_SECONDS, secure: secureCookie }),
            buildCookie('login_csrf', '', { maxAge: 0, secure: secureCookie })
          ]
        });
      } else {
        recordFailedAttempt(ip);
        redirect(res, '/login?error=1', {
          'Set-Cookie': buildCookie('login_csrf', '', { maxAge: 0, secure: secureCookie })
        });
      }
    } catch {
      recordFailedAttempt(ip);
      redirect(res, '/login?error=1');
    }

    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/logout') {
    redirect(res, '/login', {
      'Set-Cookie': buildCookie('session', '', { maxAge: 0, secure: secureCookie })
    });
    return;
  }

  if (!isAuthenticated(req)) {
    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(res, 401, { error: 'Unauthorized' });
    } else {
      redirect(res, '/login');
    }
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/items') {
    try {
      const items = await proxy.getHubData();
      sendJson(res, 200, { items });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }

    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/scan') {
    try {
      const scanResult = await proxy.getHubData({ simulateScan: true });
      sendJson(res, 200, scanResult);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }

    return;
  }

  if (req.method === 'PUT' && requestUrl.pathname === '/api/items/name') {
    try {
      const body = await readJsonBody(req);
      const barcode = String(body.barcode || '').trim();
      const name = String(body.name || '').trim();

      if (!barcode || !name) {
        sendJson(res, 400, { error: 'barcode and name are required' });
        return;
      }

      const item = await proxy.updateItemName({ barcode, name });
      sendJson(res, 200, { item });
    } catch (error) {
      if (error.message === 'Item not found') {
        sendJson(res, 404, { error: error.message });
        return;
      }

      sendJson(res, 500, { error: error.message });
    }

    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname.startsWith('/api/items/')) {
    try {
      const barcode = decodeURIComponent(requestUrl.pathname.replace('/api/items/', '')).trim();
      if (!barcode) {
        sendJson(res, 400, { error: 'barcode is required' });
        return;
      }

      const result = await proxy.deleteItem({ barcode });
      sendJson(res, 200, { deleted: result.barcode });
    } catch (error) {
      if (error.message === 'Item not found') {
        sendJson(res, 404, { error: error.message });
        return;
      }

      sendJson(res, 500, { error: error.message });
    }

    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    try {
      const html = await readFileUtf8(dashboardHtmlPath);
      sendHtml(res, 200, html);
    } catch {
      sendText(res, 500, 'Failed to render dashboard');
    }
    return;
  }

  sendText(res, 404, 'Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
