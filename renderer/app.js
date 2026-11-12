/* Mir4Local public app */
const STORE_KEY = 'mir4local.state.v1';
const PREFS_KEY = 'mir4local.prefs.v1';
const REFRESH_MS = 15 * 60 * 1000;
const SOON_MIN = 10;   // countdown turns orange under this many minutes
const LIVE_MIN = 5;    // shows "Live now" for this long after a spawn
const REMIND_MIN = 5;  // reminder distance before / after a spawn
const DAY = 86400000;

const CLASSES = ['Warrior', 'Sorcerer', 'Taoist', 'Arbalist', 'Lancer', 'Darkist'];
const SERVERS = ['ASIA', 'EU', 'NA', 'SA', 'INMENA'];
const ALLIANCES = ['HOF', 'FF', 'GOW'];

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
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Preferences ---------- */
const prefs = {
  theme: 'system', timeFormat: 'system', resetHour: 0, weekStart: 1, collapsed: false, sort: 'soonest',
  notify: false, sound: false, remindBefore: true, remindAt: false, remindAfter: true, remindScope: 'favorites',
  ...readJson(PREFS_KEY, {}),
};
const savePrefs = () => writeJson(PREFS_KEY, prefs);

/* ---------- Characters, favorites and progress ---------- */
// Top-level favorites/completed are used until a first character is added (then they move to it).
const saved = readJson(STORE_KEY, {});
const state = {
  favorites: saved.favorites || {},
  completed: saved.completed || {},
  characters: Array.isArray(saved.characters)
    ? saved.characters.map((c) => ({ ...c, favorites: c.favorites || {}, completed: c.completed || {} })) : [],
  activeId: saved.activeId || '',
};
if (state.characters.length && !state.characters.some((c) => c.id === state.activeId)) state.activeId = state.characters[0].id;
const saveState = () => writeJson(STORE_KEY, state);
const profile = () => state.characters.find((c) => c.id === state.activeId) || state;

/* ---------- Time helpers ---------- */
const hour12 = () => (prefs.timeFormat === '12' ? true : prefs.timeFormat === '24' ? false : undefined);
const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: hour12() });
const fmtHour = (hr) => fmtClock(new Date(2000, 0, 1, hr).getTime());
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };

// Spawn times are written in the admin's time zone (minutes from UTC). Without one, assume your own.
const zoneOffset = () => (Number.isFinite(meta.utcOffset) ? meta.utcOffset : -new Date().getTimezoneOffset());

// Every occurrence of the daily "HH:MM" times from yesterday through tomorrow.
function occurrences(times, offsetMin, now = Date.now()) {
  const shifted = new Date(now + offsetMin * 60000);
  const y = shifted.getUTCFullYear(), mo = shifted.getUTCMonth(), d = shifted.getUTCDate();
  const out = [];
  for (const t of times) {
    const [hh, mm] = t.split(':').map(Number);
    const base = Date.UTC(y, mo, d, hh, mm) - offsetMin * 60000;
    out.push(base - DAY, base, base + DAY);
  }
  return out;
}

function nextSpawn(times, offsetMin, now = Date.now()) {
  let next = Infinity, prev = -Infinity;
  for (const c of occurrences(times, offsetMin, now)) {
    if (c > now && c < next) next = c;
    if (c <= now && c > prev) prev = c;
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
const isComplete = (m) => (profile().completed[m.id] || 0) >= periodStart(m.cycle);
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
let editingCharId = null;
const filters = { type: '', cycle: '', map: '', area: '', q: '', favOnly: false, hideDone: false };

const els = {
  app: $('#app'), rows: $('#rows'), scroll: $('.scroll'), empty: $('#empty'), emptyText: $('#empty-text'),
  emptyBtn: $('#empty-btn'), status: $('#data-status'), search: $('#search'), sort: $('#sort'),
  favOnly: $('#fav-only'), hideDone: $('#hide-done'), refresh: $('#refresh-btn'), clear: $('#clear-btn'),
  typeSel: $('#f-type'), cycleSel: $('#f-cycle'), mapSel: $('#f-map'), areaSel: $('#f-area'), charSel: $('#char-select'),
  progressText: $('#progress-text'), pct: $('#progress-pct'), meter: $('#meter'), meterFill: $('#meter-fill'),
};

hydrateIcons();

/* ---------- Rendering ---------- */
const anyFilter = () => !!(filters.type || filters.cycle || filters.map || filters.area || filters.q || filters.favOnly || filters.hideDone);

function filtered() {
  const q = filters.q.trim().toLowerCase();
  const favs = profile().favorites;
  return missions.filter((m) =>
    (!filters.type || m.type === filters.type) &&
    (!filters.cycle || m.cycle === filters.cycle) &&
    (!filters.map || m.map === filters.map) &&
    (!filters.area || m.area === filters.area) &&
    (!filters.favOnly || favs[m.id]) &&
    (!q || [m.name, m.map, m.area, m.location].join(' ').toLowerCase().includes(q)));
}

function sortKey(m, now) {
  if (!isSpawn(m)) return Infinity;
  const { next, prev } = nextSpawn(m.spawnTimes, zoneOffset(), now);
  return now - prev < LIVE_MIN * 60000 ? prev : next; // just-spawned bosses stay on top
}

function sortList(list) {
  const now = Date.now();
  const favs = profile().favorites;
  const keys = new Map(list.map((m) => [m.id, prefs.sort === 'soonest' ? sortKey(m, now) : 0]));
  return [...list].sort((a, b) =>
    (favs[b.id] ? 1 : 0) - (favs[a.id] ? 1 : 0) ||
    (keys.get(a.id) === keys.get(b.id) ? 0 : keys.get(a.id) < keys.get(b.id) ? -1 : 1));
}

function renderRow(m) {
  const p = profile();
  const done = isComplete(m);
  const statusText = h('span', {}, done ? 'Complete' : 'Pending');

  const check = h('input', {
    type: 'checkbox', class: 'check', checked: done, 'aria-label': `${m.name} complete`,
    onchange: (e) => {
      const on = e.target.checked;
      if (on) p.completed[m.id] = Date.now(); else delete p.completed[m.id];
      saveState();
      statusText.textContent = on ? 'Complete' : 'Pending';
      e.target.closest('tr').classList.toggle('done', on);
      updateSummary();
      if (filters.hideDone && on) setTimeout(render, 450);
    },
  });

  const isFav = !!p.favorites[m.id];
  const fav = h('button', {
    type: 'button', class: 'btn icon fav', 'data-fav': m.id, 'aria-pressed': String(isFav),
    title: isFav ? 'Remove favorite' : 'Add favorite', 'aria-label': `Favorite ${m.name}`,
    onclick: () => {
      if (p.favorites[m.id]) delete p.favorites[m.id]; else p.favorites[m.id] = true;
      saveState();
      render();
      renderCharacters();
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
  els.clear.hidden = !anyFilter();
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
        : loadError ? `Couldn’t load missions (${loadError}).` : 'No missions have been published yet.';
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
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.progressText.textContent = total ? `${done} of ${total} complete` : 'No missions';
  els.pct.textContent = total ? `${pct}%` : '';
  els.meterFill.style.width = `${pct}%`;
  els.meter.setAttribute('aria-valuenow', String(pct));
}

/* ---------- Filters (dropdowns) ---------- */
function fillSelect(sel, values, current, allLabel, labelFn) {
  sel.replaceChildren(
    h('option', { value: '' }, allLabel),
    ...values.map((v) => h('option', { value: v }, labelFn ? labelFn(v) : v)));
  sel.value = current;
}

function renderFilters() {
  const maps = [...new Set(missions.map((m) => m.map))].sort();
  if (!maps.includes(filters.map)) filters.map = '';
  const areas = [...new Set(missions.filter((m) => !filters.map || m.map === filters.map).map((m) => m.area))].sort();
  if (!areas.includes(filters.area)) filters.area = '';
  const n = (key, v) => missions.filter((m) => m[key] === v).length;
  fillSelect(els.typeSel, ['Spawn', 'Summon'], filters.type, 'All types', (v) => `${v} (${n('type', v)})`);
  fillSelect(els.cycleSel, ['Daily', 'Weekly', 'Monthly'], filters.cycle, 'All cycles', (v) => `${v} (${n('cycle', v)})`);
  fillSelect(els.mapSel, maps, filters.map, 'All maps');
  fillSelect(els.areaSel, areas, filters.area, 'All areas');
}

function syncControls() {
  els.search.value = filters.q;
  els.sort.value = prefs.sort;
  els.favOnly.setAttribute('aria-pressed', String(filters.favOnly));
  els.hideDone.setAttribute('aria-pressed', String(filters.hideDone));
  renderFilters();
}

function clearFilters() {
  Object.assign(filters, { type: '', cycle: '', map: '', area: '', q: '', favOnly: false, hideDone: false });
  syncControls();
  render();
}

/* ---------- Characters ---------- */
function renderCharSelect() {
  const opts = state.characters.map((c) => h('option', { value: c.id }, `${c.ign} (${c.cls})`));
  if (!opts.length) opts.push(h('option', { value: '' }, 'No character'));
  opts.push(h('option', { value: '__add' }, '+ Add character…'));
  els.charSel.replaceChildren(...opts);
  els.charSel.value = state.characters.some((c) => c.id === state.activeId) ? state.activeId : '';
}

function setActive(id) {
  state.activeId = id;
  saveState();
  renderCharSelect();
  renderCharacters();
  render();
}

function renderCharacters() {
  const rows = $('#char-rows');
  $('#char-empty').hidden = state.characters.length > 0;
  $('#char-rows').closest('.scroll').hidden = state.characters.length === 0;
  const btn = (label, fn, danger) => h('button', { type: 'button', class: `btn act ${danger ? 'danger' : ''}`, onclick: fn }, label);
  rows.replaceChildren(...state.characters.map((c) => {
    const active = c.id === state.activeId;
    return h('tr', {},
      h('td', {}, h('span', { class: 'name' }, c.ign), active ? h('span', { class: 'badge active' }, 'Active') : null),
      h('td', {}, c.cls), h('td', {}, c.server), h('td', {}, c.alliance),
      h('td', { class: 'muted' }, c.clan || 'None'),
      h('td', { class: 'muted' }, String(Object.keys(c.favorites).length)),
      h('td', { class: 'acts' },
        active ? null : btn('Use', () => setActive(c.id)),
        btn('Edit', () => openCharDialog(c)),
        btn('Delete', () => deleteChar(c), true)));
  }));
}

function deleteChar(c) {
  if (!confirm(`Delete ${c.ign}? Their favorites and progress will be removed.`)) return;
  state.characters = state.characters.filter((x) => x.id !== c.id);
  if (state.activeId === c.id) state.activeId = state.characters[0]?.id || '';
  saveState();
  renderCharSelect();
  renderCharacters();
  render();
}

const dlg = $('#char-dialog');
function fillOptions(sel, list, placeholder) {
  sel.replaceChildren(h('option', { value: '' }, placeholder), ...list.map((v) => h('option', { value: v }, v)));
}
fillOptions($('#c-class'), CLASSES, 'Select class');
fillOptions($('#c-server'), SERVERS, 'Select server');
fillOptions($('#c-alliance'), ALLIANCES, 'Select alliance');

function openCharDialog(c) {
  editingCharId = c ? c.id : null;
  $('#char-title').textContent = c ? 'Edit character' : 'Add character';
  $('#c-ign').value = c ? c.ign : '';
  $('#c-class').value = c ? c.cls : '';
  $('#c-server').value = c ? c.server : '';
  $('#c-alliance').value = c ? c.alliance : '';
  $('#c-clan').value = c ? c.clan || '' : '';
  $('#char-error').hidden = true;
  dlg.showModal();
  $('#c-ign').focus();
}

$('#char-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const rec = {
    ign: $('#c-ign').value.trim(), cls: $('#c-class').value, server: $('#c-server').value,
    alliance: $('#c-alliance').value, clan: $('#c-clan').value.trim(),
  };
  const dup = state.characters.some((c) => c.id !== editingCharId && c.server === rec.server && c.ign.toLowerCase() === rec.ign.toLowerCase());
  if (dup) {
    $('#char-error').textContent = 'You already have a character with this IGN on that server.';
    $('#char-error').hidden = false;
    return;
  }
  if (editingCharId) {
    Object.assign(state.characters.find((c) => c.id === editingCharId), rec);
  } else {
    const c = { id: newId(), ...rec, favorites: {}, completed: {} };
    if (!state.characters.length) { // first character inherits what was tracked before characters existed
      c.favorites = state.favorites; c.completed = state.completed;
      state.favorites = {}; state.completed = {};
    }
    state.characters.push(c);
    state.activeId = c.id;
  }
  saveState();
  dlg.close();
  renderCharSelect();
  renderCharacters();
  render();
});
$('#c-cancel').addEventListener('click', () => dlg.close());
$('#add-char-btn').addEventListener('click', () => openCharDialog(null));
$('#char-empty-btn').addEventListener('click', () => openCharDialog(null));
els.charSel.addEventListener('change', () => {
  if (els.charSel.value === '__add') { renderCharSelect(); openCharDialog(null); return; }
  setActive(els.charSel.value);
});

/* ---------- Data ---------- */
function dataSummary() {
  const when = lastLoad.updatedAt ? fmtDate(lastLoad.updatedAt) : '';
  if (loadError && !missions.length) return `Couldn’t load missions (${loadError}).`;
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
      renderFilters();
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

/* ---------- Reminders (desktop notification + sound) ---------- */
let audioCtx;
function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [[880, 0], [1175, 0.17], [1480, 0.34]].forEach(([freq, delay]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.3);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.32);
    });
  } catch {}
}

function fireReminder(kind, items) {
  const n = items.length;
  const first = items[0].m;
  const phrase = { before: `in ${REMIND_MIN} minutes`, at: 'now', after: `${REMIND_MIN} minutes ago` }[kind];
  const title = n === 1
    ? (kind === 'at' ? `${first.name} has spawned` : kind === 'before' ? `${first.name} spawns ${phrase}` : `${first.name} spawned ${phrase}`)
    : (kind === 'at' ? `${n} bosses have spawned` : kind === 'before' ? `${n} bosses spawn ${phrase}` : `${n} bosses spawned ${phrase}`);
  const body = n === 1 ? [first.map, first.area, first.location].join(', ') : items.map((i) => i.m.name).join(', ');
  if (prefs.notify) window.desktop.notify({ title, body });
  if (prefs.sound) playChime();
}

let lastReminderTick = Date.now();
function checkReminders() {
  const now = Date.now();
  const from = Math.max(lastReminderTick, now - 90000); // never replay old events after sleep or a long pause
  lastReminderTick = now;
  if (!prefs.notify && !prefs.sound) return;

  const kinds = [];
  if (prefs.remindBefore) kinds.push(['before', -REMIND_MIN]);
  if (prefs.remindAt) kinds.push(['at', 0]);
  if (prefs.remindAfter) kinds.push(['after', REMIND_MIN]);
  if (!kinds.length) return;

  const off = zoneOffset();
  const favs = profile().favorites;
  const groups = { before: [], at: [], after: [] };
  for (const m of missions) {
    if (!isSpawn(m) || isComplete(m)) continue;
    if (prefs.remindScope === 'favorites' && !favs[m.id]) continue;
    for (const spawnAt of occurrences(m.spawnTimes, off, now)) {
      for (const [kind, delta] of kinds) {
        const at = spawnAt + delta * 60000;
        if (at > from && at <= now) groups[kind].push({ m, spawnAt });
      }
    }
  }
  for (const kind of ['before', 'at', 'after']) if (groups[kind].length) fireReminder(kind, groups[kind]);
}

/* ---------- Settings view ---------- */
const settingsRefs = {};

function row(title, hint, control) {
  return h('div', { class: 'setting' },
    h('div', {}, h('div', { class: 'setting-title' }, title), hint ? h('div', { class: 'sub' }, hint) : null),
    control);
}

function switchEl(label, key) {
  const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': label, checked: !!prefs[key] });
  input.addEventListener('change', () => { prefs[key] = input.checked; savePrefs(); });
  return input;
}

function checkRow(label, key) {
  const input = h('input', { type: 'checkbox', class: 'check', checked: !!prefs[key] });
  input.addEventListener('change', () => { prefs[key] = input.checked; savePrefs(); });
  return h('label', { class: 'checkrow' }, input, label);
}

function fillResetOptions() {
  settingsRefs.reset.replaceChildren(...Array.from({ length: 24 }, (_, i) =>
    h('option', { value: String(i), selected: i === prefs.resetHour }, fmtHour(i))));
  settingsRefs.reset.value = String(prefs.resetHour);
}

async function testNotification() {
  const res = await window.desktop.notify({ title: 'Mir4Local test', body: 'Desktop notifications are working.' });
  settingsRefs.notifyMsg.textContent = res && res.ok ? 'Sent.' : 'Not available on this computer.';
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

  const scopeSeg = segEl([['favorites', 'Favorites'], ['all', 'All spawn bosses']], prefs.remindScope);
  bindSeg(scopeSeg, (v) => { prefs.remindScope = v; savePrefs(); });

  settingsRefs.notifyMsg = h('span', { class: 'sub', role: 'status' });
  const testNote = h('button', { type: 'button', class: 'btn small', onclick: testNotification }, 'Send test');
  const testSound = h('button', { type: 'button', class: 'btn small', onclick: playChime }, 'Play sound');

  settingsRefs.data = h('span', { class: 'sub' }, 'No data loaded yet.');
  const refreshBtn = h('button', { type: 'button', class: 'btn', onclick: loadData }, icon('refresh'), 'Refresh');
  settingsRefs.update = h('span', { class: 'sub' }, 'Not checked yet.');
  const updateBtn = h('button', { type: 'button', class: 'btn', onclick: () => window.desktop.checkForUpdates() }, 'Check for updates');
  settingsRefs.version = h('span', { class: 'sub' });

  $('#settings-body').append(
    h('h3', {}, 'Appearance'),
    h('div', { class: 'panel' }, row('Theme', 'System follows your Windows setting.', themeSeg)),
    h('h3', {}, 'Reminders'),
    h('div', { class: 'panel' },
      row('Desktop notifications', 'A Windows pop-up. If you don’t see it, check Focus assist.',
        h('div', { class: 'setting-end' }, settingsRefs.notifyMsg, testNote, switchEl('Desktop notifications', 'notify'))),
      row('Sound reminder', 'A short chime at the same moments.',
        h('div', { class: 'setting-end' }, testSound, switchEl('Sound reminder', 'sound'))),
      row('Remind me', 'Spawn bosses only. Summon missions have no spawn time.',
        h('div', { class: 'checks' },
          checkRow(`${REMIND_MIN} minutes before spawn`, 'remindBefore'),
          checkRow('At spawn', 'remindAt'),
          checkRow(`${REMIND_MIN} minutes after spawn`, 'remindAfter'))),
      row('Which bosses', 'Favorites means the active character’s favorites. Missions marked complete are skipped.', scopeSeg)),
    h('p', { class: 'sub' }, 'Keep Mir4Local open (it can stay minimized) for reminders to work.'),
    h('h3', {}, 'Time and resets'),
    h('div', { class: 'panel' },
      row('Time format', null, fmtSeg),
      row('Daily reset', 'When Daily missions go back to Pending. Weekly and Monthly reset at this time too.', reset),
      row('Week starts on', 'Weekly missions reset on this day.', weekSeg)),
    h('h3', {}, 'Mission data'),
    h('div', { class: 'panel' }, row('Published data', null, h('div', { class: 'setting-end' }, settingsRefs.data, refreshBtn))),
    h('h3', {}, 'App'),
    h('div', { class: 'panel' },
      row('Updates', null, h('div', { class: 'setting-end' }, settingsRefs.update, updateBtn)),
      row('Version', null, settingsRefs.version)));
  fillResetOptions();
}

/* ---------- Events ---------- */
[['typeSel', 'type'], ['cycleSel', 'cycle'], ['mapSel', 'map'], ['areaSel', 'area']].forEach(([id, key]) =>
  els[id].addEventListener('change', () => {
    filters[key] = els[id].value;
    if (key === 'map') filters.area = '';
    renderFilters();
    render();
  }));
els.sort.addEventListener('change', () => { prefs.sort = els.sort.value; savePrefs(); render(); });
els.search.addEventListener('input', () => { filters.q = els.search.value; render(); });
els.favOnly.addEventListener('click', () => { filters.favOnly = !filters.favOnly; syncControls(); render(); });
els.hideDone.addEventListener('click', () => { filters.hideDone = !filters.hideDone; syncControls(); render(); });
els.clear.addEventListener('click', clearFilters);
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
renderCharSelect();
renderCharacters();
render();
loadData();
setInterval(() => { tick(); checkReminders(); }, 1000);
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
