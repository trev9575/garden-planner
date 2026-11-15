// Garden Planner — front end (no build step, no dependencies).
/* eslint-disable no-use-before-define */

// ---------------------------------------------------------------- utilities
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (n) => Math.round(n * 100) / 100;
function uid(len = 14) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => a[x % a.length]).join('');
}
function fmtLen(inches) {
  const neg = inches < 0; inches = Math.abs(Math.round(inches * 10) / 10);
  const ft = Math.floor(inches / 12); const inch = Math.round((inches - ft * 12) * 10) / 10;
  let s = ft && inch ? `${ft}′ ${inch}″` : ft ? `${ft}′` : `${inch}″`;
  return neg ? '−' + s : s;
}
function parseLen(str) {
  const s = String(str).trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!s) return NaN;
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return NaN;
  return (Number(m[1] || 0) * 12) + Number(m[2] || 0);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
function parseDate(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------- state
const S = {
  config: null, user: null,
  crops: new Map(), companions: {},
  plans: [], plan: null, role: null, members: [],
  items: new Map(),
  sel: new Set(),
  tool: 'select', placing: null, // {kind:'crop', id} | {kind:'object', type}
  view: { x: 40, y: 40, k: 2 },
  undo: [], redo: [],
  clientId: uid(10),
  es: null, presence: [], cursors: new Map(),
  libTab: 'plants', libFilter: 'All', libSearch: '',
  viewMode: 'layout',
  clipboard: null,
};
const canEdit = () => S.role === 'owner' || S.role === 'editor';

const OBJECTS = [
  { type: 'raised-bed', name: 'Raised bed', w: 48, h: 96, label: 'Raised bed' },
  { type: 'bed', name: 'In-ground bed', w: 48, h: 120, label: 'Bed' },
  { type: 'container', name: 'Pot or container', w: 18, h: 18 },
  { type: 'path', name: 'Path', w: 24, h: 120 },
  { type: 'fence', name: 'Fence', w: 120, h: 4 },
  { type: 'trellis', name: 'Trellis', w: 72, h: 6 },
  { type: 'tree', name: 'Tree or shrub', w: 96, h: 96 },
  { type: 'structure', name: 'Shed or greenhouse', w: 96, h: 120, label: 'Shed' },
  { type: 'water', name: 'Water or rain barrel', w: 30, h: 30 },
  { type: 'label', name: 'Text label', w: 48, h: 12 },
];
const OBJ = Object.fromEntries(OBJECTS.map((o) => [o.type, o]));
const LAYER = { path: 0, bed: 1, 'raised-bed': 1, structure: 1, water: 1, container: 2, tree: 4, fence: 3, trellis: 3, crop: 5, label: 6 };
const USER_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ad7f58'];

// ---------------------------------------------------------------- api
async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/register')) {
    showAuth('login');
  }
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 5000 : 2600);
}

// ---------------------------------------------------------------- modal
function modal({ title, body, foot = '', wide = false, onOpen }) {
  const d = $('#modal');
  d.className = 'modal' + (wide ? ' wide' : '');
  d.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  if (!d.open) d.showModal();
  onOpen && onOpen(d);
  const first = d.querySelector('.modal-body input:not([type=checkbox]), .modal-body select, .modal-body textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return d;
}
$('#modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
const closeModal = () => $('#modal').open && $('#modal').close();

// ---------------------------------------------------------------- auth
let authMode = 'login';
function showAuth(mode) {
  authMode = mode;
  if (S.es) { S.es.close(); S.es = null; }
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  const setup = mode === 'setup', reg = mode === 'register' || setup;
  $('#authLede').textContent = setup ? 'Create the first account. It becomes the admin for this server.' : reg ? 'Create an account to start planning.' : 'Sign in to your garden plans.';
  $('#authSubmit').textContent = reg ? 'Create account' : 'Sign in';
  $('#displayNameField').classList.toggle('hidden', !reg);
  $('#authForm').password.autocomplete = reg ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
  const sw = $('#authSwitch');
  if (setup) sw.innerHTML = '';
  else if (reg) sw.innerHTML = 'Already have an account? <button type="button" class="linkish" data-m="login">Sign in</button>';
  else if (S.config?.allowRegistration) sw.innerHTML = 'New here? <button type="button" class="linkish" data-m="register">Create an account</button>';
  else sw.textContent = 'Ask your admin for an account.';
  sw.querySelector('button')?.addEventListener('click', (e) => showAuth(e.target.dataset.m));
  $('#authForm').username.focus();
}
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const body = { username: f.username.value.trim(), password: f.password.value };
  const reg = authMode !== 'login';
  if (reg) body.displayName = f.displayName.value.trim();
  $('#authSubmit').disabled = true;
  try {
    const r = await api('POST', reg ? '/api/auth/register' : '/api/auth/login', body);
    S.user = r.user; f.password.value = '';
    await startApp();
  } catch (err) { $('#authError').textContent = err.message; }
  finally { $('#authSubmit').disabled = false; }
});

// ---------------------------------------------------------------- boot
async function boot() {
  try { S.config = await api('GET', '/api/config'); } catch { S.config = { allowRegistration: false }; }
  if (S.config.needsSetup) return showAuth('setup');
  try { S.user = (await api('GET', '/api/auth/me')).user; } catch { return showAuth('login'); }
  await startApp();
}

async function startApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  updateUserBtn();
  const c = await api('GET', '/api/crops');
  S.crops = new Map(c.crops.map((x) => [x.id, x]));
  S.companions = c.companions || {};
  renderLibrary();
  await loadPlans();
  const last = localStorage.getItem('gp_last_plan');
  const pick = S.plans.find((p) => p.id === last) || S.plans[0];
  if (pick) await openPlan(pick.id); else showNoPlan();
}

function updateUserBtn() {
  const u = S.user;
  $('#userBtn').innerHTML = `<span class="avatar" style="background:${esc(u.color)};margin:0;border-color:transparent">${esc(initials(u.displayName))}</span><span class="hide-md">${esc(u.displayName)}</span>`;
}
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

async function loadPlans() { S.plans = (await api('GET', '/api/plans')).plans; }

function showNoPlan() {
  S.plan = null; S.items.clear(); S.sel.clear();
  if (S.es) { S.es.close(); S.es = null; }
  $('#planBtn').textContent = 'No plan ▾';
  const p = $('#noPlan');
  p.innerHTML = `<div class="empty"><h2>Lay out your first garden</h2><p>Set the size of your plot, then drag beds and plants onto it. Spacing is drawn to scale so you can see how much fits.</p><p><button class="btn primary" id="firstPlan">Create a garden plan</button></p></div>`;
  $('#firstPlan').addEventListener('click', () => planDialog());
  setView('layout');
  renderAll();
}

async function openPlan(id) {
  const r = await api('GET', `/api/plans/${id}`);
  S.plan = r.plan; S.role = r.plan.role; S.members = r.members;
  S.items = new Map(r.items.map((i) => [i.id, i]));
  for (const c of r.crops) S.crops.set(c.id, c);
  S.sel.clear(); S.undo = []; S.redo = []; S.cursors.clear(); S.placing = null;
  localStorage.setItem('gp_last_plan', id);
  $('#planBtn').textContent = `${S.plan.name} ▾`;
  $('#noPlan').classList.add('hidden');
  connectLive(id);
  setView(S.viewMode);
  requestAnimationFrame(() => { fitView(); renderAll(); });
  renderLibrary();
}

async function reloadPlanData() {
  if (!S.plan) return;
  try {
    const r = await api('GET', `/api/plans/${S.plan.id}`);
    S.plan = r.plan; S.role = r.plan.role; S.members = r.members;
    S.items = new Map(r.items.map((i) => [i.id, i]));
    for (const c of r.crops) S.crops.set(c.id, c);
    for (const id of [...S.sel]) if (!S.items.has(id)) S.sel.delete(id);
    $('#planBtn').textContent = `${S.plan.name} ▾`;
    renderAll();
  } catch (e) {
    if (e.status === 404 || e.status === 403) { toast('You no longer have access to that plan', true); await loadPlans(); S.plans[0] ? openPlan(S.plans[0].id) : showNoPlan(); }
  }
}

// ---------------------------------------------------------------- live sync
function setSync(state) {
  const el = $('#syncStatus');
  el.className = 'sync hide-md' + (state === 'ok' ? '' : state === 'err' ? ' err' : ' off');
  el.textContent = state === 'ok' ? 'Live' : state === 'err' ? 'Not saved' : 'Reconnecting';
}
let reconnectTimer;
function connectLive(planId) {
  if (S.es) S.es.close();
  clearTimeout(reconnectTimer);
  const es = new EventSource(`/api/plans/${encodeURIComponent(planId)}/events?clientId=${S.clientId}`);
  S.es = es;
  let first = true;
  const on = (ev, fn) => es.addEventListener(ev, (e) => { if (S.es !== es) return; fn(JSON.parse(e.data)); });
  on('hello', () => { setSync('ok'); if (!first) reloadPlanData(); first = false; });
  es.onerror = () => {
    if (S.es !== es) return;
    setSync('off');
    if (es.readyState === EventSource.CLOSED) reconnectTimer = setTimeout(async () => { await reloadPlanData(); if (S.plan && S.plan.id === planId) connectLive(planId); }, 4000);
  };
  on('items', (d) => {
    if (d.clientId === S.clientId) return;
    for (const it of d.items) S.items.set(it.id, it);
    scheduleRender(); refreshSideViews();
  });
  on('delete', (d) => {
    if (d.clientId === S.clientId) return;
    for (const id of d.ids) { S.items.delete(id); S.sel.delete(id); }
    scheduleRender(); refreshSideViews();
  });
  on('plan', (d) => {
    if (d.clientId === S.clientId) return;
    S.plan = { ...S.plan, ...d.plan, role: S.role };
    $('#planBtn').textContent = `${S.plan.name} ▾`;
    scheduleRender(); refreshSideViews();
  });
  on('crop', (d) => { S.crops.set(d.crop.id, d.crop); scheduleRender(); });
  on('members', (d) => {
    S.members = d.members;
    const me = d.members.find((m) => m.id === S.user.id);
    if (me && me.role !== S.role) { S.role = me.role; renderLibrary(); toast(`Your access changed to ${me.role}`); }
    renderInspector();
  });
  on('presence', (d) => {
    S.presence = d.users;
    const live = new Set(d.users.map((u) => u.clientId));
    for (const k of S.cursors.keys()) if (!live.has(k)) S.cursors.delete(k);
    renderPresence(); scheduleRender();
  });
  on('cursor', (d) => {
    if (d.clientId === S.clientId) return;
    S.cursors.set(d.clientId, { ...d, t: Date.now() });
    scheduleRender();
  });
  on('revoked', async (d) => {
    es.close(); S.es = null;
    toast(d.reason || 'Access removed', true);
    await loadPlans();
    S.plans[0] ? openPlan(S.plans[0].id) : showNoPlan();
  });
}

function renderPresence() {
  const seen = new Map();
  for (const u of S.presence) if (!seen.has(u.id)) seen.set(u.id, u);
  $('#presence').innerHTML = [...seen.values()].slice(0, 6).map((u) =>
    `<span class="avatar" style="background:${esc(u.color)}" title="${esc(u.displayName)}${u.id === S.user.id ? ' (you)' : ''} is viewing">${esc(initials(u.displayName))}</span>`).join('');
}

let lastCursorSend = 0, cursorTimer;
function sendCursor(pt) {
  if (!S.plan || S.presence.length < 2) return;
  const go = () => {
    lastCursorSend = Date.now();
    api('POST', `/api/plans/${S.plan.id}/cursor`, { clientId: S.clientId, x: pt.x, y: pt.y, selection: [...S.sel] }).catch(() => {});
  };
  clearTimeout(cursorTimer);
  if (Date.now() - lastCursorSend > 120) go(); else cursorTimer = setTimeout(go, 120);
}
setInterval(() => { // fade idle cursors
  let ch = false;
  for (const [k, c] of S.cursors) if (Date.now() - c.t > 15000) { S.cursors.delete(k); ch = true; }
  if (ch) scheduleRender();
}, 3000);

// ---------------------------------------------------------------- saving + history
let saveQueue = Promise.resolve();
function persist(upserts, deletes) {
  if (!S.plan || !canEdit()) return;
  const planId = S.plan.id;
  saveQueue = saveQueue.then(async () => {
    try {
      if (upserts.length) await api('POST', `/api/plans/${planId}/items`, { items: upserts, clientId: S.clientId });
      if (deletes.length) await api('POST', `/api/plans/${planId}/items/delete`, { ids: deletes, clientId: S.clientId });
      if (S.es && S.es.readyState === 1) setSync('ok');
    } catch (e) {
      setSync('err'); toast(`Couldn't save: ${e.message}. Reloading the plan.`, true);
      reloadPlanData();
    }
  });
}
function commit(ids, before, after) {
  // before/after: arrays aligned with ids; null means "did not exist"
  S.undo.push({ ids, before: clone(before), after: clone(after) });
  if (S.undo.length > 300) S.undo.shift();
  S.redo = [];
  const ups = [], dels = [];
  ids.forEach((id, i) => { if (after[i]) ups.push(after[i]); else dels.push(id); });
  persist(ups, dels);
  updateUndoBtns();
}
function applyHistory(entry, useBefore) {
  const list = useBefore ? entry.before : entry.after;
  const ups = [], dels = [];
  entry.ids.forEach((id, i) => {
    const v = list[i];
    if (v) { S.items.set(id, clone(v)); ups.push(clone(v)); } else { S.items.delete(id); S.sel.delete(id); dels.push(id); }
  });
  persist(ups, dels);
  renderAll();
}
function undo() { if (!canEdit()) return; const e = S.undo.pop(); if (!e) return; S.redo.push(e); applyHistory(e, true); updateUndoBtns(); }
function redo() { if (!canEdit()) return; const e = S.redo.pop(); if (!e) return; S.undo.push(e); applyHistory(e, false); updateUndoBtns(); }
function updateUndoBtns() { $('#undoBtn').disabled = !S.undo.length || !canEdit(); $('#redoBtn').disabled = !S.redo.length || !canEdit(); }

// Change existing items via a mutator, with undo + save.
function mutate(ids, fn) {
  if (!canEdit()) return;
  ids = ids.filter((id) => S.items.has(id));
  if (!ids.length) return;
  const before = ids.map((id) => clone(S.items.get(id)));
  ids.forEach((id) => { const it = S.items.get(id); fn(it); it.props = it.props || {}; });
  const after = ids.map((id) => clone(S.items.get(id)));
  commit(ids, before, after);
  renderAll();
}
function addItems(items, select = true) {
  if (!canEdit()) return;
  for (const it of items) S.items.set(it.id, it);
  commit(items.map((i) => i.id), items.map(() => null), items.map(clone));
  if (select) { S.sel = new Set(items.map((i) => i.id)); }
  renderAll();
}
function removeItems(ids) {
  if (!canEdit()) return;
  ids = ids.filter((id) => S.items.has(id));
  if (!ids.length) return;
  const before = ids.map((id) => clone(S.items.get(id)));
  ids.forEach((id) => { S.items.delete(id); S.sel.delete(id); });
  commit(ids, before, ids.map(() => null));
  renderAll();
}

// ---------------------------------------------------------------- crop maths
const cropOf = (it) => S.crops.get(it.cropId) || { name: 'Unknown plant', icon: '🌱', color: '#888888', spacing: 12, rowSpacing: 12, timing: {}, family: '' };
function plantGrid(it) {
  const c = cropOf(it); const p = it.props || {};
  const s = Number(p.spacing) || c.spacing;
  const rs = S.plan?.mode === 'sfg' ? s : (Number(p.rowSpacing) || c.rowSpacing);
  // rows run along the long side of the block
  const [sx, sy] = it.w >= it.h ? [s, rs] : [rs, s];
  const cols = Math.max(1, Math.floor(it.w / sx + 1e-6));
  const rows = Math.max(1, Math.floor(it.h / sy + 1e-6));
  return { s, rs, sx, sy, cols, rows, count: cols * rows };
}
const rectsTouch = (a, b, pad = 0) => a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
function relation(a, b) {
  const A = S.companions[a] || {}, B = S.companions[b] || {};
  if ((A.bad || []).includes(b) || (B.bad || []).includes(a)) return 'bad';
  if ((A.good || []).includes(b) || (B.good || []).includes(a)) return 'good';
  return null;
}
function neighbours(it) {
  const out = { good: new Map(), bad: new Map(), overlap: false };
  for (const o of S.items.values()) {
    if (o.id === it.id || o.type !== 'crop') continue;
    if (!rectsTouch(it, o, 12)) continue;
    if (rectsTouch(it, o, -1)) out.overlap = true;
    if (o.cropId === it.cropId) continue;
    const rel = relation(it.cropId, o.cropId);
    if (rel) out[rel].set(o.cropId, cropOf(o));
  }
  return out;
}
function cropTimeline(c) {
  const lf = parseDate(S.plan?.lastFrost);
  if (!lf) return null;
  const t = c.timing || {};
  const span = (r) => (r ? [addDays(lf, r[0] * 7), addDays(lf, r[1] * 7 + 6)] : null);
  const res = { indoor: span(t.indoor), transplant: span(t.transplant), direct: span(t.direct) };
  const plantStart = res.transplant?.[0] || res.direct?.[0];
  if (plantStart && c.dtm && c.dtm < 300) res.harvest = [addDays(plantStart, c.dtm), addDays(plantStart, c.dtm + 35)];
  return res;
}

// ---------------------------------------------------------------- canvas
const svg = $('#canvas');
let renderQueued = false;
function scheduleRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderCanvas(); renderInspectorSoon(); }); } }
function renderAll() { renderCanvas(); renderInspector(); updateUndoBtns(); refreshSideViews(); }

function defsSvg(k) {
  const sw = 1 / k;
  return `
  <pattern id="gridFt" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#c7d1ba" stroke-width="${sw}"/></pattern>
  <pattern id="gridSub" width="${S.plan?.snap || 6}" height="${S.plan?.snap || 6}" patternUnits="userSpaceOnUse"><path d="M${S.plan?.snap || 6} 0H0V${S.plan?.snap || 6}" fill="none" stroke="#dde4d3" stroke-width="${sw}"/></pattern>
  <pattern id="soil" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.4" r=".45" fill="#000" fill-opacity=".14"/><circle cx="3.7" cy="3.6" r=".35" fill="#fff" fill-opacity=".08"/></pattern>
  <pattern id="gravel" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".9" fill="#b9b09c"/><circle cx="4.5" cy="4.2" r=".7" fill="#c9c1ae"/></pattern>
  <pattern id="lattice" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0L6 6M6 0L0 6" stroke="#7a5a3a" stroke-width=".6"/></pattern>`;
}

function groundSvg(k) {
  const p = S.plan; if (!p) return '';
  const W = p.width, H = p.height;
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#f3f6ec"/>`;
  if ((p.snap || 6) * k >= 9 && (p.snap || 6) < 12) s += `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#gridSub)"/>`;
  if (12 * k >= 5) s += `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#gridFt)"/>`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#93a387" stroke-width="${2 / k}"/>`;
  // rulers
  const fs = 11 / k;
  let step = 1; while (step * 12 * k < 34) step = step < 5 ? step + 1 : step * 2;
  const wf = Math.floor(W / 12), hf = Math.floor(H / 12);
  for (let f = 0; f <= wf; f += step) s += `<text x="${f * 12}" y="${-7 / k}" font-size="${fs}" text-anchor="middle" fill="#6f7b68">${f}′</text>`;
  for (let f = step; f <= hf; f += step) s += `<text x="${-7 / k}" y="${f * 12}" font-size="${fs}" text-anchor="end" dominant-baseline="central" fill="#6f7b68">${f}′</text>`;
  return s;
}

function objectSvg(it, k) {
  const { x, y, w, h } = it; const p = it.props || {};
  const sw = 1 / k;
  const lfs = Math.min(11 / k, w / Math.max(1, (p.label || '').length * 0.58));
  const name = p.label && lfs * k >= 6 ? `<text x="${x}" y="${y - 4 / k}" font-size="${lfs}" fill="#3b4637" font-weight="600" pointer-events="none">${esc(p.label)}</text>` : '';
  const nameDark = name;
  switch (it.type) {
    case 'raised-bed': {
      const f = Math.min(2, w / 6, h / 6);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${f / 2}" fill="#b07f4f" stroke="#7d5532" stroke-width="${sw}"/>
        <rect x="${x + f}" y="${y + f}" width="${w - 2 * f}" height="${h - 2 * f}" fill="#6b4a32"/>
        <rect x="${x + f}" y="${y + f}" width="${w - 2 * f}" height="${h - 2 * f}" fill="url(#soil)"/>${name}`;
    }
    case 'bed':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(4, w / 8, h / 8)}" fill="#7d5a3f"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(4, w / 8, h / 8)}" fill="url(#soil)"/>${name}`;
    case 'container': {
      const f = Math.min(1.5, w / 6, h / 6);
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#c4693d" stroke="#99502c" stroke-width="${sw}"/><ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2 - f}" ry="${h / 2 - f}" fill="#6b4a32"/><ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2 - f}" ry="${h / 2 - f}" fill="url(#soil)"/>${name}`;
    }
    case 'path':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e2dccd"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#gravel)"/>${nameDark}`;
    case 'fence': {
      let posts = ''; const horiz = w >= h; const len = horiz ? w : h; const t = horiz ? h : w;
      for (let d = 0; d <= len + 0.01; d += 72) { const pd = Math.min(d, len - t); posts += horiz ? `<rect x="${x + pd}" y="${y}" width="${t}" height="${t}" fill="#5a3a1e"/>` : `<rect x="${x}" y="${y + pd}" width="${t}" height="${t}" fill="#5a3a1e"/>`; }
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#9a6a3c"/>${posts}`;
    }
    case 'trellis':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e9dcc6" stroke="#7a5a3a" stroke-width="${sw * 1.5}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#lattice)"/>`;
    case 'tree': {
      const r = Math.min(w, h) / 2;
      return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${r}" fill="#4f8a3d" fill-opacity=".35" stroke="#3d6b35" stroke-width="${sw * 1.5}"/><circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.max(1.5, r * 0.08)}" fill="#6b4a32"/>${nameDark}`;
    }
    case 'structure':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d3d7cf" stroke="#727c6f" stroke-width="${sw * 1.5}"/><path d="M${x} ${y}L${x + w} ${y + h}M${x + w} ${y}L${x} ${y + h}" stroke="#727c6f" stroke-opacity=".35" stroke-width="${sw}"/>${nameDark}`;
    case 'water':
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#8cc3e8" stroke="#3e85b8" stroke-width="${sw * 1.5}"/>${name}`;
    case 'label': {
      const size = Number(p.size) || 8;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/><text x="${x}" y="${y + h / 2}" font-size="${size}" dominant-baseline="central" fill="${esc(p.color || '#23301f')}" font-weight="600">${esc(p.text || 'Label')}</text>`;
    }
    default: return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ccc"/>`;
  }
}

function cropSvg(it, k, flags) {
  const c = cropOf(it); const g = plantGrid(it);
  const { x, y, w, h } = it;
  const col = esc(c.color);
  const conflict = flags.overlap;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(2, w / 6, h / 6)}" fill="${col}" fill-opacity=".10" stroke="${conflict ? '#c43d3d' : col}" stroke-opacity="${conflict ? 1 : 0.75}" stroke-width="${(conflict ? 2 : 1.2) / k}" stroke-dasharray="${conflict ? '' : `${4 / k} ${3 / k}`}"/>`;
  const ox = x + (w - g.cols * g.sx) / 2, oy = y + (h - g.rows * g.sy) / 2;
  const r = Math.max(0.5, (g.s / 2) * 0.94);
  const fsz = Math.max(0.6, Math.min(g.sx, g.sy, g.s) * 0.58);
  const showIcon = fsz * k >= 5;
  const plant = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-opacity=".55" stroke-width="${0.8 / k}"/>${showIcon ? `<text x="${cx}" y="${cy}" font-size="${fsz}" text-anchor="middle" dominant-baseline="central">${esc(c.icon)}</text>` : ''}`;
  if (g.count <= 80) {
    for (let i = 0; i < g.cols; i++) for (let j = 0; j < g.rows; j++) s += plant(ox + g.sx * (i + 0.5), oy + g.sy * (j + 0.5));
  } else {
    const pid = 'p_' + it.id;
    s += `<defs><pattern id="${pid}" x="${ox}" y="${oy}" width="${g.sx}" height="${g.sy}" patternUnits="userSpaceOnUse">${plant(g.sx / 2, g.sy / 2)}</pattern></defs>
      <rect x="${ox}" y="${oy}" width="${g.cols * g.sx}" height="${g.rows * g.sy}" fill="url(#${pid})"/>`;
  }
  if (flags.bad) {
    const bs = 14 / k;
    s += `<g pointer-events="none"><circle cx="${x + w}" cy="${y}" r="${bs / 2}" fill="#c43d3d" stroke="#fff" stroke-width="${1.5 / k}"/><text x="${x + w}" y="${y}" font-size="${bs * 0.7}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-weight="700">!</text></g>`;
  }
  return s;
}

function sortedItems() {
  return [...S.items.values()].sort((a, b) => (LAYER[a.type] ?? 1) - (LAYER[b.type] ?? 1) || (a.z || 0) - (b.z || 0) || (a.id < b.id ? -1 : 1));
}

function itemsSvg(k) {
  let out = '';
  for (const it of sortedItems()) {
    let inner;
    if (it.type === 'crop') {
      const n = neighbours(it);
      inner = cropSvg(it, k, { overlap: n.overlap, bad: n.bad.size > 0 });
    } else inner = objectSvg(it, k);
    out += `<g data-id="${esc(it.id)}" class="it">${inner}</g>`;
  }
  return out;
}

function overlaySvg(k) {
  let s = '';
  // remote selections
  for (const c of S.cursors.values()) {
    for (const id of c.selection || []) {
      const it = S.items.get(id); if (!it) continue;
      s += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="${esc(c.color)}" stroke-width="${2 / k}" stroke-dasharray="${6 / k} ${3 / k}" pointer-events="none"/>`;
    }
  }
  // local selection
  const sel = [...S.sel].map((id) => S.items.get(id)).filter(Boolean);
  for (const it of sel) s += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="#e8a33d" stroke-width="${2 / k}" pointer-events="none"/>`;
  if (sel.length === 1 && canEdit() && !drag?.placing) {
    const it = sel[0];
    if (!it.props?.locked && it.type !== 'label') {
      const hs = 9 / k;
      const pts = { nw: [it.x, it.y], n: [it.x + it.w / 2, it.y], ne: [it.x + it.w, it.y], e: [it.x + it.w, it.y + it.h / 2], se: [it.x + it.w, it.y + it.h], s: [it.x + it.w / 2, it.y + it.h], sw: [it.x, it.y + it.h], w: [it.x, it.y + it.h / 2] };
      for (const [hname, [hx, hy]] of Object.entries(pts)) s += `<rect data-handle="${hname}" x="${hx - hs / 2}" y="${hy - hs / 2}" width="${hs}" height="${hs}" rx="${1.5 / k}" fill="#fff" stroke="#e8a33d" stroke-width="${1.5 / k}" style="cursor:${hname.length === 2 ? (hname === 'nw' || hname === 'se' ? 'nwse' : 'nesw') : hname === 'n' || hname === 's' ? 'ns' : 'ew'}-resize"/>`;
    }
    s += dimLabel(it, k);
  }
  // placement preview / marquee
  if (drag?.preview) {
    const pv = drag.preview;
    s += `<g opacity=".65" pointer-events="none">${pv.type === 'crop' ? cropSvg(pv, k, {}) : objectSvg(pv, k)}</g>` + dimLabel(pv, k);
  }
  if (drag?.kind === 'marquee' && drag.rect) {
    const m = drag.rect;
    s += `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="#e8a33d" fill-opacity=".08" stroke="#e8a33d" stroke-width="${1 / k}" stroke-dasharray="${4 / k} ${3 / k}" pointer-events="none"/>`;
  }
  // remote cursors
  for (const c of S.cursors.values()) {
    const nm = esc(c.displayName);
    s += `<g transform="translate(${c.x} ${c.y}) scale(${1 / k})" pointer-events="none"><path d="M0 0L0 15L4.2 11L7.5 18L10 17L6.8 10.2L12 10.2Z" fill="${esc(c.color)}" stroke="#fff" stroke-width="1.2"/><rect x="12" y="16" rx="4" height="18" width="${nm.length * 6.6 + 12}" fill="${esc(c.color)}"/><text x="18" y="25" font-size="11" fill="#fff" dominant-baseline="central" font-weight="600">${nm}</text></g>`;
  }
  return s;
}
function dimLabel(it, k) {
  const t = `${fmtLen(it.w)} × ${fmtLen(it.h)}${it.type === 'crop' ? ` · ${plantGrid(it).count} plants` : ''}`;
  const fs = 11 / k, pad = 4 / k, tw = t.length * fs * 0.55 + pad * 2;
  const lx = it.x + it.w / 2, ly = it.y - 16 / k;
  return `<g pointer-events="none"><rect x="${lx - tw / 2}" y="${ly - fs * 0.8}" width="${tw}" height="${fs * 1.6}" rx="${3 / k}" fill="#23301f"/><text x="${lx}" y="${ly}" font-size="${fs}" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(t)}</text></g>`;
}

function renderCanvas() {
  const k = S.view.k;
  $('#world').setAttribute('transform', `translate(${S.view.x} ${S.view.y}) scale(${k})`);
  $('#defs').innerHTML = defsSvg(k);
  $('#ground').innerHTML = groundSvg(k);
  $('#items').innerHTML = S.plan ? itemsSvg(k) : '';
  $('#overlay').innerHTML = S.plan ? overlaySvg(k) : '';
  $('#zoomLabel').textContent = `${Math.round(k * 50)}%`;
  svg.classList.toggle('placing', !!S.placing);
  svg.classList.toggle('tool-hand', S.tool === 'hand' || spaceDown);
  const hint = $('#placeHint');
  if (S.placing && S.viewMode === 'layout') {
    const what = S.placing.kind === 'crop' ? S.crops.get(S.placing.id)?.name : OBJ[S.placing.type]?.name;
    hint.innerHTML = `Placing ${esc(what)}: click for one, drag to fill an area. <kbd>Esc</kbd> to stop`;
    hint.classList.remove('hidden');
  } else hint.classList.add('hidden');
}

// ---------------------------------------------------------------- view / zoom
function fitView() {
  if (!S.plan) return;
  const r = svg.getBoundingClientRect();
  const pad = 56;
  const k = clamp(Math.min((r.width - pad * 2) / S.plan.width, (r.height - pad * 2) / S.plan.height), 0.05, 40);
  S.view = { k, x: (r.width - S.plan.width * k) / 2, y: (r.height - S.plan.height * k) / 2 };
  scheduleRender();
}
function zoomAt(factor, sx, sy) {
  const r = svg.getBoundingClientRect();
  if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
  const k2 = clamp(S.view.k * factor, 0.05, 40);
  const f = k2 / S.view.k;
  S.view.x = sx - (sx - S.view.x) * f; S.view.y = sy - (sy - S.view.y) * f; S.view.k = k2;
  scheduleRender();
}
function toWorld(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - S.view.x) / S.view.k, y: (e.clientY - r.top - S.view.y) / S.view.k };
}
const snapStep = () => S.plan?.snap || 6;
const snap = (v, free) => (free ? Math.round(v * 2) / 2 : Math.round(v / snapStep()) * snapStep());

// ---------------------------------------------------------------- pointer interaction
let drag = null;
let spaceDown = false;
const pointers = new Map();
let pinch = null;

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

svg.addEventListener('pointerdown', (e) => {
  if (!S.plan) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { // pinch zoom on touch
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...S.view } };
    if (drag && drag.kind !== 'pan') cancelDrag();
    drag = null; return;
  }
  hideTooltip();
  svg.setPointerCapture(e.pointerId);
  const pt = toWorld(e);
  const target = e.target;
  if (e.button === 1 || e.button === 2 || S.tool === 'hand' || spaceDown) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: { ...S.view } };
    svg.classList.add('panning'); return;
  }
  if (e.button !== 0) return;
  if (S.placing && canEdit()) {
    const start = { x: snap(pt.x, e.altKey), y: snap(pt.y, e.altKey) };
    drag = { kind: 'place', start, sx: e.clientX, sy: e.clientY, placing: true };
    drag.preview = placementItem(start, start, e, true);
    scheduleRender(); return;
  }
  const handle = target.closest('[data-handle]');
  if (handle && S.sel.size === 1) {
    const id = [...S.sel][0];
    drag = { kind: 'resize', handle: handle.dataset.handle, id, orig: clone(S.items.get(id)), start: pt };
    return;
  }
  const g = target.closest('[data-id]');
  if (g) {
    const id = g.dataset.id;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
      renderAll(); sendCursor(pt); return;
    }
    if (!S.sel.has(id)) { S.sel = new Set([id]); renderAll(); sendCursor(pt); }
    if (!canEdit()) return;
    const ids = [...S.sel].filter((i) => !S.items.get(i)?.props?.locked);
    if (!ids.length) return;
    drag = { kind: 'move', ids, orig: new Map(ids.map((i) => [i, clone(S.items.get(i))])), start: pt, moved: false, anchor: S.items.get(id) };
    return;
  }
  // empty canvas → marquee
  if (!e.shiftKey) S.sel.clear();
  drag = { kind: 'marquee', start: pt, base: new Set(S.sel) };
  renderAll();
});

svg.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = svg.getBoundingClientRect();
    const k2 = clamp(pinch.view.k * dist / pinch.dist, 0.05, 40);
    const wx = (pinch.mid.x - r.left - pinch.view.x) / pinch.view.k, wy = (pinch.mid.y - r.top - pinch.view.y) / pinch.view.k;
    S.view = { k: k2, x: mid.x - r.left - wx * k2, y: mid.y - r.top - wy * k2 };
    scheduleRender(); return;
  }
  const pt = toWorld(e);
  if (!drag) { hoverTooltip(e); sendCursor(pt); return; }
  if (drag.kind === 'pan') {
    S.view.x = drag.view.x + (e.clientX - drag.sx); S.view.y = drag.view.y + (e.clientY - drag.sy);
    scheduleRender(); return;
  }
  sendCursor(pt);
  if (drag.kind === 'place') {
    drag.preview = placementItem(drag.start, { x: snap(pt.x, e.altKey), y: snap(pt.y, e.altKey) }, e, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5);
    scheduleRender(); return;
  }
  if (drag.kind === 'move') {
    const a = drag.orig.get(drag.anchor.id) || [...drag.orig.values()][0];
    const dx = snap(a.x + pt.x - drag.start.x, e.altKey) - a.x;
    const dy = snap(a.y + pt.y - drag.start.y, e.altKey) - a.y;
    if (!drag.moved && Math.abs(pt.x - drag.start.x) * S.view.k < 3 && Math.abs(pt.y - drag.start.y) * S.view.k < 3) return;
    drag.moved = true;
    for (const [id, o] of drag.orig) { const it = S.items.get(id); if (it) { it.x = o.x + dx; it.y = o.y + dy; } }
    liveSend(drag.ids); scheduleRender(); return;
  }
  if (drag.kind === 'resize') {
    const it = S.items.get(drag.id); if (!it) return;
    const o = drag.orig; const h = drag.handle;
    const px = snap(pt.x, e.altKey), py = snap(pt.y, e.altKey);
    const min = e.altKey ? 1 : Math.min(snapStep(), 6);
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (h.includes('w')) x1 = Math.min(px, x2 - min);
    if (h.includes('e')) x2 = Math.max(px, x1 + min);
    if (h.includes('n')) y1 = Math.min(py, y2 - min);
    if (h.includes('s')) y2 = Math.max(py, y1 + min);
    if (e.shiftKey && (it.type === 'container' || it.type === 'tree' || it.type === 'water')) { const d = Math.max(x2 - x1, y2 - y1); if (h.includes('w')) x1 = x2 - d; else x2 = x1 + d; if (h.includes('n')) y1 = y2 - d; else y2 = y1 + d; }
    Object.assign(it, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    drag.moved = true;
    liveSend([it.id]); scheduleRender(); return;
  }
  if (drag.kind === 'marquee') {
    const x = Math.min(drag.start.x, pt.x), y = Math.min(drag.start.y, pt.y);
    drag.rect = { x, y, w: Math.abs(pt.x - drag.start.x), h: Math.abs(pt.y - drag.start.y) };
    S.sel = new Set(drag.base);
    for (const it of S.items.values()) if (it.x >= x && it.y >= y && it.x + it.w <= x + drag.rect.w && it.y + it.h <= y + drag.rect.h) S.sel.add(it.id);
    scheduleRender();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (!drag) return;
  const d = drag; drag = null;
  svg.classList.remove('panning');
  if (d.kind === 'place' && d.preview) {
    const it = d.preview; delete it._preview;
    it.z = nextZ();
    addItems([it], S.placing?.kind !== 'crop');
    if (S.placing?.kind === 'object') { S.placing = null; renderLibrary(); }
    if (it.type === 'label') setTimeout(() => $('#inspector [data-prop="text"]')?.focus(), 50);
  } else if ((d.kind === 'move' || d.kind === 'resize') && d.moved) {
    const ids = d.kind === 'move' ? d.ids : [d.id];
    const before = ids.map((id) => (d.kind === 'move' ? d.orig.get(id) : d.orig));
    clearTimeout(liveTimer);
    commit(ids, before, ids.map((id) => clone(S.items.get(id))));
  }
  renderAll();
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; cancelDrag(); });
svg.addEventListener('contextmenu', (e) => e.preventDefault());
svg.addEventListener('pointerleave', hideTooltip);

function cancelDrag() {
  if (!drag) return;
  if (drag.kind === 'move') for (const [id, o] of drag.orig) S.items.set(id, o);
  if (drag.kind === 'resize') S.items.set(drag.id, drag.orig);
  if ((drag.kind === 'move' || drag.kind === 'resize') && drag.moved) persist(drag.kind === 'move' ? [...drag.orig.values()] : [drag.orig], []);
  drag = null; svg.classList.remove('panning'); renderAll();
}

let liveTimer, liveLast = 0;
function liveSend(ids) { // stream intermediate positions so collaborators see movement
  const go = () => { liveLast = Date.now(); persist(ids.map((id) => clone(S.items.get(id))).filter(Boolean), []); };
  clearTimeout(liveTimer);
  if (Date.now() - liveLast > 180) go(); else liveTimer = setTimeout(() => { if (drag) go(); }, 180);
}

function nextZ() { let z = 0; for (const it of S.items.values()) z = Math.max(z, it.z || 0); return z + 1; }

function placementItem(a, b, e, isClick) {
  const P = S.placing;
  let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (P.kind === 'crop') {
    const c = S.crops.get(P.id);
    if (isClick || w < 1 || h < 1) {
      const sz = Math.max(c.spacing, Math.min(12, c.rowSpacing));
      const size = snapStep() > sz ? sz : Math.ceil(sz / snapStep()) * snapStep();
      w = Math.max(w, size); h = Math.max(h, size);
      if (isClick) { x = a.x; y = a.y; }
    }
    return { id: uid(), type: 'crop', cropId: P.id, x, y, w, h, z: 0, props: {}, _preview: true };
  }
  const o = OBJ[P.type];
  if (isClick || (w < 2 && h < 2)) { w = o.w; h = o.h; x = a.x; y = a.y; }
  if (P.type === 'fence' || P.type === 'trellis') { if (w >= h) h = Math.max(h, o.h); else w = Math.max(w, o.h); }
  w = Math.max(w, 2); h = Math.max(h, 2);
  const props = {};
  if (o.label) props.label = o.label;
  if (P.type === 'label') { props.text = 'Label'; props.size = 8; w = 30; h = 10; }
  return { id: uid(), type: P.type, cropId: null, x, y, w, h, z: 0, props, _preview: true };
}

// tooltips
function hoverTooltip(e) {
  const g = e.target.closest?.('[data-id]');
  const tip = $('#tooltip');
  if (!g || S.placing) return hideTooltip();
  const it = S.items.get(g.dataset.id); if (!it) return hideTooltip();
  let html;
  if (it.type === 'crop') {
    const c = cropOf(it); const gr = plantGrid(it);
    html = `<b>${esc(c.icon)} ${esc(c.name)}${it.props?.variety ? ` · ${esc(it.props.variety)}` : ''}</b><br>${gr.count} plant${gr.count === 1 ? '' : 's'} · ${fmtLen(it.w)} × ${fmtLen(it.h)}`;
  } else html = `<b>${esc(it.props?.label || it.props?.text || OBJ[it.type]?.name)}</b><br>${fmtLen(it.w)} × ${fmtLen(it.h)}`;
  tip.innerHTML = html;
  tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
  tip.classList.remove('hidden');
}
function hideTooltip() { $('#tooltip').classList.add('hidden'); }

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  if ($('#modal').open) return;
  const typing = e.target.matches('input, textarea, select, [contenteditable]');
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  if (!S.plan || S.viewMode !== 'layout') return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (k === ' ') { if (!spaceDown) { spaceDown = true; scheduleRender(); } e.preventDefault(); return; }
  if (k === 'Escape') { if (drag) cancelDrag(); S.placing = null; S.sel.clear(); renderLibrary(); renderAll(); return; }
  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.items.keys()); renderAll(); return; }
  if (mod && k.toLowerCase() === 'c') { copySel(); return; }
  if (mod && k.toLowerCase() === 'v') { e.preventDefault(); paste(); return; }
  if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeItems([...S.sel]); return; }
  if (k.startsWith('Arrow') && S.sel.size) {
    e.preventDefault();
    const st = (e.altKey ? 1 : snapStep()) * (e.shiftKey ? 4 : 1);
    const dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
    mutate([...S.sel].filter((id) => !S.items.get(id)?.props?.locked), (it) => { it.x += dx; it.y += dy; });
    return;
  }
  if (mod) return;
  if (k === 'v' || k === 'V') setTool('select');
  else if (k === 'h' || k === 'H') setTool('hand');
  else if (k === '+' || k === '=') zoomAt(1.25);
  else if (k === '-' || k === '_') zoomAt(0.8);
  else if (k === '0') fitView();
});
document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; scheduleRender(); } });

function copySel() { S.clipboard = [...S.sel].map((id) => clone(S.items.get(id))).filter(Boolean); if (S.clipboard.length) toast(`Copied ${S.clipboard.length} item${S.clipboard.length > 1 ? 's' : ''}`); }
function paste() {
  if (!S.clipboard?.length || !canEdit()) return;
  const off = Math.max(12, snapStep() * 2);
  const items = S.clipboard.map((o) => ({ ...clone(o), id: uid(), x: o.x + off, y: o.y + off, z: nextZ() }));
  S.clipboard = items.map(clone);
  addItems(items);
}
function duplicateSel() { const keep = S.clipboard; copySel(); paste(); S.clipboard = keep; }
function setTool(t) { S.tool = t; S.placing = null; $('#toolSelect').setAttribute('aria-pressed', t === 'select'); $('#toolHand').setAttribute('aria-pressed', t === 'hand'); renderLibrary(); scheduleRender(); }

// ---------------------------------------------------------------- library (left)
function renderLibrary() {
  const lib = $('#lib');
  $$('.tabs [data-lib]').forEach((b) => b.setAttribute('aria-selected', b.dataset.lib === S.libTab));
  $('#plantTools').classList.toggle('hidden', S.libTab !== 'plants');
  $('#libFoot').classList.toggle('hidden', S.libTab !== 'plants');
  const ro = S.plan && !canEdit() ? '<div class="lib-group">You can view this plan but not change it.</div>' : '';
  if (S.libTab === 'objects') {
    lib.innerHTML = ro + OBJECTS.map((o) => `<button class="lib-item" data-obj="${o.type}" aria-pressed="${S.placing?.kind === 'object' && S.placing.type === o.type}">
      <svg class="swatch" viewBox="0 0 ${o.w > o.h ? 60 : 44} 44">${miniObject(o)}</svg>
      <span><span class="lib-name">${esc(o.name)}</span><br><span class="lib-meta">${fmtLen(o.w)} × ${fmtLen(o.h)}</span></span><span></span></button>`).join('');
    return;
  }
  const cats = ['All', 'Vegetable', 'Herb', 'Fruit', 'Flower', 'Mine'];
  $('#cropChips').innerHTML = cats.map((c) => `<button class="chip" data-cat="${c}" aria-pressed="${S.libFilter === c}">${c === 'Mine' ? 'My plants' : c === 'All' ? 'All' : c + 's'}</button>`).join('');
  const q = S.libSearch.toLowerCase();
  const list = [...S.crops.values()].filter((c) => (c.builtin || c.ownerId === S.user?.id)
    && (!q || c.name.toLowerCase().includes(q) || (c.family || '').toLowerCase().includes(q))
    && (S.libFilter === 'All' || (S.libFilter === 'Mine' ? !c.builtin : c.category === S.libFilter)));
  list.sort((a, b) => (a.builtin - b.builtin) || a.name.localeCompare(b.name));
  const mode = S.plan?.mode;
  const row = (c) => `<button class="lib-item" data-crop="${esc(c.id)}" aria-pressed="${S.placing?.kind === 'crop' && S.placing.id === c.id}" title="${esc(c.name)}: ${c.spacing}″ apart${mode === 'sfg' ? '' : `, rows ${c.rowSpacing}″ apart`}">
    <span class="lib-icon" style="background:${esc(c.color)}22">${esc(c.icon)}</span>
    <span style="min-width:0"><span class="lib-name">${esc(c.name)}</span><br><span class="lib-meta">${c.spacing}″ apart${mode === 'sfg' ? ` · ${Math.max(1, Math.floor(12 / c.spacing)) ** 2}/sq ft` : ` · rows ${c.rowSpacing}″`}</span></span>
    ${!c.builtin ? `<span class="btn ghost icon lib-edit" data-edit="${esc(c.id)}" role="button" aria-label="Edit ${esc(c.name)}">✎</span>` : '<span></span>'}</button>`;
  let html = ro;
  if (!list.length) html += `<div class="lib-group">No plants match “${esc(S.libSearch)}”.</div>`;
  else if (S.libFilter === 'All' && !q) {
    const groups = [['My plants', list.filter((c) => !c.builtin)], ...['Vegetable', 'Herb', 'Fruit', 'Flower'].map((g) => [g + 's', list.filter((c) => c.builtin && c.category === g)])];
    for (const [g, l] of groups) if (l.length) html += `<div class="lib-group">${g}</div>` + l.map(row).join('');
  } else html += list.map(row).join('');
  lib.innerHTML = html;
}
function miniObject(o) {
  const vw = o.w > o.h ? 60 : 44;
  const fake = { ...o, x: 4, y: 4, w: vw - 8, h: 36, props: { label: '' } };
  if (o.type === 'fence' || o.type === 'trellis') { fake.h = 8; fake.y = 18; }
  if (o.type === 'container' || o.type === 'tree' || o.type === 'water') { fake.w = 36; fake.x = (vw - 36) / 2; }
  if (o.type === 'label') return `<text x="${vw / 2}" y="26" font-size="16" text-anchor="middle" fill="#23301f" font-weight="700">Aa</text>`;
  return objectSvg(fake, 1).replace(/url\(#(soil|gravel|lattice)\)/g, 'none');
}
$$('.tabs [data-lib]').forEach((b) => b.addEventListener('click', () => { S.libTab = b.dataset.lib; renderLibrary(); }));
$('#cropSearch').addEventListener('input', (e) => { S.libSearch = e.target.value; renderLibrary(); });
$('#cropChips').addEventListener('click', (e) => { const c = e.target.closest('[data-cat]'); if (c) { S.libFilter = c.dataset.cat; renderLibrary(); } });
$('#lib').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-edit]');
  if (ed) { e.stopPropagation(); cropDialog(S.crops.get(ed.dataset.edit)); return; }
  const b = e.target.closest('.lib-item'); if (!b) return;
  if (!S.plan) return toast('Create a plan first');
  if (!canEdit()) return toast('You have view-only access to this plan');
  if (S.viewMode !== 'layout') setView('layout');
  const P = b.dataset.crop ? { kind: 'crop', id: b.dataset.crop } : { kind: 'object', type: b.dataset.obj };
  const same = S.placing && S.placing.kind === P.kind && (S.placing.id === P.id && S.placing.type === P.type);
  S.placing = same ? null : P;
  if (S.placing) S.sel.clear();
  renderLibrary(); renderAll();
  if (window.innerWidth <= 860) $('#sidebar').classList.remove('open');
});
$('#newCropBtn').addEventListener('click', () => cropDialog(null));

// ---------------------------------------------------------------- inspector (right)
let inspTimer;
function renderInspectorSoon() { clearTimeout(inspTimer); inspTimer = setTimeout(() => { if (!document.activeElement?.closest('#inspector')) renderInspector(); }, drag ? 120 : 0); }
function renderInspector() {
  const el = $('#inspector');
  if (!S.plan) { el.innerHTML = ''; return; }
  const sel = [...S.sel].map((id) => S.items.get(id)).filter(Boolean);
  const dis = canEdit() ? '' : 'disabled';
  if (!sel.length) { el.innerHTML = planSummary(); bindInspector(el, []); return; }
  if (sel.length > 1) {
    const plants = sel.filter((i) => i.type === 'crop').reduce((n, i) => n + plantGrid(i).count, 0);
    el.innerHTML = `<div class="insp-sec"><div class="insp-head"><div><h2>${sel.length} items selected</h2><p>${plants ? `${plants} plants` : 'Beds and objects'}</p></div></div></div>
      <div class="insp-sec"><div class="btn-row">${actionButtons(sel, dis)}</div></div>`;
    bindInspector(el, sel); return;
  }
  const it = sel[0]; const p = it.props || {};
  let html = '';
  if (it.type === 'crop') {
    const c = cropOf(it); const g = plantGrid(it); const n = neighbours(it); const tl = cropTimeline(c);
    html += `<div class="insp-sec"><div class="insp-head"><span class="lib-icon" style="background:${esc(c.color)}22">${esc(c.icon)}</span><div><h2>${esc(c.name)}</h2><p>${esc(c.family || c.category)}${c.dtm ? ` · ${c.dtm} days to harvest` : ''}${c.perennial ? ' · perennial' : ''}</p></div></div></div>
    <div class="insp-sec"><div class="big-count num">${g.count}<small>plant${g.count === 1 ? '' : 's'}</small></div>
      <p class="lib-meta" style="margin:6px 0 0">${g.cols} × ${g.rows} at ${g.s}″ apart${S.plan.mode === 'sfg' ? '' : `, rows ${g.rs}″ apart`} · ${r2(it.w * it.h / 144)} sq ft</p>
      ${n.overlap ? '<p class="error" style="margin:8px 0 0">This planting overlaps another one.</p>' : ''}</div>
    <div class="insp-sec"><h3>Planting</h3>
      <label class="field"><span>Variety</span><input type="text" data-prop="variety" value="${esc(p.variety || '')}" placeholder="e.g. Cherokee Purple" ${dis}></label>
      ${sizeFields(it, dis)}
      <div class="grid2"><label class="field"><span>Spacing (in)</span><input type="number" min="0.5" step="0.5" data-prop="spacing" value="${p.spacing ?? ''}" placeholder="${c.spacing}" ${dis}></label>
      <label class="field"><span>Row spacing (in)</span><input type="number" min="0.5" step="0.5" data-prop="rowSpacing" value="${p.rowSpacing ?? ''}" placeholder="${c.rowSpacing}" ${dis || (S.plan.mode === 'sfg' ? 'disabled title="Square foot mode uses the same spacing both ways"' : '')}></label></div>
      <label class="field"><span>Date planted</span><input type="date" data-prop="planted" value="${esc(p.planted || '')}" ${dis}></label>
      <label class="field"><span>Notes</span><textarea data-prop="note" ${dis}>${esc(p.note || '')}</textarea></label></div>`;
    if (n.good.size || n.bad.size) {
      html += `<div class="insp-sec"><h3>Neighbours</h3>
      ${n.bad.size ? `<p style="margin:0 0 6px">Grows poorly next to</p><div class="tag-list" style="margin-bottom:10px">${[...n.bad.values()].map((x) => `<span class="tag bad">${esc(x.icon)} ${esc(x.name)}</span>`).join('')}</div>` : ''}
      ${n.good.size ? `<p style="margin:0 0 6px">Good companions nearby</p><div class="tag-list">${[...n.good.values()].map((x) => `<span class="tag">${esc(x.icon)} ${esc(x.name)}</span>`).join('')}</div>` : ''}</div>`;
    }
    html += `<div class="insp-sec"><h3>When to plant</h3>${timingHtml(c, tl)}</div>`;
  } else {
    const o = OBJ[it.type];
    html += `<div class="insp-sec"><div class="insp-head"><svg class="swatch" style="width:42px;height:42px" viewBox="0 0 ${o.w > o.h ? 60 : 44} 44">${miniObject(o)}</svg><div><h2>${esc(p.label || o.name)}</h2><p>${esc(o.name)} · ${r2(it.w * it.h / 144)} sq ft</p></div></div></div><div class="insp-sec">`;
    if (it.type === 'label') {
      html += `<label class="field"><span>Text</span><input type="text" data-prop="text" value="${esc(p.text || '')}" maxlength="80" ${dis}></label>
        <label class="field"><span>Text size (in)</span><input type="number" min="2" max="120" data-prop="size" value="${Number(p.size) || 8}" ${dis}></label>`;
    } else {
      html += `<label class="field"><span>Name</span><input type="text" data-prop="label" value="${esc(p.label || '')}" placeholder="${esc(o.name)}" maxlength="40" ${dis}></label>${sizeFields(it, dis)}`;
      if (it.type === 'raised-bed' || it.type === 'bed' || it.type === 'container') {
        const inside = [...S.items.values()].filter((x) => x.type === 'crop' && x.x >= it.x - 0.1 && x.y >= it.y - 0.1 && x.x + x.w <= it.x + it.w + 0.1 && x.y + x.h <= it.y + it.h + 0.1);
        const tally = new Map(); for (const x of inside) { const c = cropOf(x); tally.set(c.name, (tally.get(c.name) || 0) + plantGrid(x).count); }
        html += `<div class="field"><span>Planted in this bed</span>${tally.size ? `<div class="tag-list">${[...tally].map(([nm, ct]) => `<span class="tag">${esc(nm)} × ${ct}</span>`).join('')}</div>` : '<small>Nothing yet. Pick a plant on the left and drag inside the bed.</small>'}</div>`;
      }
    }
    html += `<label class="field"><span>Notes</span><textarea data-prop="note" ${dis}>${esc(p.note || '')}</textarea></label></div>`;
  }
  html += `<div class="insp-sec"><div class="btn-row">${actionButtons(sel, dis)}</div></div>`;
  el.innerHTML = html;
  bindInspector(el, sel);
}
function sizeFields(it, dis) {
  return `<div class="grid2"><label class="field"><span>Width</span><input type="text" data-dim="w" value="${fmtLen(it.w)}" ${dis || (it.props?.locked ? 'disabled' : '')}></label>
    <label class="field"><span>Length</span><input type="text" data-dim="h" value="${fmtLen(it.h)}" ${dis || (it.props?.locked ? 'disabled' : '')}></label></div>`;
}
function actionButtons(sel, dis) {
  const locked = sel.every((i) => i.props?.locked);
  return `<button class="btn" data-act="dup" ${dis}>Duplicate</button>
    <button class="btn" data-act="front" ${dis} title="Bring to front">Front</button>
    <button class="btn" data-act="back" ${dis} title="Send to back">Back</button>
    <button class="btn" data-act="lock" ${dis}>${locked ? 'Unlock' : 'Lock'}</button>
    <button class="btn danger" data-act="del" ${dis}>Delete</button>`;
}
function timingHtml(c, tl) {
  const t = c.timing || {};
  if (!t.indoor && !t.transplant && !t.direct) return `<p class="lib-meta" style="margin:0">${esc(c.note || 'No timing data for this plant.')}</p>`;
  if (!tl) {
    const wk = (r) => { const f = (n) => (n === 0 ? 'at' : `${Math.abs(n)} wk ${n < 0 ? 'before' : 'after'}`); return r[0] === r[1] ? f(r[0]) : `${f(r[0])} – ${f(r[1])}`; };
    return `<div class="timing">${t.indoor ? `<span class="dot" style="background:#8e4ec6"></span><span>Start indoors ${wk(t.indoor)} last frost</span>` : ''}${t.transplant ? `<span class="dot" style="background:#f76b15"></span><span>Transplant ${wk(t.transplant)} last frost</span>` : ''}${t.direct ? `<span class="dot" style="background:#3d6b35"></span><span>Sow outdoors ${wk(t.direct)} last frost</span>` : ''}</div>
      <p class="lib-meta" style="margin:8px 0 0"><button class="linkish" data-act="settings">Set your frost dates</button> to see calendar dates.</p>`;
  }
  const rg = (r) => `${fmtDate(r[0])} – ${fmtDate(r[1])}`;
  return `<div class="timing">${tl.indoor ? `<span class="dot" style="background:#8e4ec6"></span><span>Start indoors ${rg(tl.indoor)}</span>` : ''}${tl.transplant ? `<span class="dot" style="background:#f76b15"></span><span>Transplant ${rg(tl.transplant)}</span>` : ''}${tl.direct ? `<span class="dot" style="background:#3d6b35"></span><span>Sow outdoors ${rg(tl.direct)}</span>` : ''}${tl.harvest ? `<span class="dot" style="background:#e8a33d"></span><span>Harvest from about ${fmtDate(tl.harvest[0])}</span>` : ''}</div>${c.note ? `<p class="lib-meta" style="margin:8px 0 0">${esc(c.note)}</p>` : ''}`;
}
function planSummary() {
  const p = S.plan;
  const items = [...S.items.values()];
  const crops = items.filter((i) => i.type === 'crop');
  const plants = crops.reduce((n, i) => n + plantGrid(i).count, 0);
  const kinds = new Set(crops.map((i) => i.cropId)).size;
  const beds = items.filter((i) => ['bed', 'raised-bed', 'container'].includes(i.type));
  const bedArea = beds.reduce((a, b) => a + b.w * b.h, 0) / 144;
  const lf = parseDate(p.lastFrost), ff = parseDate(p.firstFrost);
  return `<div class="insp-sec"><div class="insp-head"><div><h2>${esc(p.name)}</h2><p>${fmtLen(p.width)} × ${fmtLen(p.height)} · ${r2(p.width * p.height / 144)} sq ft${p.year ? ` · ${p.year}` : ''}</p></div></div></div>
  <div class="insp-sec"><div class="big-count num">${plants}<small>plants · ${kinds} kind${kinds === 1 ? '' : 's'}</small></div>
    <div style="margin-top:10px"><div class="stat-line"><span>Plantings</span><span class="num">${crops.length}</span></div>
    <div class="stat-line"><span>Beds and containers</span><span class="num">${beds.length}</span></div>
    <div class="stat-line"><span>Growing area</span><span class="num">${r2(bedArea)} sq ft</span></div>
    <div class="stat-line"><span>Last spring frost</span><span>${lf ? fmtDate(lf) : '<button class="linkish" data-act="settings">Set date</button>'}</span></div>
    <div class="stat-line"><span>First fall frost</span><span>${ff ? fmtDate(ff) : '—'}</span></div>
    <div class="stat-line"><span>Spacing</span><span>${p.mode === 'sfg' ? 'Square foot' : 'Rows'}</span></div></div></div>
  <div class="insp-sec"><h3>People on this plan</h3>${S.members.map((m) => `<div class="member"><span class="avatar" style="background:${esc(m.color)}">${esc(initials(m.displayName))}</span><span class="who">${esc(m.displayName)}<small>${m.role}</small></span></div>`).join('')}
    ${S.role === 'owner' ? '<button class="btn" data-act="share" style="margin-top:6px">Share plan</button>' : ''}</div>
  ${p.notes ? `<div class="insp-sec"><h3>Notes</h3><p style="margin:0;white-space:pre-wrap">${esc(p.notes)}</p></div>` : ''}
  <div class="insp-sec"><h3>Shortcuts</h3><div class="kbd-list">
    <kbd>Drag</kbd><span>Fill an area with the chosen plant</span><kbd>Alt</kbd><span>Hold to place without snapping</span>
    <kbd>Space</kbd><span>Hold and drag to pan</span><kbd>Wheel</kbd><span>Zoom</span>
    <kbd>Shift</kbd><span>Click to select several</span><kbd>Ctrl D</kbd><span>Duplicate</span>
    <kbd>Ctrl Z</kbd><span>Undo</span><kbd>Del</kbd><span>Delete selection</span><kbd>Arrows</kbd><span>Nudge</span></div></div>`;
}
function bindInspector(el, sel) {
  const ids = sel.map((i) => i.id);
  el.querySelectorAll('[data-prop]').forEach((inp) => inp.addEventListener('change', () => {
    const key = inp.dataset.prop; let v = inp.value;
    if (inp.type === 'number') v = v === '' ? undefined : Number(v);
    mutate(ids, (it) => {
      it.props = it.props || {};
      if (v === '' || v === undefined) delete it.props[key]; else it.props[key] = v;
      if (it.type === 'label') { const sz = Number(it.props.size) || 8; it.h = sz * 1.3; it.w = Math.max(sz, String(it.props.text || 'Label').length * sz * 0.58); }
    });
  }));
  el.querySelectorAll('[data-dim]').forEach((inp) => inp.addEventListener('change', () => {
    const v = parseLen(inp.value);
    if (!(v > 0)) { toast('Enter a size like 4\' 6" or 54', true); renderInspector(); return; }
    mutate(ids, (it) => { it[inp.dataset.dim] = v; });
  }));
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'del') removeItems(ids);
    else if (a === 'dup') { S.sel = new Set(ids); duplicateSel(); }
    else if (a === 'lock') { const lock = !sel.every((i) => i.props?.locked); mutate(ids, (it) => { it.props = it.props || {}; if (lock) it.props.locked = true; else delete it.props.locked; }); }
    else if (a === 'front') { let z = nextZ(); mutate(ids, (it) => { it.z = z++; }); }
    else if (a === 'back') { let z = Math.min(0, ...[...S.items.values()].map((i) => i.z || 0)) - ids.length; mutate(ids, (it) => { it.z = z++; }); }
    else if (a === 'settings') planDialog(S.plan);
    else if (a === 'share') shareDialog();
  }));
}

// ---------------------------------------------------------------- views: calendar & list
function setView(v) {
  S.viewMode = v;
  $$('.views [data-view]').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === v));
  $('#calendarView').classList.toggle('hidden', v !== 'calendar' || !S.plan);
  $('#listView').classList.toggle('hidden', v !== 'list' || !S.plan);
  $('#noPlan').classList.toggle('hidden', !!S.plan);
  $('#layoutTools').style.visibility = v === 'layout' ? 'visible' : 'hidden';
  if (v !== 'layout') S.placing = null;
  refreshSideViews(); scheduleRender();
}
$$('.views [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
function refreshSideViews() {
  if (!S.plan) return;
  if (S.viewMode === 'calendar') renderCalendar();
  if (S.viewMode === 'list') renderList();
}

function plantTally() {
  const m = new Map();
  for (const it of S.items.values()) {
    if (it.type !== 'crop') continue;
    const c = cropOf(it); const key = it.cropId + '|' + (it.props?.variety || '');
    const e = m.get(key) || { crop: c, variety: it.props?.variety || '', plantings: 0, plants: 0, area: 0 };
    e.plantings++; e.plants += plantGrid(it).count; e.area += it.w * it.h / 144;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => a.crop.name.localeCompare(b.crop.name) || a.variety.localeCompare(b.variety));
}

function renderList() {
  const rows = plantTally();
  const tot = rows.reduce((a, r) => ({ plants: a.plants + r.plants, area: a.area + r.area, plantings: a.plantings + r.plantings }), { plants: 0, area: 0, plantings: 0 });
  $('#listView').innerHTML = `<div class="sheet"><div class="sheet-head"><div><h2>Plant list</h2><p>${esc(S.plan.name)} · everything you need to buy or start</p></div>
    <div class="btn-row"><button class="btn" id="csvBtn">Download CSV</button><button class="btn" id="printList">Print</button></div></div>
    ${rows.length ? `<table class="table"><thead><tr><th>Plant</th><th>Variety</th><th class="r">Plantings</th><th class="r">Plants</th><th class="r">Area (sq ft)</th><th class="r">Spacing</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><span class="row" style="gap:8px"><span class="lib-icon" style="flex:0 0 30px;background:${esc(r.crop.color)}22">${esc(r.crop.icon)}</span>${esc(r.crop.name)}</span></td><td>${esc(r.variety || '—')}</td><td class="r num">${r.plantings}</td><td class="r num">${r.plants}</td><td class="r num">${r2(r.area)}</td><td class="r num">${r.crop.spacing}″${S.plan.mode === 'sfg' ? '' : ` × ${r.crop.rowSpacing}″`}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="2">Total</td><td class="r num">${tot.plantings}</td><td class="r num">${tot.plants}</td><td class="r num">${r2(tot.area)}</td><td></td></tr></tfoot></table>`
    : '<div class="empty"><h2>No plants yet</h2><p>Switch to Layout and place some plants. They will be counted here.</p></div>'}</div>`;
  $('#csvBtn').addEventListener('click', () => {
    const lines = [['Plant', 'Variety', 'Plantings', 'Plants', 'Area sq ft', 'Spacing in', 'Row spacing in'], ...rows.map((r) => [r.crop.name, r.variety, r.plantings, r.plants, r2(r.area), r.crop.spacing, r.crop.rowSpacing])];
    download(`${S.plan.name} plant list.csv`, new Blob([lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  });
  $('#printList').addEventListener('click', () => window.print());
}

function renderCalendar() {
  const p = S.plan;
  const lf = parseDate(p.lastFrost), ff = parseDate(p.firstFrost);
  const pane = $('#calendarView');
  const crops = [...new Map([...S.items.values()].filter((i) => i.type === 'crop').map((i) => [i.cropId, cropOf(i)])).values()];
  if (!lf) {
    pane.innerHTML = `<div class="sheet"><div class="empty"><h2>Add your frost dates</h2><p>Planting times are counted from your average last spring frost. Your local extension office or almanac.com/gardening/frostdates can tell you yours.</p><p><button class="btn primary" id="calSet">Set frost dates</button></p></div></div>`;
    $('#calSet').addEventListener('click', () => planDialog(p)); return;
  }
  const year = lf.getFullYear();
  const y0 = new Date(year, 0, 1), y1 = new Date(year + 1, 0, 1);
  const pos = (d) => clamp((d - y0) / (y1 - y0) * 100, 0, 100);
  const bar = (cls, r, label) => (r ? `<div class="cal-bar ${cls}" style="left:${pos(r[0])}%;width:${Math.max(0.6, pos(r[1]) - pos(r[0]))}%" title="${esc(label)}: ${fmtDate(r[0])} – ${fmtDate(r[1])}"></div>` : '');
  const marks = `<div class="cal-mark frost" style="left:${pos(lf)}%" title="Last frost ${fmtDate(lf)}"></div>${ff ? `<div class="cal-mark frost" style="left:${pos(ff)}%" title="First frost ${fmtDate(ff)}"></div>` : ''}${new Date() >= y0 && new Date() < y1 ? `<div class="cal-mark today" style="left:${pos(new Date())}%" title="Today"></div>` : ''}`;
  const withTl = crops.map((c) => ({ c, tl: cropTimeline(c) })).sort((a, b) => {
    const s = (x) => Math.min(...['indoor', 'transplant', 'direct'].map((k) => x.tl?.[k]?.[0]?.getTime() ?? Infinity));
    return s(a) - s(b) || a.c.name.localeCompare(b.c.name);
  });
  // task list
  const tasks = [];
  for (const { c, tl } of withTl) {
    if (!tl) continue;
    if (tl.indoor) tasks.push([tl.indoor[0], `Start ${c.name} seeds indoors`, c, '#8e4ec6']);
    if (tl.transplant) tasks.push([tl.transplant[0], `Transplant ${c.name} outside`, c, '#f76b15']);
    if (tl.direct) tasks.push([tl.direct[0], `Sow ${c.name} outdoors`, c, '#3d6b35']);
    if (tl.harvest) tasks.push([tl.harvest[0], `Start checking ${c.name} for harvest`, c, '#e8a33d']);
  }
  tasks.sort((a, b) => a[0] - b[0]);
  pane.innerHTML = `<div class="sheet"><div class="sheet-head"><div><h2>Planting calendar ${year}</h2><p>Based on last frost ${fmtDate(lf)}${ff ? ` and first frost ${fmtDate(ff)}` : ''}. Dates are estimates; adjust for your weather.</p></div><div class="btn-row"><button class="btn" id="calEdit">Change frost dates</button><button class="btn" id="calPrint">Print</button></div></div>
    ${crops.length ? `<div class="cal"><div></div><div class="cal-months">${MONTHS.map((m) => `<div>${m}</div>`).join('')}</div>
    ${withTl.map(({ c, tl }) => `<div class="cal-name"><span class="lib-icon" style="width:24px;height:24px;font-size:14px;background:${esc(c.color)}22">${esc(c.icon)}</span>${esc(c.name)}</div>
      <div class="cal-track">${marks}${tl ? bar('indoor', tl.indoor, 'Start indoors') + bar('transplant', tl.transplant, 'Transplant') + bar('direct', tl.direct, 'Sow outdoors') + bar('harvest', tl.harvest, 'Harvest') : ''}</div>`).join('')}</div>
    <div class="legend"><span><i style="background:#8e4ec6"></i>Start indoors</span><span><i style="background:#f76b15"></i>Transplant</span><span><i style="background:#3d6b35"></i>Sow outdoors</span><span><i style="background:#e8a33d"></i>Harvest</span><span><i style="background:#5aa9e6;width:3px"></i>Frost dates</span><span><i style="background:#c43d3d;width:3px"></i>Today</span></div>
    <h3 style="margin:26px 0 8px">To-do by date</h3>
    <table class="table"><tbody>${tasks.map(([d, t, c, col]) => `<tr><td class="num" style="width:90px">${fmtDate(d)}</td><td><span class="row" style="gap:8px;justify-content:flex-start"><span class="dot" style="flex:0 0 10px;margin:0;background:${col}"></span>${esc(t)}</span></td></tr>`).join('') || '<tr><td>No timing data for these plants.</td></tr>'}</tbody></table>`
    : '<div class="empty"><h2>Nothing planted yet</h2><p>Place plants on the layout and their sowing and harvest windows show up here.</p></div>'}</div>`;
  $('#calEdit').addEventListener('click', () => planDialog(p));
  $('#calPrint').addEventListener('click', () => window.print());
}

// ---------------------------------------------------------------- dialogs
function planDialog(plan) {
  const isNew = !plan;
  const p = plan || { name: '', width: 240, height: 120, lastFrost: '', firstFrost: '', mode: 'rows', snap: 6, notes: '', year: new Date().getFullYear() };
  const dis = !isNew && !canEdit() ? 'disabled' : '';
  const owner = !isNew && S.role === 'owner';
  const d = modal({
    title: isNew ? 'New garden plan' : 'Plan settings',
    body: `<form id="planForm">
      <label class="field"><span>Name</span><input type="text" name="name" value="${esc(p.name)}" placeholder="Backyard ${new Date().getFullYear()}" maxlength="80" ${dis}></label>
      <div class="grid2"><label class="field"><span>Width (ft)</span><input type="number" name="width" min="1" max="1000" step="0.5" value="${r2(p.width / 12)}" required ${dis}></label>
      <label class="field"><span>Length (ft)</span><input type="number" name="height" min="1" max="1000" step="0.5" value="${r2(p.height / 12)}" required ${dis}></label></div>
      <div class="grid2"><label class="field"><span>Last spring frost</span><input type="date" name="lastFrost" value="${esc(p.lastFrost || '')}" ${dis}></label>
      <label class="field"><span>First fall frost</span><input type="date" name="firstFrost" value="${esc(p.firstFrost || '')}" ${dis}></label></div>
      <p class="lib-meta" style="margin:-4px 0 12px">Frost dates set the planting calendar. Find yours from your local extension office or almanac.com/gardening/frostdates.</p>
      <div class="grid2"><label class="field"><span>Spacing style</span><select name="mode" ${dis}><option value="rows" ${p.mode === 'rows' ? 'selected' : ''}>Traditional rows</option><option value="sfg" ${p.mode === 'sfg' ? 'selected' : ''}>Square foot / intensive</option></select></label>
      <label class="field"><span>Snap to</span><select name="snap" ${dis}>${[1, 2, 3, 4, 6, 12].map((n) => `<option value="${n}" ${p.snap === n ? 'selected' : ''}>${n === 12 ? '1 ft' : n + ' in'}</option>`).join('')}</select></label></div>
      <label class="field"><span>Season year</span><input type="number" name="year" min="1900" max="3000" value="${p.year || new Date().getFullYear()}" ${dis}></label>
      <label class="field"><span>Notes</span><textarea name="notes" ${dis}>${esc(p.notes || '')}</textarea></label>
      <p class="error" id="planErr"></p></form>`,
    foot: `${!isNew ? `<div class="left"><button class="btn" data-a="copy">Copy for next year</button>${owner ? '<button class="btn danger" data-a="delete">Delete plan</button>' : ''}</div>` : ''}
      <button class="btn" data-close>Cancel</button>${dis ? '' : `<button class="btn primary" data-a="save">${isNew ? 'Create plan' : 'Save changes'}</button>`}`,
  });
  const f = $('#planForm', d);
  f.lastFrost.addEventListener('change', () => { if (f.lastFrost.value) f.year.value = f.lastFrost.value.slice(0, 4); });
  const save = async () => {
    const body = {
      name: f.name.value.trim() || 'My garden', width: Math.round(Number(f.width.value) * 12), height: Math.round(Number(f.height.value) * 12),
      lastFrost: f.lastFrost.value || null, firstFrost: f.firstFrost.value || null, mode: f.mode.value, snap: Number(f.snap.value),
      notes: f.notes.value, year: Number(f.year.value) || undefined, clientId: S.clientId,
    };
    if (!(body.width >= 12 && body.height >= 12)) { $('#planErr', d).textContent = 'Width and length must be at least 1 ft.'; return; }
    try {
      if (isNew) { const r = await api('POST', '/api/plans', body); await loadPlans(); d.close(); await openPlan(r.plan.id); toast('Plan created'); }
      else { const r = await api('PUT', `/api/plans/${p.id}`, body); S.plan = r.plan; $('#planBtn').textContent = `${S.plan.name} ▾`; d.close(); renderLibrary(); renderAll(); toast('Changes saved'); }
    } catch (e) { $('#planErr', d).textContent = e.message; }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  d.querySelector('[data-a="save"]')?.addEventListener('click', save);
  d.querySelector('[data-a="delete"]')?.addEventListener('click', () => {
    modal({
      title: 'Delete this plan?', body: `<p>“${esc(p.name)}” and everything in it will be deleted for everyone it is shared with. This can't be undone.</p>`,
      foot: '<button class="btn" data-close>Keep plan</button><button class="btn danger solid" id="confirmDel">Delete plan</button>',
      onOpen: (m) => $('#confirmDel', m).addEventListener('click', async () => {
        await api('DELETE', `/api/plans/${p.id}`); m.close(); localStorage.removeItem('gp_last_plan'); await loadPlans();
        S.plans[0] ? openPlan(S.plans[0].id) : showNoPlan(); toast('Plan deleted');
      }),
    });
  });
  d.querySelector('[data-a="copy"]')?.addEventListener('click', () => {
    modal({
      title: 'Copy for next year', body: `<p style="margin-top:0">Make a new plan from “${esc(p.name)}” to plan your next season and rotate crops.</p>
        <label class="field"><span>New plan name</span><input type="text" id="cpName" value="${esc(p.name.replace(/\d{4}/, (y) => Number(y) + 1))}${/\d{4}/.test(p.name) ? '' : ' (next year)'}"></label>
        <label class="check"><input type="checkbox" id="cpBeds" checked> Copy beds and objects only, leave plants out</label>`,
      foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="cpGo">Make copy</button>',
      onOpen: (m) => $('#cpGo', m).addEventListener('click', async () => {
        const r = await api('POST', `/api/plans/${p.id}/duplicate`, { name: $('#cpName', m).value, structuresOnly: $('#cpBeds', m).checked, year: (p.year || new Date().getFullYear()) + 1 });
        m.close(); await loadPlans(); await openPlan(r.plan.id); toast('Copy created');
      }),
    });
  });
}

function plansDialog() {
  const own = S.plans.filter((p) => p.role === 'owner'), shared = S.plans.filter((p) => p.role !== 'owner');
  const row = (p) => `<button class="plan-row ${S.plan?.id === p.id ? 'current' : ''}" data-open="${esc(p.id)}"><span><b>${esc(p.name)}</b><small>${fmtLen(p.width)} × ${fmtLen(p.height)} · ${p.itemCount} item${p.itemCount === 1 ? '' : 's'}${p.role !== 'owner' ? ` · from ${esc(p.ownerName)}` : ''}</small></span><span class="role">${p.role}</span></button>`;
  const d = modal({
    title: 'Garden plans',
    body: `${own.length ? `<div class="plan-list">${own.map(row).join('')}</div>` : '<p class="lib-meta">You have no plans of your own yet.</p>'}
      ${shared.length ? `<h3 style="font-size:13px;color:var(--ink-2);margin:18px 0 8px">Shared with you</h3><div class="plan-list">${shared.map(row).join('')}</div>` : ''}`,
    foot: '<button class="btn primary" id="newPlanBtn">New plan</button>',
  });
  d.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => { d.close(); await openPlan(b.dataset.open); }));
  $('#newPlanBtn', d).addEventListener('click', () => planDialog());
}
$('#planBtn').addEventListener('click', async () => { await loadPlans().catch(() => {}); plansDialog(); });

function shareDialog() {
  if (!S.plan) return;
  const owner = S.role === 'owner';
  const draw = (d) => {
    $('#memberList', d).innerHTML = S.members.map((m) => `<div class="member"><span class="avatar" style="background:${esc(m.color)}">${esc(initials(m.displayName))}</span>
      <span class="who">${esc(m.displayName)}${m.id === S.user.id ? ' (you)' : ''}<small>@${esc(m.username)}</small></span>
      ${m.role === 'owner' ? '<span class="role">owner</span>' : owner ? `<select data-role="${m.id}" data-u="${esc(m.username)}" style="width:110px"><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Can edit</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Can view</option></select><button class="btn ghost icon" data-rm="${m.id}" aria-label="Remove ${esc(m.displayName)}">✕</button>` : `<span class="role">${m.role}</span>`}</div>`).join('');
    d.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => {
      try { S.members = (await api('POST', `/api/plans/${S.plan.id}/members`, { username: s.dataset.u, role: s.value })).members; toast('Access updated'); } catch (e) { toast(e.message, true); }
    }));
    d.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      try { S.members = (await api('DELETE', `/api/plans/${S.plan.id}/members/${b.dataset.rm}`)).members; draw(d); renderInspector(); } catch (e) { toast(e.message, true); }
    }));
  };
  const d = modal({
    title: `Share “${S.plan.name}”`,
    body: `${owner ? `<form id="shareForm"><div class="row" style="margin-bottom:6px"><input type="text" name="username" placeholder="Their username" required autocapitalize="off"><select name="role" style="width:120px;flex:0 0 120px"><option value="editor">Can edit</option><option value="viewer">Can view</option></select><button class="btn primary" type="submit">Add</button></div><p class="error" id="shareErr"></p></form>
      <p class="lib-meta" style="margin:0 0 14px">People need an account on this server first. Anyone with edit access sees changes live.</p>` : ''}
      <div id="memberList"></div>`,
    foot: !owner ? '<button class="btn danger" id="leaveBtn">Leave this plan</button><button class="btn" data-close>Done</button>' : '<button class="btn" data-close>Done</button>',
  });
  draw(d);
  $('#shareForm', d)?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.currentTarget;
    try { S.members = (await api('POST', `/api/plans/${S.plan.id}/members`, { username: f.username.value.trim(), role: f.role.value })).members; f.username.value = ''; $('#shareErr', d).textContent = ''; draw(d); renderInspector(); }
    catch (err) { $('#shareErr', d).textContent = err.message; }
  });
  $('#leaveBtn', d)?.addEventListener('click', async () => {
    await api('DELETE', `/api/plans/${S.plan.id}/members/${S.user.id}`); d.close(); await loadPlans(); S.plans[0] ? openPlan(S.plans[0].id) : showNoPlan();
  });
}
$('#shareBtn').addEventListener('click', () => (S.plan ? shareDialog() : toast('Create a plan first')));
$('#settingsBtn').addEventListener('click', () => (S.plan ? planDialog(S.plan) : planDialog()));

const EMOJIS = ['🌱', '🌿', '🍃', '🥬', '🥦', '🥕', '🧅', '🧄', '🥔', '🍠', '🌽', '🫘', '🫛', '🍅', '🫑', '🌶️', '🍆', '🥒', '🎃', '🍉', '🍈', '🍓', '🫐', '🍇', '🍒', '🍎', '🍐', '🍋', '🌻', '🌼', '🌸', '🌺', '🌷', '🪻', '🍄', '🟢', '🟣', '🔴', '🟡', '🟠'];
function cropDialog(crop) {
  const isNew = !crop;
  const c = crop || { name: '', icon: '🌱', color: '#30a46c', category: 'Vegetable', family: '', spacing: 12, rowSpacing: 18, dtm: 60, timing: {}, note: '', perennial: false };
  const t = c.timing || {};
  const pair = (key, label) => `<div class="field"><span>${label}</span><div class="row"><input type="number" name="${key}0" min="-52" max="52" value="${t[key]?.[0] ?? ''}" placeholder="from"><input type="number" name="${key}1" min="-52" max="52" value="${t[key]?.[1] ?? ''}" placeholder="to"></div></div>`;
  const d = modal({
    title: isNew ? 'Add a custom plant' : `Edit ${c.name}`, wide: true,
    body: `<form id="cropForm"><div class="grid2"><div>
      <label class="field"><span>Name</span><input type="text" name="name" value="${esc(c.name)}" maxlength="60" required placeholder="e.g. Ground cherry"></label>
      <div class="field"><span>Icon</span><div class="emoji-pick">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-pressed="${e === c.icon}">${e}</button>`).join('')}</div></div>
      <div class="grid2"><label class="field"><span>Colour</span><input type="color" name="color" value="${esc(c.color)}" style="height:34px;width:100%;padding:2px"></label>
      <label class="field"><span>Type</span><select name="category">${['Vegetable', 'Herb', 'Fruit', 'Flower'].map((x) => `<option ${c.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
      <label class="field"><span>Plant family</span><input type="text" name="family" value="${esc(c.family)}" maxlength="40" placeholder="e.g. Nightshade"></label>
      </div><div>
      <div class="grid2"><label class="field"><span>Spacing between plants (in)</span><input type="number" name="spacing" min="0.5" max="240" step="0.5" value="${c.spacing}" required></label>
      <label class="field"><span>Spacing between rows (in)</span><input type="number" name="rowSpacing" min="0.5" max="240" step="0.5" value="${c.rowSpacing}" required></label></div>
      <label class="field"><span>Days to maturity</span><input type="number" name="dtm" min="1" max="1000" value="${c.dtm ?? ''}"></label>
      <p class="lib-meta" style="margin:0 0 8px">Timing in weeks from your last spring frost. Use negative numbers for before, e.g. −8 to −6.</p>
      ${pair('indoor', 'Start indoors')}${pair('transplant', 'Transplant outside')}${pair('direct', 'Sow outdoors')}
      <label class="check"><input type="checkbox" name="perennial" ${c.perennial ? 'checked' : ''}> Perennial</label>
      </div></div>
      <label class="field"><span>Notes</span><textarea name="note" maxlength="500">${esc(c.note || '')}</textarea></label><p class="error" id="cropErr"></p></form>`,
    foot: `${!isNew ? '<div class="left"><button class="btn danger" id="cropDel">Delete plant</button></div>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="cropSave">${isNew ? 'Add plant' : 'Save changes'}</button>`,
  });
  let icon = c.icon;
  d.querySelectorAll('[data-emoji]').forEach((b) => b.addEventListener('click', () => { icon = b.dataset.emoji; d.querySelectorAll('[data-emoji]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  const f = $('#cropForm', d);
  const rng = (k) => (f[k + '0'].value !== '' && f[k + '1'].value !== '' ? [Number(f[k + '0'].value), Number(f[k + '1'].value)] : null);
  $('#cropSave', d).addEventListener('click', async () => {
    if (!f.reportValidity()) return;
    const body = { name: f.name.value, icon, color: f.color.value, category: f.category.value, family: f.family.value, spacing: Number(f.spacing.value), rowSpacing: Number(f.rowSpacing.value), dtm: f.dtm.value === '' ? null : Number(f.dtm.value), timing: { indoor: rng('indoor'), transplant: rng('transplant'), direct: rng('direct') }, note: f.note.value, perennial: f.perennial.checked };
    try {
      const r = isNew ? await api('POST', '/api/crops', body) : await api('PUT', `/api/crops/${c.id}`, body);
      S.crops.set(r.crop.id, r.crop); d.close(); renderLibrary(); renderAll(); toast(isNew ? `${r.crop.name} added to your plants` : 'Changes saved');
    } catch (e) { $('#cropErr', d).textContent = e.message; }
  });
  $('#cropDel', d)?.addEventListener('click', async () => {
    try { await api('DELETE', `/api/crops/${c.id}`); S.crops.delete(c.id); d.close(); renderLibrary(); toast('Plant deleted'); } catch (e) { $('#cropErr', d).textContent = e.message; }
  });
}

function accountDialog() {
  const u = S.user; let color = u.color;
  const d = modal({
    title: 'Your account',
    body: `<form id="acctForm"><label class="field"><span>Display name</span><input type="text" name="displayName" value="${esc(u.displayName)}" maxlength="40"></label>
      <div class="field"><span>Your colour (shown to collaborators)</span><div class="emoji-pick">${USER_COLORS.map((c) => `<button type="button" data-col="${c}" aria-pressed="${c === u.color}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
      <h3 style="font-size:13px;color:var(--ink-2);margin:18px 0 8px">Change password</h3>
      <div class="grid2"><label class="field"><span>Current password</span><input type="password" name="currentPassword" autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input type="password" name="newPassword" minlength="8" autocomplete="new-password"></label></div>
      <p class="lib-meta" style="margin:0">Signed in as @${esc(u.username)}${u.isAdmin ? ' · admin' : ''}</p><p class="error" id="acctErr"></p></form>`,
    foot: `<div class="left"><button class="btn" id="logoutBtn">Sign out</button>${u.isAdmin ? '<button class="btn" id="adminBtn">Manage users</button>' : ''}</div><button class="btn" data-close>Cancel</button><button class="btn primary" id="acctSave">Save changes</button>`,
  });
  d.querySelectorAll('[data-col]').forEach((b) => b.addEventListener('click', () => { color = b.dataset.col; d.querySelectorAll('[data-col]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $('#acctSave', d).addEventListener('click', async () => {
    const f = $('#acctForm', d);
    try {
      const r = await api('PUT', '/api/auth/me', { displayName: f.displayName.value, color, currentPassword: f.currentPassword.value, newPassword: f.newPassword.value || undefined });
      S.user = r.user; updateUserBtn(); d.close(); toast('Changes saved');
    } catch (e) { $('#acctErr', d).textContent = e.message; }
  });
  $('#logoutBtn', d).addEventListener('click', async () => { await api('POST', '/api/auth/logout'); d.close(); S.user = null; S.plan = null; location.reload(); });
  $('#adminBtn', d)?.addEventListener('click', adminDialog);
}
$('#userBtn').addEventListener('click', accountDialog);

async function adminDialog() {
  const data = await api('GET', '/api/admin/users');
  const d = modal({
    title: 'Manage users', wide: true,
    body: `<label class="check"><input type="checkbox" id="regToggle" ${data.allowRegistration ? 'checked' : ''}> Let people create their own accounts from the sign-in page</label>
      <table class="table" style="margin-top:8px"><thead><tr><th>Name</th><th>Username</th><th class="r">Plans</th><th>Admin</th><th></th></tr></thead><tbody>
      ${data.users.map((u) => `<tr><td>${esc(u.displayName)}</td><td>@${esc(u.username)}</td><td class="r num">${u.planCount}</td>
        <td><input type="checkbox" data-admin="${u.id}" ${u.isAdmin ? 'checked' : ''} ${u.id === S.user.id ? 'disabled' : ''} aria-label="Admin"></td>
        <td class="r"><button class="btn" data-reset="${u.id}">Reset password</button> ${u.id === S.user.id ? '' : `<button class="btn danger" data-del="${u.id}" data-name="${esc(u.displayName)}">Delete</button>`}</td></tr>`).join('')}
      </tbody></table>
      <h3 style="font-size:13px;color:var(--ink-2);margin:20px 0 8px">Add a user</h3>
      <form id="newUser" class="row"><input type="text" name="username" placeholder="Username" required autocapitalize="off"><input type="text" name="displayName" placeholder="Name"><input type="password" name="password" placeholder="Password (8+ characters)" required minlength="8" autocomplete="new-password"><button class="btn primary" type="submit">Add user</button></form>
      <p class="error" id="adminErr"></p>`,
  });
  const err = (e) => { $('#adminErr', d).textContent = e.message; };
  $('#regToggle', d).addEventListener('change', (e) => api('PUT', '/api/admin/settings', { allowRegistration: e.target.checked }).then(() => toast('Setting saved')).catch(err));
  d.querySelectorAll('[data-admin]').forEach((c) => c.addEventListener('change', () => api('PUT', `/api/admin/users/${c.dataset.admin}`, { isAdmin: c.checked }).then(() => toast('Saved')).catch(err)));
  d.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => {
    const pw = prompt('New password for this user (8+ characters). They will be signed out everywhere.');
    if (pw) api('PUT', `/api/admin/users/${b.dataset.reset}`, { password: pw }).then(() => toast('Password reset')).catch(err);
  }));
  d.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (confirm(`Delete ${b.dataset.name}? Their plans are deleted too.`)) api('DELETE', `/api/admin/users/${b.dataset.del}`).then(adminDialog).catch(err);
  }));
  $('#newUser', d).addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget;
    api('POST', '/api/admin/users', { username: f.username.value.trim(), displayName: f.displayName.value.trim(), password: f.password.value }).then(() => { toast('User added'); adminDialog(); }).catch(err);
  });
}

// ---------------------------------------------------------------- export
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]/g, '-');
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportDialog() {
  if (!S.plan) return;
  const d = modal({
    title: 'Download or print',
    body: '<p style="margin-top:0">Save a picture of the whole layout at full detail, or print it with your plant list.</p>',
    foot: '<button class="btn" id="exSvg">Download SVG</button><button class="btn" id="exPrint">Print layout</button><button class="btn primary" id="exPng">Download PNG</button>',
  });
  $('#exPng', d).addEventListener('click', () => { exportImage('png'); d.close(); });
  $('#exSvg', d).addEventListener('click', () => { exportImage('svg'); d.close(); });
  $('#exPrint', d).addEventListener('click', () => { d.close(); setView('layout'); S.sel.clear(); fitView(); renderAll(); setTimeout(() => window.print(), 150); });
}
$('#exportBtn').addEventListener('click', exportDialog);
function exportImage(kind) {
  const p = S.plan; const pad = 30; const titleH = 26;
  const scale = clamp(3200 / Math.max(p.width, p.height), 1, 6); // px per inch
  const k = scale;
  const W = p.width + pad * 2, H = p.height + pad * 2 + titleH;
  const font = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
  const src = `<svg xmlns="${NS}" width="${Math.round(W * scale)}" height="${Math.round(H * scale)}" viewBox="${-pad} ${-pad - titleH} ${W} ${H}" font-family="${font}">
    <rect x="${-pad}" y="${-pad - titleH}" width="${W}" height="${H}" fill="#ffffff"/>
    <text x="0" y="${-pad - titleH / 2 + 6}" font-size="${16 / k * 1.4}" font-weight="700" fill="#23301f">${esc(p.name)} · ${fmtLen(p.width)} × ${fmtLen(p.height)}</text>
    <defs>${defsSvg(k)}</defs>${groundSvg(k)}${itemsSvg(k)}</svg>`;
  if (kind === 'svg') return download(`${p.name}.svg`, new Blob([src], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    cv.getContext('2d').drawImage(img, 0, 0);
    cv.toBlob((b) => download(`${p.name}.png`, b), 'image/png');
  };
  img.onerror = () => toast('Could not render the image. Try SVG instead.', true);
  img.src = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
}

// ---------------------------------------------------------------- toolbar wiring
$('#toolSelect').addEventListener('click', () => setTool('select'));
$('#toolHand').addEventListener('click', () => setTool('hand'));
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
$('#zoomIn').addEventListener('click', () => zoomAt(1.25));
$('#zoomOut').addEventListener('click', () => zoomAt(0.8));
$('#zoomFit').addEventListener('click', fitView);
$('#toggleSide').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#inspector').classList.remove('open'); });
$('#toggleInsp').addEventListener('click', () => { $('#inspector').classList.toggle('open'); $('#sidebar').classList.remove('open'); });
window.addEventListener('resize', scheduleRender);
window.addEventListener('beforeprint', () => { if (S.viewMode === 'layout') { S.sel.clear(); renderCanvas(); } });

boot();
