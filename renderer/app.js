/* ---------- Settings you may want to change ---------- */
const RESET_HOUR = 0;   // Local hour (0-23) when Daily missions reset. 0 = midnight.
const WEEK_START = 1;   // Day Weekly missions reset on. 0 = Sunday, 1 = Monday.
// Monthly missions reset on the 1st of each month at RESET_HOUR.

const STORE_KEY = 'mir4local.state.v1';
const REFRESH_MS = 15 * 60 * 1000;

/* ---------- Helpers ---------- */
const $ = (s) => document.querySelector(s);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(kid ?? ''));
  return el;
}

function fmtTime(hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/* ---------- Per-user state (favorites + completion) ---------- */
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    return { favorites: s.favorites || {}, completed: s.completed || {} };
  } catch {
    return { favorites: {}, completed: {} };
  }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

// Start (ms) of the current reset period for a cycle.
function periodStart(cycle, now = new Date()) {
  const d = new Date(now);
  d.setHours(RESET_HOUR, 0, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  if (cycle === 'Weekly') d.setDate(d.getDate() - ((d.getDay() - WEEK_START + 7) % 7));
  else if (cycle === 'Monthly') d.setDate(1);
  return d.getTime();
}
const isComplete = (m) => (state.completed[m.id] || 0) >= periodStart(m.cycle);

/* ---------- App state ---------- */
let state = loadState();
let missions = [];
let meta = {};
let lastSig = '';
const filters = { cycle: 'All', map: '', q: '', favOnly: false };

const els = {
  rows: $('#rows'),
  empty: $('#empty'),
  status: $('#data-status'),
  timeHead: $('#time-head'),
  mapFilter: $('#map-filter'),
  search: $('#search'),
  favOnly: $('#fav-only'),
  refresh: $('#refresh-btn'),
};

/* ---------- Rendering ---------- */
function visibleMissions() {
  const q = filters.q.trim().toLowerCase();
  return missions
    .filter((m) =>
      (filters.cycle === 'All' || m.cycle === filters.cycle) &&
      (!filters.map || m.map === filters.map) &&
      (!filters.favOnly || state.favorites[m.id]) &&
      (!q || [m.name, m.map, m.area, m.location].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (state.favorites[b.id] ? 1 : 0) - (state.favorites[a.id] ? 1 : 0));
}

function renderRow(m) {
  const done = isComplete(m);
  const statusText = h('span', {}, done ? 'Complete' : 'Pending');

  const check = h('input', {
    type: 'checkbox',
    checked: done,
    onchange: (e) => {
      if (e.target.checked) state.completed[m.id] = Date.now();
      else delete state.completed[m.id];
      saveState();
      statusText.textContent = e.target.checked ? 'Complete' : 'Pending';
      e.target.closest('tr').classList.toggle('done', e.target.checked);
    },
  });

  const isFav = !!state.favorites[m.id];
  const fav = h('button', {
    type: 'button',
    class: 'fav',
    'data-fav': m.id,
    'aria-pressed': String(isFav),
    'aria-label': `Favorite ${m.name}`,
    onclick: () => {
      if (state.favorites[m.id]) delete state.favorites[m.id];
      else state.favorites[m.id] = true;
      saveState();
      render();
      els.rows.querySelector(`[data-fav="${m.id}"]`)?.focus();
    },
  }, isFav ? '★' : '☆');

  const timeCell = m.type === 'Spawn' && m.spawnTimes?.length
    ? h('div', { class: 'chips' }, m.spawnTimes.map((t) => h('span', { class: 'chip' }, fmtTime(t))))
    : h('span', { class: 'muted' }, 'Summon');

  return h('tr', { class: done ? 'done' : '' },
    h('td', {},
      h('div', { class: 'name' }, m.name),
      h('div', { class: 'sub' }, `${m.map} · ${m.cycle}`)),
    h('td', {}, h('div', {}, m.area), h('div', { class: 'sub' }, m.location)),
    h('td', {}, timeCell),
    h('td', {}, h('label', { class: 'status' }, check, statusText)),
    h('td', {}, fav));
}

function render() {
  const list = visibleMissions();
  els.rows.replaceChildren(...list.map(renderRow));
  els.timeHead.textContent = meta.timeLabel ? `Spawn time (${meta.timeLabel})` : 'Spawn time';

  els.empty.hidden = list.length > 0;
  if (!list.length) {
    els.empty.textContent = missions.length
      ? 'No missions match your filters.'
      : 'No missions have been published yet.';
  }
}

function renderMapOptions() {
  const maps = [...new Set(missions.map((m) => m.map))].sort();
  const keep = maps.includes(filters.map) ? filters.map : '';
  filters.map = keep;
  els.mapFilter.replaceChildren(
    h('option', { value: '' }, 'All maps'),
    ...maps.map((m) => h('option', { value: m }, m)));
  els.mapFilter.value = keep;
}

function setStatus(text) { els.status.textContent = text; }

/* ---------- Data loading ---------- */
async function loadData() {
  els.refresh.disabled = true;
  const res = await window.desktop.loadMissions();
  els.refresh.disabled = false;

  if (!res.ok) {
    setStatus(`Couldn't load missions (${res.error}). Check your internet connection, then select Refresh data.`);
    return;
  }

  const sig = JSON.stringify(res.data);
  if (sig !== lastSig) {
    lastSig = sig;
    meta = res.data;
    missions = Array.isArray(res.data.missions) ? res.data.missions : [];
    renderMapOptions();
    render();
  }

  const when = res.data.updatedAt ? fmtDate(res.data.updatedAt) : '';
  if (res.source === 'cache') setStatus(`You're offline. Showing the last saved data${when ? ` (updated ${when})` : ''}.`);
  else if (res.source === 'empty') setStatus('');
  else setStatus(when ? `Data updated ${when}.` : '');
}

/* ---------- Events ---------- */
document.querySelectorAll('.seg button').forEach((btn) =>
  btn.addEventListener('click', () => {
    filters.cycle = btn.dataset.cycle;
    document.querySelectorAll('.seg button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === btn)));
    render();
  }));
els.mapFilter.addEventListener('change', () => { filters.map = els.mapFilter.value; render(); });
els.search.addEventListener('input', () => { filters.q = els.search.value; render(); });
els.favOnly.addEventListener('change', () => { filters.favOnly = els.favOnly.checked; render(); });
els.refresh.addEventListener('click', loadData);

/* ---------- App updates banner ---------- */
const banner = $('#update-banner');
const message = $('#update-message');
const progress = $('#update-progress');
const installBtn = $('#install-btn');

window.desktop.getVersion().then((v) => { $('#version').textContent = `v${v}`; });
window.desktop.onUpdateStatus((s) => {
  banner.hidden = s.state === 'dev';
  banner.dataset.state = s.state;
  message.textContent = s.message;
  progress.hidden = s.state !== 'downloading';
  if (s.state === 'downloading') progress.value = s.percent || 0;
  installBtn.hidden = s.state !== 'ready';
});
installBtn.addEventListener('click', () => window.desktop.installUpdate());

/* ---------- Start ---------- */
loadData();
setInterval(loadData, REFRESH_MS);

// Re-draw when a daily/weekly/monthly reset passes while the app is open.
let lastPeriod = periodStart('Daily');
setInterval(() => {
  const p = periodStart('Daily');
  if (p !== lastPeriod) { lastPeriod = p; render(); }
}, 60 * 1000);
