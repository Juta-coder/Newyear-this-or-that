// NEW YEAR THIS OR THAT! — game + admin server
// Zero dependencies: Node.js >= 22.5 (uses the built-in node:sqlite).
//
//   node server.js                 -> http://localhost:3000
//   PORT=8080 ADMIN_PIN=4321 node server.js
//
// Environment variables
//   PORT          port to listen on (default 3000)
//   HOST          interface to bind (default 0.0.0.0, so phones on the same Wi-Fi can join)
//   ADMIN_PIN     admin PIN (default 1234)
//   ADMIN_SECRET  secret used to sign admin tokens (default: random per start)
//   DB_PATH       SQLite file (default ./data/responses.db)

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

process.removeAllListeners('warning'); // hide the "SQLite is experimental" notice
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PIN = String(process.env.ADMIN_PIN || '1234');
const ADMIN_SECRET = process.env.ADMIN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // admin stays unlocked for 8 hours
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'responses.db');
const CONFIG_PATH = path.join(PUBLIC_DIR, 'questions.json');

// ---------------------------------------------------------------- config
function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const s of cfg.steps) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(s.id)) throw new Error(`Invalid step id "${s.id}" in questions.json`);
  }
  return cfg;
}
let config = loadConfig();

// ---------------------------------------------------------------- database
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`CREATE TABLE IF NOT EXISTS responses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
)`);

// One column per question. New questions added to questions.json become new columns automatically.
function syncColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(responses)').all().map(c => c.name));
  for (const s of config.steps) {
    if (!existing.has(s.id)) db.exec(`ALTER TABLE responses ADD COLUMN "${s.id}" TEXT`);
  }
}
syncColumns();

function insertResponse(sessionId, answers) {
  const cols = config.steps.map(s => `"${s.id}"`);
  const sql = `INSERT INTO responses (session_id, created_at, ${cols.join(', ')})
               VALUES (?, ?, ${cols.map(() => '?').join(', ')})
               ON CONFLICT(session_id) DO NOTHING`;
  const values = config.steps.map(s => answers[s.id]);
  const result = db.prepare(sql).run(sessionId, new Date().toISOString(), ...values);
  return result.changes === 1; // false = duplicate submit, safely ignored
}

function allResponses() {
  return db.prepare('SELECT * FROM responses ORDER BY id DESC').all();
}

// ---------------------------------------------------------------- validation
const SESSION_RE = /^[A-Za-z0-9-]{16,64}$/;

function cleanAnswers(raw) {
  const out = {};
  const input = raw && typeof raw === 'object' ? raw : {};
  for (const s of config.steps) {
    const v = input[s.id];
    if (s.type === 'choice') {
      out[s.id] = s.options.some(o => o.value === v) ? v : null;
    } else {
      const text = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, s.maxLength || 300) : '';
      out[s.id] = text || null; // skipped = NULL
    }
  }
  return out;
}

// ---------------------------------------------------------------- admin auth (server-side)
function sign(payload) {
  return crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
}
function issueToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${sign(exp)}`;
}
function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
function pinMatches(pin) {
  const a = crypto.createHash('sha256').update(String(pin)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

// Brute-force guard: 5 wrong PINs from one IP -> locked for 60 seconds.
const failures = new Map();
function lockState(ip) {
  const f = failures.get(ip);
  if (f && f.lockedUntil > Date.now()) return Math.ceil((f.lockedUntil - Date.now()) / 1000);
  return 0;
}
function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= 5) { f.lockedUntil = Date.now() + 60_000; f.count = 0; }
  failures.set(ip, f);
}

// Light rate limit on submissions: 120 per minute per IP (many phones can share one office IP).
const submitHits = new Map();
function submitAllowed(ip) {
  const now = Date.now();
  const list = (submitHits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  submitHits.set(ip, list);
  return list.length <= 120; // generous: many phones share one office NAT IP
}
setInterval(() => { submitHits.clear(); for (const [k, f] of failures) if (f.lockedUntil < Date.now() && f.count === 0) failures.delete(k); }, 10 * 60_000).unref();

// ---------------------------------------------------------------- CSV
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv() {
  const steps = config.steps;
  const header = ['No.', 'Session ID', 'Timestamp (UTC)', 'Timestamp (Bangkok)',
    ...steps.map((s, i) => `Step ${String(i + 1).padStart(2, '0')} - ${titleCase(s.title)}`)];
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' });
  const rows = allResponses().reverse().map((r, i) => [
    i + 1, r.session_id, r.created_at, fmt.format(new Date(r.created_at)),
    ...steps.map(s => {
      const v = r[s.id];
      if (v == null) return '';
      if (s.type === 'choice') return (s.options.find(o => o.value === v) || {}).label || v;
      return v;
    })
  ]);
  return '﻿' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
function titleCase(t) { return t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }

// ---------------------------------------------------------------- http helpers
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}
function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  let file;
  try { file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname))); } catch { return send(res, 400, 'Bad request'); }
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    headers['Cache-Control'] = ['.html', '.json', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
    if (file.endsWith('admin.html')) headers['X-Robots-Tag'] = 'noindex, nofollow';
    res.writeHead(200, { ...BASE_HEADERS, ...headers });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- routes
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = clientIp(req);

  try {
    // Player submits one finished game. Idempotent per session_id.
    if (p === '/api/responses' && req.method === 'POST') {
      if (!submitAllowed(ip)) return sendJson(res, 429, { ok: false, error: 'Too many requests, try again in a minute.' });
      const body = await readJson(req);
      if (typeof body.sessionId !== 'string' || !SESSION_RE.test(body.sessionId)) return sendJson(res, 400, { ok: false, error: 'Invalid session' });
      const created = insertResponse(body.sessionId, cleanAnswers(body.answers));
      return sendJson(res, created ? 201 : 200, { ok: true, duplicate: !created });
    }

    if (p === '/api/health') return sendJson(res, 200, { ok: true });

    // Admin: exchange PIN for a signed, expiring token.
    if (p === '/api/admin/login' && req.method === 'POST') {
      const wait = lockState(ip);
      if (wait) return sendJson(res, 429, { ok: false, error: `Too many attempts. Try again in ${wait}s.`, retryAfter: wait });
      const body = await readJson(req, 1024);
      if (!pinMatches(body.pin)) { recordFailure(ip); return sendJson(res, 401, { ok: false, error: 'Incorrect PIN. Try again!' }); }
      failures.delete(ip);
      return sendJson(res, 200, { ok: true, token: issueToken(), expiresIn: TOKEN_TTL_MS });
    }

    // Everything else under /api/admin needs a valid token — data never leaves the server without it.
    if (p.startsWith('/api/admin/')) {
      if (!verifyToken(bearer(req))) return sendJson(res, 401, { ok: false, error: 'Locked' });
      if (p === '/api/admin/responses' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, config, responses: allResponses(), serverTime: new Date().toISOString() });
      }
      if (p === '/api/admin/export.csv' && req.method === 'GET') {
        const stamp = new Date().toISOString().slice(0, 10);
        return send(res, 200, buildCsv(), {
          'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="newyear-this-or-that-${stamp}.csv"`
        });
      }
      if (p === '/api/admin/game-url' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, urls: lanUrls() });
      }
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, p);
  } catch (err) {
    if (err.status) return sendJson(res, err.status, { ok: false, error: err.message });
    console.error(err);
    return sendJson(res, 500, { ok: false, error: 'Server error' });
  }
}

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}/`);
  }
  return urls;
}

// Reload questions.json when it changes (so wording edits apply without a restart).
fs.watchFile(CONFIG_PATH, { interval: 2000 }, () => {
  try { config = loadConfig(); syncColumns(); console.log('↻ questions.json reloaded'); }
  catch (e) { console.error('questions.json has an error, keeping the previous version:', e.message); }
});

http.createServer(handle).listen(PORT, HOST, () => {
  console.log('\n🎉  NEW YEAR THIS OR THAT! is running');
  console.log(`    Game   : http://localhost:${PORT}/`);
  console.log(`    Admin  : http://localhost:${PORT}/admin   (PIN ${ADMIN_PIN === '1234' ? '1234 — change with ADMIN_PIN' : 'set via ADMIN_PIN'})`);
  for (const u of lanUrls()) console.log(`    Same Wi-Fi: ${u}`);
  console.log(`    Data   : ${DB_PATH}\n`);
});
