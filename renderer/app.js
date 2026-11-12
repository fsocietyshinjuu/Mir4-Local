/* Mir4Local public app */
const STORE_KEY = 'mir4local.state.v1';
const PREFS_KEY = 'mir4local.prefs.v1';
const REFRESH_MS = 15 * 60 * 1000;
const SOON_MIN = 10;   // countdown turns amber under this many minutes
const LIVE_MIN = 5;    // shows "Live now" for this long after a spawn
const DAY = 86400000;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

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

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

/* ---------- Preferences and per-user progress ---------- */
const prefs = { theme: 'system', timeFormat: 'system', resetHour: 0, weekStart: 1, collapsed: false, sort: 'soonest', ...readJson(PREFS_KEY, {}) };
const savePrefs = () => writeJson(PREFS_KEY, prefs);

const saved = readJson(STORE_KEY, {});
const state = { favorites: saved.favorites || {}, completed: saved.completed || {} };
const saveState = () => writeJson(STORE_KEY, state);

/* ---------- Time helpers ---------- */
const hour12 = () => (prefs.timeFormat === '12' ? true : prefs.timeFormat === '24' ? false : undefined);
const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: hour12() });
const fmtHour = (hr) => fmtClock(new Date(2000, 0, 1, hr).getTime());
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };

// Spawn times are written in the admin's time zone (minutes from UTC). Without one, assume your own.
const zoneOffset = () => (Number.isFinite(meta.utcOffset) ? meta.utcOffset : -new Date().getTimezoneOffset());

// Most recent and next occurrence of any daily "HH:MM" time.
function nextSpawn(times, offsetMin, now = Date.now()) {
  const shifted = new Date(now + offsetMin * 60000);
  const y = shifted.getUTCFullYear(), mo = shifted.getUTCMonth(), d = shifted.getUTCDate();
  let next = Infinity, prev = -Infinity;
  for (const t of times) {
    const [hh, mm] = t.split(':').map(Number);
    const base = Date.UTC(y, mo, d, hh, mm) - offsetMin * 60000;
    for (const c of [base - DAY, base, base + DAY]) {
      if (c > now && c < next) next = c;
      if (c <= now && c > prev) prev = c;
    }
  }
  return { next, prev };
}

function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// Start (ms) of the current reset period for a cycle.
function periodStart(cycle, now = new Date()) {
  const d = new Date(now);
  d.setHours(prefs.resetHour, 0, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  if (cycle === 'Weekly') d.setDate(d.getDate() - ((d.getDay() - prefs.weekStart + 7) % 7));
  else if (cycle === 'Monthly') d.setDate(1);
  return d.getTime();
}
const isComplete = (m) => (state.completed[m.id] || 0) >= periodStart(m.cycle);
const isSpawn = (m) => m.type === 'Spawn' && Array.isArray(m.spawnTimes) && m.spawnTimes.length > 0;

/* ---------- Segmented control helpers ---------- */
function setSeg(el, v) { $$('button[data-v]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); }
function bindSeg(el, onPick) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    setSeg(el, b.dataset.v);
    onPick(b.dataset.v);
  });
}
function segEl(options, current) {
  return h('div', { class: 'seg', role: 'group' },
    options.map(([v, label]) => h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(v === current) }, label)));
}

/* ---------- App state ---------- */
let missions = [];
let meta = {};
let lastSig = '';
let loaded = false;
let loadError = '';
let lastLoad = { source: '', updatedAt: '' };
let currentBase = [];
let cdRefs = [];
const filters = { cycle: 'All', map: '', q: '', favOnly: false, hideDone: false };

const els = {
  app: $('#app'), rows: $('#rows'), scroll: $('.scroll'), empty: $('#empty'), emptyText: $('#empty-text'),
  emptyBtn: $('#empty-btn'), status: $('#data-status'), search: $('#search'), mapFilter: $('#map-filter'),
  sort: $('#sort'), favOnly: $('#fav-only'), hideDone: $('#hide-done'), refresh: $('#refresh-btn'),
  progress: $('#progress'), progressText: $('#progress-text'), cycleSeg: $('#cycle-seg'),
};

hydrateIcons();

/* ---------- Rendering ---------- */
function filtered() {
  const q = filters.q.trim().toLowerCase();
  return missions.filter((m) =>
    (filters.cycle === 'All' || m.cycle === filters.cycle) &&
    (!filters.map || m.map === filters.map) &&
    (!filters.favOnly || state.favorites[m.id]) &&
    (!q || [m.name, m.map, m.area, m.location].join(' ').toLowerCase().includes(q)));
}

function sortKey(m, now) {
  if (!isSpawn(m)) return Infinity;
  const { next, prev } = nextSpawn(m.spawnTimes, zoneOffset(), now);
  return now - prev < LIVE_MIN * 60000 ? prev : next; // just-spawned bosses stay on top
}

function sortList(list) {
  const now = Date.now();
  const keys = new Map(list.map((m) => [m.id, prefs.sort === 'soonest' ? sortKey(m, now) : 0]));
  return [...list].sort((a, b) =>
    (state.favorites[b.id] ? 1 : 0) - (state.favorites[a.id] ? 1 : 0) ||
    (keys.get(a.id) === keys.get(b.id) ? 0 : keys.get(a.id) < keys.get(b.id) ? -1 : 1));
}

function renderRow(m) {
  const done = isComplete(m);
  const statusText = h('span', {}, done ? 'Complete' : 'Pending');

  const check = h('input', {
    type: 'checkbox', class: 'check', checked: done, 'aria-label': `${m.name} complete`,
    onchange: (e) => {
      const on = e.target.checked;
      if (on) state.completed[m.id] = Date.now(); else delete state.completed[m.id];
      saveState();
      statusText.textContent = on ? 'Complete' : 'Pending';
      e.target.closest('tr').classList.toggle('done', on);
      updateSummary();
      if (filters.hideDone && on) setTimeout(render, 450);
    },
  });

  const isFav = !!state.favorites[m.id];
  const fav = h('button', {
    type: 'button', class: 'btn icon fav', 'data-fav': m.id, 'aria-pressed': String(isFav),
    title: isFav ? 'Remove favorite' : 'Add favorite', 'aria-label': `Favorite ${m.name}`,
    onclick: () => {
      if (state.favorites[m.id]) delete state.favorites[m.id]; else state.favorites[m.id] = true;
      saveState();
      render();
      els.rows.querySelector(`[data-fav="${m.id}"]`)?.focus();
    },
  }, icon('star'));

  let countdown;
  if (isSpawn(m)) {
    const cd = h('span', { class: 'cd' }, '--:--:--');
    const sub = h('div', { class: 'cd-sub' });
    const now = Date.now(), off = zoneOffset();
    const all = m.spawnTimes.map((t) => nextSpawn([t], off, now).next).sort((a, b) => a - b).map(fmtClock).join(', ');
    cdRefs.push({ m, cd, sub });
    countdown = h('td', { title: `Spawns daily at ${all} (your time)` }, cd, sub);
  } else {
    countdown = h('td', {}, h('span', { class: 'pill' }, 'Summon'));
  }

  return h('tr', { class: done ? 'done' : '' },
    h('td', {},
      h('div', { class: 'name' }, m.name),
      h('div', { class: 'meta' }, m.map, h('span', { class: 'pill' }, m.cycle))),
    h('td', {}, h('div', {}, m.area), h('div', { class: 'meta' }, m.location)),
    countdown,
    h('td', {}, h('label', { class: 'status' }, check, statusText)),
    h('td', {}, fav));
}

function render() {
  currentBase = filtered();
  const list = sortList(filters.hideDone ? currentBase.filter((m) => !isComplete(m)) : currentBase);
  cdRefs = [];
  els.rows.replaceChildren(...list.map(renderRow));
  tick();
  updateSummary();

  const none = list.length === 0;
  els.scroll.hidden = none;
  els.empty.hidden = !none;
  if (none) {
    if (!missions.length) {
      els.emptyText.textContent = !loaded ? 'Loading missions…'
        : loadError ? `Couldn't load missions (${loadError}).` : 'No missions have been published yet.';
      els.emptyBtn.textContent = 'Refresh data';
      els.emptyBtn.onclick = loadData;
    } else {
      els.emptyText.textContent = 'No missions match your filters.';
      els.emptyBtn.textContent = 'Clear filters';
      els.emptyBtn.onclick = clearFilters;
    }
    els.emptyBtn.hidden = !loaded;
  }
}

// Updates countdowns in place every second (no re-render, so focus is never lost).
function tick() {
  const now = Date.now(), off = zoneOffset();
  for (const r of cdRefs) {
    const { next, prev } = nextSpawn(r.m.spawnTimes, off, now);
    const sinceMin = (now - prev) / 60000;
    let st = 'normal', text, sub;
    if (sinceMin < LIVE_MIN) {
      st = 'live'; text = 'Live now';
      sub = sinceMin < 1 ? 'Just spawned' : `Spawned ${Math.floor(sinceMin)}m ago`;
    } else {
      text = fmtCountdown(next - now);
      st = next - now < SOON_MIN * 60000 ? 'soon' : 'normal';
      sub = `at ${fmtClock(next)}${r.m.spawnTimes.length > 1 ? `, ${r.m.spawnTimes.length} times daily` : ''}`;
    }
    if (r.cd.textContent !== text) r.cd.textContent = text;
    if (r.cd.dataset.state !== st) r.cd.dataset.state = st;
    if (r.sub.textContent !== sub) r.sub.textContent = sub;
  }
}

function updateSummary() {
  const total = currentBase.length;
  const done = currentBase.filter(isComplete).length;
  els.progressText.textContent = total ? `${done} of ${total} complete` : '';
  els.progress.hidden = !total;
  els.progress.value = total ? Math.round((done / total) * 100) : 0;
}

function updateCounts() {
  $$('button[data-v]', els.cycleSeg).forEach((b) => {
    const v = b.dataset.v;
    const n = v === 'All' ? missions.length : missions.filter((m) => m.cycle === v).length;
    $('.count', b).textContent = missions.length ? n : '';
  });
}

function renderMapOptions() {
  const maps = [...new Set(missions.map((m) => m.map))].sort();
  if (!maps.includes(filters.map)) filters.map = '';
  els.mapFilter.replaceChildren(h('option', { value: '' }, 'All maps'), ...maps.map((m) => h('option', { value: m }, m)));
  els.mapFilter.value = filters.map;
}

function syncControls() {
  setSeg(els.cycleSeg, filters.cycle);
  els.mapFilter.value = filters.map;
  els.search.value = filters.q;
  els.sort.value = prefs.sort;
  els.favOnly.setAttribute('aria-pressed', String(filters.favOnly));
  els.hideDone.setAttribute('aria-pressed', String(filters.hideDone));
}

function clearFilters() {
  Object.assign(filters, { cycle: 'All', map: '', q: '', favOnly: false, hideDone: false });
  syncControls();
  render();
}

/* ---------- Data ---------- */
function dataSummary() {
  const when = lastLoad.updatedAt ? fmtDate(lastLoad.updatedAt) : '';
  if (loadError && !missions.length) return `Couldn't load missions (${loadError}).`;
  if (lastLoad.source === 'cache') return `Offline. Showing saved data${when ? ` from ${when}` : ''}.`;
  if (lastLoad.source === 'empty') return 'Nothing has been published yet.';
  return when ? `Data updated ${when}.` : '';
}

async function loadData() {
  els.refresh.disabled = true;
  els.refresh.classList.add('busy');
  const res = await window.desktop.loadMissions();
  els.refresh.disabled = false;
  els.refresh.classList.remove('busy');
  loaded = true;

  if (!res.ok) {
    loadError = res.error;
  } else {
    loadError = '';
    lastLoad = { source: res.source, updatedAt: res.data.updatedAt || '' };
    const sig = JSON.stringify(res.data);
    if (sig !== lastSig) {
      lastSig = sig;
      meta = res.data;
      missions = Array.isArray(res.data.missions) ? res.data.missions : [];
      renderMapOptions();
      updateCounts();
    }
  }
  render();
  els.status.textContent = dataSummary();
  if (settingsRefs.data) settingsRefs.data.textContent = dataSummary() || 'No data loaded yet.';
}

/* ---------- Theme, navigation, sidebar ---------- */
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-btn .label').textContent = dark ? 'Light mode' : 'Dark mode';
  $('#theme-btn i').replaceChildren(icon(dark ? 'sun' : 'moon'));
}
function setTheme(t) {
  prefs.theme = t;
  savePrefs();
  window.themeApply();
  if (settingsRefs.themeSeg) setSeg(settingsRefs.themeSeg, t);
}
window.addEventListener('themechange', syncThemeBtn);
$('#theme-btn').addEventListener('click', () =>
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

function showView(name) {
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.nav-item[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === name ? 'page' : 'false'));
}
$$('.nav-item[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function applyCollapsed() {
  els.app.classList.toggle('collapsed', prefs.collapsed);
  $('#collapse-btn').title = prefs.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}
$('#collapse-btn').addEventListener('click', () => { prefs.collapsed = !prefs.collapsed; savePrefs(); applyCollapsed(); });

/* ---------- Settings view ---------- */
const settingsRefs = {};

function row(title, hint, control) {
  return h('div', { class: 'setting' },
    h('div', {}, h('div', { class: 'setting-title' }, title), hint ? h('div', { class: 'sub' }, hint) : null),
    control);
}

function fillResetOptions() {
  settingsRefs.reset.replaceChildren(...Array.from({ length: 24 }, (_, i) =>
    h('option', { value: String(i), selected: i === prefs.resetHour }, fmtHour(i))));
  settingsRefs.reset.value = String(prefs.resetHour);
}

function buildSettings() {
  const themeSeg = segEl([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], prefs.theme);
  bindSeg(themeSeg, setTheme);
  settingsRefs.themeSeg = themeSeg;

  const fmtSeg = segEl([['system', 'System'], ['12', '12-hour'], ['24', '24-hour']], prefs.timeFormat);
  bindSeg(fmtSeg, (v) => { prefs.timeFormat = v; savePrefs(); fillResetOptions(); render(); });

  const reset = h('select', { class: 'field', 'aria-label': 'Daily reset time' });
  reset.addEventListener('change', () => { prefs.resetHour = Number(reset.value); savePrefs(); render(); });
  settingsRefs.reset = reset;

  const weekSeg = segEl([['1', 'Monday'], ['0', 'Sunday']], String(prefs.weekStart));
  bindSeg(weekSeg, (v) => { prefs.weekStart = Number(v); savePrefs(); render(); });

  settingsRefs.data = h('span', { class: 'sub' }, 'No data loaded yet.');
  const refreshBtn = h('button', { type: 'button', class: 'btn', onclick: loadData }, icon('refresh'), 'Refresh');

  settingsRefs.update = h('span', { class: 'sub' }, 'Not checked yet.');
  const updateBtn = h('button', { type: 'button', class: 'btn', onclick: () => window.desktop.checkForUpdates() }, 'Check for updates');
  settingsRefs.version = h('span', { class: 'sub' });

  $('#settings-body').append(
    h('h3', {}, 'Appearance'),
    h('div', { class: 'panel' }, row('Theme', 'System follows your Windows setting.', themeSeg)),
    h('h3', {}, 'Time and resets'),
    h('div', { class: 'panel' },
      row('Time format', null, fmtSeg),
      row('Daily reset', 'When Daily missions go back to Pending. Weekly and Monthly reset at this time too.', reset),
      row('Week starts on', 'Weekly missions reset on this day.', weekSeg)),
    h('h3', {}, 'Mission data'),
    h('div', { class: 'panel' }, row('Published data', null, h('div', { class: 'setting-end' }, settingsRefs.data, refreshBtn))),
    h('h3', {}, 'App'),
    h('div', { class: 'panel' }, row('Updates', null, h('div', { class: 'setting-end' }, settingsRefs.update, updateBtn)),
      row('Version', null, settingsRefs.version)));
  fillResetOptions();
}

/* ---------- Events ---------- */
bindSeg(els.cycleSeg, (v) => { filters.cycle = v; render(); });
els.mapFilter.addEventListener('change', () => { filters.map = els.mapFilter.value; render(); });
els.sort.addEventListener('change', () => { prefs.sort = els.sort.value; savePrefs(); render(); });
els.search.addEventListener('input', () => { filters.q = els.search.value; render(); });
els.favOnly.addEventListener('click', () => { filters.favOnly = !filters.favOnly; syncControls(); render(); });
els.hideDone.addEventListener('click', () => { filters.hideDone = !filters.hideDone; syncControls(); render(); });
els.refresh.addEventListener('click', loadData);

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); showView('missions'); els.search.focus(); }
  if (e.key === 'Escape' && document.activeElement === els.search) {
    filters.q = ''; els.search.value = ''; els.search.blur(); render();
  }
});

/* ---------- App updates ---------- */
const banner = $('#update-banner');
const message = $('#update-message');
const progress = $('#update-progress');
const installBtn = $('#install-btn');

window.desktop.getVersion().then((v) => {
  $('#version').textContent = `v${v}`;
  settingsRefs.version.textContent = `v${v}`;
});
window.desktop.onUpdateStatus((s) => {
  settingsRefs.update.textContent = s.message;
  const show = ['available', 'downloading', 'ready', 'error'].includes(s.state);
  banner.hidden = !show;
  banner.dataset.state = s.state;
  message.textContent = s.message;
  progress.hidden = s.state !== 'downloading';
  if (s.state === 'downloading') progress.value = s.percent || 0;
  installBtn.hidden = s.state !== 'ready';
});
installBtn.addEventListener('click', () => window.desktop.installUpdate());

/* ---------- Start ---------- */
buildSettings();
applyCollapsed();
syncThemeBtn();
syncControls();
render();
loadData();
setInterval(tick, 1000);
setInterval(loadData, REFRESH_MS);

// Once a minute: apply resets that just passed, and re-sort by soonest unless you're mid-interaction.
let lastPeriod = periodStart('Daily');
setInterval(() => {
  const p = periodStart('Daily');
  const changed = p !== lastPeriod;
  lastPeriod = p;
  const idle = !els.rows.contains(document.activeElement);
  if (changed || (prefs.sort === 'soonest' && idle)) render();
}, 60 * 1000);
