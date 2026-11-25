#!/usr/bin/env node
'use strict';
// Local development server.
// Serves index.html and mounts the same serverless handlers in api/ the way
// Vercel does (req.query, req.body, res.status().json()).
// Not used in production: Vercel deploys api/*.js directly.

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- tiny .env loader (no dependencies) ----
function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const ROUTES = {
  '/api/auth': './api/auth',
  '/api/users': './api/users',
  '/api/records': './api/records',
  '/api/directory': './api/directory',
};
const handlers = {};
function handler(name) {
  if (!handlers[name]) handlers[name] = require(ROUTES[name]);
  return handlers[name];
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const MAX_BODY = 5 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Vercel-style helpers on the raw response object.
function enhance(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (value) => {
    if (value !== null && typeof value === 'object') return res.json(value);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(value === undefined || value === null ? '' : String(value));
    return res;
  };
  return res;
}

function parseQuery(searchParams) {
  const query = {};
  for (const [key, value] of searchParams) {
    if (!(key in query)) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

// Dev/config files stay reachable on disk but are never served by the dev server.
const DENY_DIRS = new Set(['api', 'scripts', 'node_modules', '.git', '.vercel']);
const DENY_FILES = /^(?:server\.js|package(?:-lock)?\.json|vercel\.json|README[\w.-]*|\.env.*|\.gitignore|\.vercelignore)$/i;

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(__dirname, rel);
  const root = path.resolve(__dirname) + path.sep;
  const segments = rel.split(/[\\/]+/);
  const blocked =
    !file.startsWith(root) ||
    DENY_DIRS.has(segments[0]) ||
    segments.some((s) => s.startsWith('.')) ||
    DENY_FILES.test(segments[segments.length - 1]);
  if (blocked) {
    res.status(404).send('Not found');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '');
  enhance(res);
  res.on('finish', () => {
    console.log(`${req.method} ${pathname}${url.search} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });

  if (pathname === '/favicon.ico') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!ROUTES[pathname]) {
    if (pathname.startsWith('/api/')) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    serveStatic(res, pathname);
    return;
  }

  req.query = parseQuery(url.searchParams);
  try {
    const buf = await readBody(req);
    const type = String(req.headers['content-type'] || '');
    if (buf.length && type.includes('json')) {
      try {
        req.body = JSON.parse(buf.toString('utf8'));
      } catch {
        res.status(400).json({ error: 'invalid JSON body' });
        return;
      }
    }
    await handler(pathname)(req, res);
  } catch (err) {
    console.error(pathname, err);
    if (!res.headersSent) res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log('');
  console.log('  منصة اللياقة البدنية — خادم التطوير المحلي');
  console.log(`  http://localhost:${port}`);
  console.log('');
  console.log('  MONGODB_URI:', process.env.MONGODB_URI ? 'مضبوط ✓' : 'غير مضبوط ✗ (عدّل ملف .env)');
  console.log('  JWT_SECRET :', process.env.JWT_SECRET ? 'مضبوط ✓' : 'غير مضبوط ✗');
  console.log('');
});
