'use strict';
/*
 * Garden Planner server — zero npm dependencies.
 * Node 22+ (uses built-in node:sqlite). HTTP JSON API + Server-Sent Events for live sync.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { openDb } = require('./src/db');
const { COMPANIONS } = require('./src/crops');
const { lookupZip } = require('./src/frost');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || '');
const VERSION = require('./package.json').version;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(path.join(DATA_DIR, 'garden.db'));

// ---------- settings ----------
function getSetting(key, def) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
const envAllowReg = process.env.ALLOW_REGISTRATION;
function allowRegistration() {
  const v = getSetting('allow_registration', envAllowReg === undefined ? 'true' : envAllowReg);
  return /^(1|true|yes)$/i.test(v);
}
function userCount() { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; }

// ---------- helpers ----------
const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ad7f58'];
const now = () => Date.now();
const uid = (n = 12) => crypto.randomBytes(n).toString('base64url');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return reject(new HttpError(415, 'Expected JSON'));
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function isSecure(req) {
  return COOKIE_SECURE || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
}

const str = (v, max, def = '') => (typeof v === 'string' ? v.trim().slice(0, max) : def);
const num = (v, min, max, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isColor = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

// ---------- auth ----------
async function hashPassword(pw, salt = uid(16)) {
  const buf = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return { hash: buf.toString('base64'), salt };
}
async function verifyPassword(pw, user) {
  const { hash } = await hashPassword(pw, user.salt);
  const a = Buffer.from(hash), b = Buffer.from(user.pass_hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicUser(u) {
  return u && { id: u.id, username: u.username, displayName: u.display_name, isAdmin: !!u.is_admin, color: u.color };
}

function createSession(res, req, userId) {
  const token = uid(32);
  const expires = now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  setSessionCookie(res, req, token, SESSION_DAYS * 86400);
}
function setSessionCookie(res, req, token, maxAge) {
  const parts = [`gp_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getUser(req) {
  const token = parseCookies(req).gp_session;
  if (!token) return null;
  const row = db.prepare(`SELECT u.*, s.expires_at, s.token FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < now()) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); return null; }
  // sliding expiry: refresh when less than half the lifetime remains
  if (row.expires_at - now() < SESSION_DAYS * 864e5 / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(now() + SESSION_DAYS * 864e5, token);
  }
  return row;
}

const loginAttempts = new Map();
function rateLimit(req) {
  const ip = clientIp(req);
  const t = now();
  let e = loginAttempts.get(ip);
  if (!e || e.reset < t) { e = { count: 0, reset: t + 15 * 60e3 }; loginAttempts.set(ip, e); }
  e.count++;
  if (e.count > 20) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}
setInterval(() => {
  const t = now();
  for (const [k, v] of loginAttempts) if (v.reset < t) loginAttempts.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
}, 10 * 60e3).unref();

function validUsername(u) { return typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 200; }

// ---------- serializers ----------
function cropJson(c) {
  return {
    id: c.id, builtin: !!c.builtin, ownerId: c.owner_id, name: c.name, category: c.category, family: c.family,
    icon: c.icon, color: c.color, spacing: c.spacing, rowSpacing: c.row_spacing, timing: JSON.parse(c.timing || '{}'),
    dtm: c.dtm, note: c.note, perennial: !!c.perennial,
  };
}
function itemJson(i) {
  return { id: i.id, type: i.type, cropId: i.crop_id, x: i.x, y: i.y, w: i.w, h: i.h, z: i.z, props: JSON.parse(i.props || '{}'), updatedBy: i.updated_by, updatedAt: i.updated_at };
}
function planJson(p) {
  return {
    id: p.id, ownerId: p.owner_id, ownerName: p.owner_name, name: p.name, width: p.width, height: p.height,
    lastFrost: p.last_frost, firstFrost: p.first_frost, mode: p.mode, snap: p.snap, notes: p.notes, year: p.year,
    zip: p.zip, zone: p.zone, place: p.place,
    createdAt: p.created_at, updatedAt: p.updated_at, role: p.role,
  };
}

// ---------- access ----------
function getPlanRole(planId, userId) {
  const p = db.prepare('SELECT owner_id FROM plans WHERE id = ?').get(planId);
  if (!p) return null;
  if (p.owner_id === userId) return 'owner';
  const m = db.prepare('SELECT role FROM plan_members WHERE plan_id = ? AND user_id = ?').get(planId, userId);
  return m ? m.role : null;
}
function requirePlan(planId, user, need = 'viewer') {
  const role = getPlanRole(planId, user.id);
  if (!role) throw new HttpError(404, 'Plan not found');
  const rank = { viewer: 0, editor: 1, owner: 2 };
  if (rank[role] < rank[need]) throw new HttpError(403, 'You do not have permission to do that');
  return role;
}
function loadPlan(planId, role) {
  const p = db.prepare('SELECT p.*, u.display_name AS owner_name FROM plans p JOIN users u ON u.id = p.owner_id WHERE p.id = ?').get(planId);
  p.role = role;
  return planJson(p);
}
function planMembers(planId) {
  const owner = db.prepare(`SELECT u.id, u.username, u.display_name, u.color FROM plans p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`).get(planId);
  const rows = db.prepare(`SELECT u.id, u.username, u.display_name, u.color, m.role FROM plan_members m JOIN users u ON u.id = m.user_id WHERE m.plan_id = ? ORDER BY u.display_name`).all(planId);
  return [{ ...owner, role: 'owner' }, ...rows].map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, color: r.color, role: r.role }));
}

// ---------- live sync hub (Server-Sent Events) ----------
const hub = new Map(); // planId -> Set<client>
function sseWrite(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
}
function broadcast(planId, event, data) {
  const set = hub.get(planId);
  if (!set) return;
  for (const c of set) sseWrite(c, event, data);
}
function presence(planId) {
  const set = hub.get(planId);
  const seen = new Map();
  if (set) for (const c of set) if (!seen.has(c.user.id)) seen.set(c.user.id, { id: c.user.id, displayName: c.user.display_name, color: c.user.color, clientId: c.clientId });
  broadcast(planId, 'presence', { users: [...seen.values()] });
}
function kickUser(planId, userId, reason) {
  const set = hub.get(planId);
  if (!set) return;
  for (const c of [...set]) if (userId == null || c.user.id === userId) { sseWrite(c, 'revoked', { reason }); c.res.end(); }
}
setInterval(() => {
  for (const set of hub.values()) for (const c of set) { try { c.res.write(': ping\n\n'); } catch { /* ignore */ } }
}, 25e3).unref();

function openEvents(req, res, user, planId, clientId) {
  const role = requirePlan(planId, user);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { res, user, clientId: str(clientId, 64) || uid(6), role };
  if (!hub.has(planId)) hub.set(planId, new Set());
  hub.get(planId).add(client);
  sseWrite(client, 'hello', { serverTime: now(), version: VERSION });
  presence(planId);
  req.on('close', () => {
    const set = hub.get(planId);
    if (set) { set.delete(client); if (!set.size) hub.delete(planId); }
    presence(planId);
  });
}

// ---------- validation ----------
const ITEM_TYPES = new Set(['crop', 'raised-bed', 'bed', 'path', 'container', 'fence', 'trellis', 'tree', 'structure', 'water', 'label']);
const MAX_DIM = 12 * 1000; // 1000 ft

function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') throw bad('Invalid item');
  const id = str(raw.id, 64);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw bad('Invalid item id');
  if (!ITEM_TYPES.has(raw.type)) throw bad('Invalid item type');
  const props = raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props) ? raw.props : {};
  const propsJson = JSON.stringify(props);
  if (propsJson.length > 8000) throw bad('Item properties too large');
  let cropId = null;
  if (raw.type === 'crop') {
    cropId = str(raw.cropId, 64);
    if (!cropId) throw bad('Crop item needs a cropId');
  }
  return {
    id, type: raw.type, cropId,
    x: num(raw.x, -MAX_DIM, MAX_DIM, 0), y: num(raw.y, -MAX_DIM, MAX_DIM, 0),
    w: num(raw.w, 0.5, MAX_DIM, 12), h: num(raw.h, 0.5, MAX_DIM, 12),
    z: Math.round(num(raw.z, -1e6, 1e6, 0)),
    props: propsJson,
  };
}

function cleanCrop(raw, existing = {}) {
  const name = str(raw.name, 60, existing.name);
  if (!name) throw bad('Crop name is required');
  const spacing = num(raw.spacing, 0.5, 240, existing.spacing ?? 12);
  const row = num(raw.rowSpacing, 0.5, 240, existing.row_spacing ?? spacing);
  const rng = (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n))) ? [num(v[0], -52, 52, 0), num(v[1], -52, 52, 0)].sort((a, b) => a - b) : null);
  const t = raw.timing || {};
  return {
    name,
    category: str(raw.category, 30, existing.category || 'Vegetable') || 'Vegetable',
    family: str(raw.family, 40, existing.family || ''),
    icon: str(raw.icon, 8, existing.icon || '🌱') || '🌱',
    color: isColor(raw.color) ? raw.color : existing.color || '#30a46c',
    spacing, row_spacing: row,
    timing: JSON.stringify({ indoor: rng(t.indoor), transplant: rng(t.transplant), direct: rng(t.direct) }),
    dtm: raw.dtm == null || raw.dtm === '' ? null : Math.round(num(raw.dtm, 1, 1000, 60)),
    note: str(raw.note, 500, existing.note || ''),
    perennial: raw.perennial ? 1 : 0,
  };
}

// ---------- route table ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false, admin: !!opts.admin });
};

// --- auth / config
route('GET', '/api/config', (ctx) => ({ allowRegistration: allowRegistration() || userCount() === 0, needsSetup: userCount() === 0, version: VERSION }), { auth: false });

route('POST', '/api/auth/register', async (ctx) => {
  rateLimit(ctx.req);
  const body = await readJson(ctx.req);
  const first = userCount() === 0;
  if (!first && !allowRegistration()) throw new HttpError(403, 'Registration is disabled. Ask an admin to create your account.');
  const { username, password } = body;
  if (!validUsername(username)) throw bad('Username must be 3–32 characters: letters, numbers, . _ -');
  if (!validPassword(password)) throw bad('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken');
  const displayName = str(body.displayName, 40) || username;
  const { hash, salt } = await hashPassword(password);
  const color = COLORS[userCount() % COLORS.length];
  const r = db.prepare('INSERT INTO users (username, display_name, pass_hash, salt, is_admin, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(username, displayName, hash, salt, first ? 1 : 0, color, now());
  createSession(ctx.res, ctx.req, Number(r.lastInsertRowid));
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) };
}, { auth: false });

route('POST', '/api/auth/login', async (ctx) => {
  rateLimit(ctx.req);
  const { username, password } = await readJson(ctx.req);
  const u = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) : null;
  if (!u || typeof password !== 'string' || !(await verifyPassword(password, u))) throw new HttpError(401, 'Wrong username or password');
  createSession(ctx.res, ctx.req, u.id);
  return { user: publicUser(u) };
}, { auth: false });

route('POST', '/api/auth/logout', (ctx) => {
  const token = parseCookies(ctx.req).gp_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  setSessionCookie(ctx.res, ctx.req, '', 0);
  return { ok: true };
}, { auth: false });

route('GET', '/api/auth/me', (ctx) => ({ user: publicUser(ctx.user) }));

route('PUT', '/api/auth/me', async (ctx) => {
  const body = await readJson(ctx.req);
  const u = ctx.user;
  const displayName = str(body.displayName, 40) || u.display_name;
  const color = isColor(body.color) ? body.color : u.color;
  if (body.newPassword) {
    if (!(await verifyPassword(String(body.currentPassword || ''), u))) throw new HttpError(401, 'Current password is incorrect');
    if (!validPassword(body.newPassword)) throw bad('New password must be at least 8 characters');
    const { hash, salt } = await hashPassword(body.newPassword);
    db.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').run(hash, salt, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, u.token);
  }
  db.prepare('UPDATE users SET display_name = ?, color = ? WHERE id = ?').run(displayName, color, u.id);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) };
});

// --- admin
route('GET', '/api/admin/users', () => ({
  users: db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM plans p WHERE p.owner_id = u.id) AS plan_count FROM users u ORDER BY u.created_at`).all()
    .map((u) => ({ ...publicUser(u), createdAt: u.created_at, planCount: u.plan_count })),
  allowRegistration: allowRegistration(),
}), { admin: true });

route('POST', '/api/admin/users', async (ctx) => {
  const body = await readJson(ctx.req);
  if (!validUsername(body.username)) throw bad('Username must be 3–32 characters: letters, numbers, . _ -');
  if (!validPassword(body.password)) throw bad('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) throw new HttpError(409, 'That username is taken');
  const { hash, salt } = await hashPassword(body.password);
  db.prepare('INSERT INTO users (username, display_name, pass_hash, salt, is_admin, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(body.username, str(body.displayName, 40) || body.username, hash, salt, body.isAdmin ? 1 : 0, COLORS[userCount() % COLORS.length], now());
  return { ok: true };
}, { admin: true });

route('PUT', '/api/admin/users/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const body = await readJson(ctx.req);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new HttpError(404, 'User not found');
  if (typeof body.isAdmin === 'boolean') {
    if (!body.isAdmin && id === ctx.user.id) throw bad('You cannot remove your own admin rights');
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(body.isAdmin ? 1 : 0, id);
  }
  if (body.password) {
    if (!validPassword(body.password)) throw bad('Password must be at least 8 characters');
    const { hash, salt } = await hashPassword(body.password);
    db.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').run(hash, salt, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  return { ok: true };
}, { admin: true });

route('DELETE', '/api/admin/users/:id', (ctx) => {
  const id = Number(ctx.params.id);
  if (id === ctx.user.id) throw bad('You cannot delete yourself');
  const plans = db.prepare('SELECT id FROM plans WHERE owner_id = ?').all(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  for (const p of plans) kickUser(p.id, null, 'This plan was deleted');
  return { ok: true };
}, { admin: true });

route('PUT', '/api/admin/settings', async (ctx) => {
  const body = await readJson(ctx.req);
  if (typeof body.allowRegistration === 'boolean') setSetting('allow_registration', body.allowRegistration);
  return { allowRegistration: allowRegistration() };
}, { admin: true });

// --- crops
route('GET', '/api/crops', (ctx) => ({
  crops: db.prepare(`SELECT * FROM crops WHERE builtin = 1 OR owner_id = ? ORDER BY builtin DESC, name`).all(ctx.user.id).map(cropJson),
  companions: COMPANIONS,
}));

route('POST', '/api/crops', async (ctx) => {
  const c = cleanCrop(await readJson(ctx.req));
  const id = 'c_' + uid(9);
  db.prepare(`INSERT INTO crops (id, owner_id, builtin, name, category, family, icon, color, spacing, row_spacing, timing, dtm, note, perennial)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ctx.user.id, c.name, c.category, c.family, c.icon, c.color, c.spacing, c.row_spacing, c.timing, c.dtm, c.note, c.perennial);
  return { crop: cropJson(db.prepare('SELECT * FROM crops WHERE id = ?').get(id)) };
});

route('PUT', '/api/crops/:id', async (ctx) => {
  const ex = db.prepare('SELECT * FROM crops WHERE id = ?').get(ctx.params.id);
  if (!ex || ex.builtin || ex.owner_id !== ctx.user.id) throw new HttpError(403, 'You can only edit your own custom crops');
  const c = cleanCrop(await readJson(ctx.req), ex);
  db.prepare(`UPDATE crops SET name=?, category=?, family=?, icon=?, color=?, spacing=?, row_spacing=?, timing=?, dtm=?, note=?, perennial=? WHERE id=?`)
    .run(c.name, c.category, c.family, c.icon, c.color, c.spacing, c.row_spacing, c.timing, c.dtm, c.note, c.perennial, ex.id);
  const crop = cropJson(db.prepare('SELECT * FROM crops WHERE id = ?').get(ex.id));
  // push the updated definition to any plans using it
  for (const r of db.prepare('SELECT DISTINCT plan_id FROM items WHERE crop_id = ?').all(ex.id)) broadcast(r.plan_id, 'crop', { crop });
  return { crop };
});

route('DELETE', '/api/crops/:id', (ctx) => {
  const ex = db.prepare('SELECT * FROM crops WHERE id = ?').get(ctx.params.id);
  if (!ex || ex.builtin || ex.owner_id !== ctx.user.id) throw new HttpError(403, 'You can only delete your own custom crops');
  const used = db.prepare('SELECT COUNT(*) AS n FROM items WHERE crop_id = ?').get(ex.id).n;
  if (used) throw new HttpError(409, `This crop is used in ${used} planting(s). Remove them first.`);
  db.prepare('DELETE FROM crops WHERE id = ?').run(ex.id);
  return { ok: true };
});

// --- plans
route('GET', '/api/plans', (ctx) => {
  const rows = db.prepare(`
    SELECT p.*, u.display_name AS owner_name,
      CASE WHEN p.owner_id = ? THEN 'owner' ELSE m.role END AS role,
      (SELECT COUNT(*) FROM items i WHERE i.plan_id = p.id) AS item_count
    FROM plans p JOIN users u ON u.id = p.owner_id
    LEFT JOIN plan_members m ON m.plan_id = p.id AND m.user_id = ?
    WHERE p.owner_id = ? OR m.user_id IS NOT NULL
    ORDER BY p.updated_at DESC`).all(ctx.user.id, ctx.user.id, ctx.user.id);
  return { plans: rows.map((r) => ({ ...planJson(r), itemCount: r.item_count })) };
});

function planFields(body, ex = {}) {
  const width = Math.round(num(body.width, 12, MAX_DIM, ex.width ?? 240));
  const height = Math.round(num(body.height, 12, MAX_DIM, ex.height ?? 120));
  return {
    name: str(body.name, 80, ex.name) || 'My Garden',
    width, height,
    last_frost: body.lastFrost === null ? null : isDate(body.lastFrost) ? body.lastFrost : ex.last_frost ?? null,
    first_frost: body.firstFrost === null ? null : isDate(body.firstFrost) ? body.firstFrost : ex.first_frost ?? null,
    mode: body.mode === 'sfg' || body.mode === 'rows' ? body.mode : ex.mode || 'rows',
    snap: [1, 2, 3, 4, 6, 12].includes(Number(body.snap)) ? Number(body.snap) : ex.snap ?? 6,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 5000) : ex.notes ?? '',
    zip: body.zip === null || body.zip === '' ? null : /^\d{5}$/.test(String(body.zip)) ? String(body.zip) : ex.zip ?? null,
    zone: body.zone === null ? null : typeof body.zone === 'string' ? body.zone.slice(0, 8) : ex.zone ?? null,
    place: body.place === null ? null : typeof body.place === 'string' ? body.place.slice(0, 80) : ex.place ?? null,
    year: body.year == null ? ex.year ?? new Date().getFullYear() : Math.round(num(body.year, 1900, 3000, new Date().getFullYear())),
  };
}

route('POST', '/api/plans', async (ctx) => {
  const f = planFields(await readJson(ctx.req));
  const id = uid(9); const t = now();
  db.prepare(`INSERT INTO plans (id, owner_id, name, width, height, last_frost, first_frost, mode, snap, notes, year, zip, zone, place, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ctx.user.id, f.name, f.width, f.height, f.last_frost, f.first_frost, f.mode, f.snap, f.notes, f.year, f.zip, f.zone, f.place, t, t);
  return { plan: loadPlan(id, 'owner') };
});

route('GET', '/api/plans/:id', (ctx) => {
  const role = requirePlan(ctx.params.id, ctx.user);
  const items = db.prepare('SELECT * FROM items WHERE plan_id = ? ORDER BY z, updated_at').all(ctx.params.id).map(itemJson);
  // include custom crops (possibly owned by other members) used in this plan
  const crops = db.prepare(`SELECT c.* FROM crops c WHERE c.builtin = 0 AND c.id IN (SELECT DISTINCT crop_id FROM items WHERE plan_id = ? AND crop_id IS NOT NULL)`).all(ctx.params.id).map(cropJson);
  return { plan: loadPlan(ctx.params.id, role), items, crops, members: planMembers(ctx.params.id) };
});

route('PUT', '/api/plans/:id', async (ctx) => {
  const role = requirePlan(ctx.params.id, ctx.user, 'editor');
  const ex = db.prepare('SELECT * FROM plans WHERE id = ?').get(ctx.params.id);
  const body = await readJson(ctx.req);
  const f = planFields(body, ex);
  db.prepare(`UPDATE plans SET name=?, width=?, height=?, last_frost=?, first_frost=?, mode=?, snap=?, notes=?, year=?, zip=?, zone=?, place=?, updated_at=? WHERE id=?`)
    .run(f.name, f.width, f.height, f.last_frost, f.first_frost, f.mode, f.snap, f.notes, f.year, f.zip, f.zone, f.place, now(), ex.id);
  const plan = loadPlan(ex.id, role);
  broadcast(ex.id, 'plan', { plan: { ...plan, role: undefined }, by: ctx.user.id, clientId: str(body.clientId, 64) });
  return { plan };
});

route('DELETE', '/api/plans/:id', (ctx) => {
  requirePlan(ctx.params.id, ctx.user, 'owner');
  db.prepare('DELETE FROM plans WHERE id = ?').run(ctx.params.id);
  kickUser(ctx.params.id, null, 'This plan was deleted by its owner');
  return { ok: true };
});

route('POST', '/api/plans/:id/duplicate', async (ctx) => {
  requirePlan(ctx.params.id, ctx.user);
  const body = await readJson(ctx.req);
  const ex = db.prepare('SELECT * FROM plans WHERE id = ?').get(ctx.params.id);
  const id = uid(9); const t = now();
  const name = str(body.name, 80) || `${ex.name} (copy)`;
  db.exec('BEGIN');
  try {
    const newYear = body.year ? Math.round(num(body.year, 1900, 3000, ex.year)) : ex.year;
    const shift = (d) => (d && newYear ? `${newYear}${d.slice(4)}` : d);
    db.prepare(`INSERT INTO plans (id, owner_id, name, width, height, last_frost, first_frost, mode, snap, notes, year, zip, zone, place, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ctx.user.id, name, ex.width, ex.height, shift(ex.last_frost), shift(ex.first_frost), ex.mode, ex.snap, ex.notes,
        newYear, ex.zip, ex.zone, ex.place, t, t);
    const ins = db.prepare('INSERT INTO items (id, plan_id, type, crop_id, x, y, w, h, z, props, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const onlyBeds = !!body.structuresOnly;
    for (const i of db.prepare('SELECT * FROM items WHERE plan_id = ?').all(ex.id)) {
      if (onlyBeds && i.type === 'crop') continue;
      ins.run(uid(12), id, i.type, i.crop_id, i.x, i.y, i.w, i.h, i.z, i.props, ctx.user.id, t);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { plan: loadPlan(id, 'owner') };
});

route('GET', '/api/plans/:id/events', (ctx) => {
  openEvents(ctx.req, ctx.res, ctx.user, ctx.params.id, ctx.query.get('clientId'));
  return undefined; // streaming
});

route('POST', '/api/plans/:id/items', async (ctx) => {
  requirePlan(ctx.params.id, ctx.user, 'editor');
  const body = await readJson(ctx.req);
  const list = Array.isArray(body.items) ? body.items : [];
  if (!list.length) return { items: [] };
  if (list.length > 2000) throw bad('Too many items in one request');
  const items = list.map(cleanItem);
  const planId = ctx.params.id;
  const t = now();
  const getEx = db.prepare('SELECT plan_id FROM items WHERE id = ?');
  const cropOk = db.prepare('SELECT * FROM crops WHERE id = ? AND (builtin = 1 OR owner_id = ? OR id IN (SELECT crop_id FROM items WHERE plan_id = ?))');
  const up = db.prepare(`INSERT INTO items (id, plan_id, type, crop_id, x, y, w, h, z, props, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET type=excluded.type, crop_id=excluded.crop_id, x=excluded.x, y=excluded.y, w=excluded.w, h=excluded.h,
      z=excluded.z, props=excluded.props, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);
  const newCrops = new Map();
  db.exec('BEGIN');
  try {
    for (const it of items) {
      const ex = getEx.get(it.id);
      if (ex && ex.plan_id !== planId) throw bad('Item id conflict');
      if (it.cropId) {
        const c = cropOk.get(it.cropId, ctx.user.id, planId);
        if (!c) throw bad('Unknown crop');
        if (!c.builtin) newCrops.set(c.id, cropJson(c));
      }
      up.run(it.id, planId, it.type, it.cropId, it.x, it.y, it.w, it.h, it.z, it.props, ctx.user.id, t);
    }
    db.prepare('UPDATE plans SET updated_at = ? WHERE id = ?').run(t, planId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const out = items.map((it) => ({ id: it.id, type: it.type, cropId: it.cropId, x: it.x, y: it.y, w: it.w, h: it.h, z: it.z, props: JSON.parse(it.props), updatedBy: ctx.user.id, updatedAt: t }));
  for (const crop of newCrops.values()) broadcast(planId, 'crop', { crop });
  broadcast(planId, 'items', { items: out, by: ctx.user.id, clientId: str(body.clientId, 64) });
  return { items: out };
});

route('POST', '/api/plans/:id/items/delete', async (ctx) => {
  requirePlan(ctx.params.id, ctx.user, 'editor');
  const body = await readJson(ctx.req);
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x) => typeof x === 'string').slice(0, 5000);
  const del = db.prepare('DELETE FROM items WHERE id = ? AND plan_id = ?');
  db.exec('BEGIN');
  try { for (const id of ids) del.run(id, ctx.params.id); db.prepare('UPDATE plans SET updated_at = ? WHERE id = ?').run(now(), ctx.params.id); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  broadcast(ctx.params.id, 'delete', { ids, by: ctx.user.id, clientId: str(body.clientId, 64) });
  return { ok: true };
});

// Lightweight ephemeral channel: cursors / selection highlights (not stored).
route('POST', '/api/plans/:id/cursor', async (ctx) => {
  requirePlan(ctx.params.id, ctx.user);
  const body = await readJson(ctx.req, 4096);
  broadcast(ctx.params.id, 'cursor', {
    userId: ctx.user.id, displayName: ctx.user.display_name, color: ctx.user.color, clientId: str(body.clientId, 64),
    x: num(body.x, -MAX_DIM, MAX_DIM, 0), y: num(body.y, -MAX_DIM, MAX_DIM, 0),
    selection: Array.isArray(body.selection) ? body.selection.filter((s) => typeof s === 'string').slice(0, 50) : [],
  });
  return { ok: true };
});

// --- sharing
route('POST', '/api/plans/:id/members', async (ctx) => {
  requirePlan(ctx.params.id, ctx.user, 'owner');
  const body = await readJson(ctx.req);
  const role = body.role === 'viewer' ? 'viewer' : 'editor';
  const u = typeof body.username === 'string' ? db.prepare('SELECT * FROM users WHERE username = ?').get(body.username.trim()) : null;
  if (!u) throw new HttpError(404, 'No user with that username');
  if (u.id === ctx.user.id) throw bad('You already own this plan');
  db.prepare('INSERT INTO plan_members (plan_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(plan_id, user_id) DO UPDATE SET role = excluded.role').run(ctx.params.id, u.id, role);
  const members = planMembers(ctx.params.id);
  broadcast(ctx.params.id, 'members', { members });
  return { members };
});

route('DELETE', '/api/plans/:id/members/:userId', (ctx) => {
  const uidNum = Number(ctx.params.userId);
  // owners can remove anyone; members can remove themselves (leave)
  if (uidNum !== ctx.user.id) requirePlan(ctx.params.id, ctx.user, 'owner');
  else requirePlan(ctx.params.id, ctx.user);
  db.prepare('DELETE FROM plan_members WHERE plan_id = ? AND user_id = ?').run(ctx.params.id, uidNum);
  kickUser(ctx.params.id, uidNum, 'You no longer have access to this plan');
  const members = planMembers(ctx.params.id);
  broadcast(ctx.params.id, 'members', { members });
  return { members };
});

const frostInflight = new Map();
route('GET', '/api/frost/:zip', async (ctx) => {
  const zip = ctx.params.zip;
  if (!/^\d{5}$/.test(zip)) throw bad('Enter a 5-digit US ZIP code');
  const cached = db.prepare('SELECT data, fetched_at FROM frost_cache WHERE zip = ?').get(zip);
  if (cached && now() - cached.fetched_at < 180 * 864e5) return JSON.parse(cached.data);
  if (!frostInflight.has(zip)) {
    frostInflight.set(zip, lookupZip(zip).finally(() => frostInflight.delete(zip)));
  }
  let data;
  try { data = await frostInflight.get(zip); } catch (e) { throw new HttpError(e.status || 502, e.message); }
  db.prepare('INSERT INTO frost_cache (zip, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(zip) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at').run(zip, JSON.stringify(data), now());
  return data;
});

route('GET', '/healthz', () => ({ ok: true, version: VERSION }), { auth: false });

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- server ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/') && pathname !== '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  }
  try {
    // CSRF guard: state-changing requests must come from our own origin.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers['x-forwarded-host'] && TRUST_PROXY ? req.headers['x-forwarded-host'] : req.headers.host;
        try { if (new URL(origin).host !== host) throw new HttpError(403, 'Cross-origin request blocked'); }
        catch (e) { throw e instanceof HttpError ? e : new HttpError(403, 'Bad origin'); }
      }
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const ctx = { req, res, params, query: url.searchParams, user: null };
      if (r.auth) {
        ctx.user = getUser(req);
        if (!ctx.user) throw new HttpError(401, 'Please sign in');
        if (r.admin && !ctx.user.is_admin) throw new HttpError(403, 'Admins only');
      }
      const out = await r.handler(ctx);
      if (out !== undefined && !res.headersSent) send(res, 200, out);
      return;
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Server error' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`🌱 Garden Planner v${VERSION} listening on :${PORT} (data: ${DATA_DIR})`);
  if (userCount() === 0) console.log('   No users yet — the first account you create becomes the admin.');
});

function shutdown() {
  console.log('Shutting down…');
  for (const set of hub.values()) for (const c of set) c.res.end();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
