/* Mir4Local app (desktop and web share this file) */
const STORE_KEY = 'mir4local.state.v1';
const PREFS_KEY = 'mir4local.prefs.v1';
const REFRESH_MS = 15 * 60 * 1000;
const SOON_MIN = 10;   // countdown turns orange under this many minutes
const LIVE_MIN = 5;    // shows "Live now" for this long after a spawn
const REMIND_MIN = 5;  // reminder distance before / after a spawn
const DAY = 86400000;
const DEV = { name: 'Shinjuu', email: 'fsociety.shinjuu@gmail.com' };
const IS_WEB = !!window.desktop.isWeb;

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
const vlabel = (v) => t(`v.${v}`);   // Spawn / Summon / Daily / Weekly / Monthly

/* ---------- Preferences ---------- */
const prefs = {
  theme: 'system', timeFormat: 'system', resetHour: 0, weekStart: 1, collapsed: false, sort: 'soonest',
  notify: false, sound: false, remindBefore: true, remindAt: false, remindAfter: true, remindScope: 'favorites',
  ...readJson(PREFS_KEY, {}),
};
prefs.lang = i18n.lang;
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
const fmtClock = (ts) => new Date(ts).toLocaleTimeString([i18n.lang], { hour: 'numeric', minute: '2-digit', hour12: hour12() });
const fmtHour = (hr) => fmtClock(new Date(2000, 0, 1, hr).getTime());
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([i18n.lang], { dateStyle: 'medium', timeStyle: 'short' }); };

// Spawn times are written in the admin's time zone (minutes from UTC). Without one, assume your own.
const zoneOffset = () => (Number.isFinite(meta.utcOffset) ? meta.utcOffset : -new Date().getTimezoneOffset());

// Every occurrence of the daily "HH:MM" times from yesterday through tomorrow.
function occurrences(times, offsetMin, now = Date.now()) {
  const shifted = new Date(now + offsetMin * 60000);
  const y = shifted.getUTCFullYear(), mo = shifted.getUTCMonth(), d = shifted.getUTCDate();
  const out = [];
  for (const tm of times) {
    const [hh, mm] = tm.split(':').map(Number);
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
let lastUpdate = null;
const filters = { type: '', cycle: '', map: '', area: '', q: '', favOnly: false, hideDone: false };
const settingsRefs = {};

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
  const statusText = h('span', {}, done ? t('st.complete') : t('st.pending'));

  const check = h('input', {
    type: 'checkbox', class: 'check', checked: done, 'aria-label': t('fav.chk', { name: m.name }),
    onchange: (e) => {
      const on = e.target.checked;
      if (on) p.completed[m.id] = Date.now(); else delete p.completed[m.id];
      saveState();
      statusText.textContent = on ? t('st.complete') : t('st.pending');
      e.target.closest('tr').classList.toggle('done', on);
      updateSummary();
      if (filters.hideDone && on) setTimeout(render, 450);
    },
  });

  const isFav = !!p.favorites[m.id];
  const fav = h('button', {
    type: 'button', class: 'btn icon fav', 'data-fav': m.id, 'aria-pressed': String(isFav),
    title: isFav ? t('fav.remove') : t('fav.add'), 'aria-label': t('fav.aria', { name: m.name }),
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
    const all = m.spawnTimes.map((tm) => nextSpawn([tm], off, now).next).sort((a, b) => a - b).map(fmtClock).join(', ');
    cdRefs.push({ m, cd, sub });
    countdown = h('td', { title: t('cd.tip', { times: all }) }, cd, sub);
  } else {
    countdown = h('td', {}, h('span', { class: 'pill' }, vlabel('Summon')));
  }

  return h('tr', { class: done ? 'done' : '' },
    h('td', {},
      h('div', { class: 'name' }, m.name),
      h('div', { class: 'meta' }, m.map, h('span', { class: 'pill' }, vlabel(m.cycle)))),
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
      els.emptyText.textContent = !loaded ? t('e.loading') : loadError ? t('e.failed', { err: loadError }) : t('e.none');
      els.emptyBtn.textContent = t('tr.refresh');
      els.emptyBtn.onclick = loadData;
    } else {
      els.emptyText.textContent = t('e.nomatch');
      els.emptyBtn.textContent = t('f.clearAll');
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
      st = 'live'; text = t('cd.live');
      sub = sinceMin < 1 ? t('cd.just') : t('cd.ago', { n: Math.floor(sinceMin) });
    } else {
      text = fmtCountdown(next - now);
      st = next - now < SOON_MIN * 60000 ? 'soon' : 'normal';
      sub = t('cd.at', { time: fmtClock(next) }) + (r.m.spawnTimes.length > 1 ? ` · ${t('cd.times', { n: r.m.spawnTimes.length })}` : '');
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
  els.progressText.textContent = total ? t('p.done', { done, total }) : t('p.none');
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
  fillSelect(els.typeSel, ['Spawn', 'Summon'], filters.type, t('f.allTypes'), (v) => `${vlabel(v)} (${n('type', v)})`);
  fillSelect(els.cycleSel, ['Daily', 'Weekly', 'Monthly'], filters.cycle, t('f.allCycles'), (v) => `${vlabel(v)} (${n('cycle', v)})`);
  fillSelect(els.mapSel, maps, filters.map, t('f.allMaps'));
  fillSelect(els.areaSel, areas, filters.area, t('f.allAreas'));
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
  if (!opts.length) opts.push(h('option', { value: '' }, t('c.noChar')));
  opts.push(h('option', { value: '__add' }, t('c.addOpt')));
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
  rows.closest('.scroll').hidden = state.characters.length === 0;
  const btn = (label, fn, danger) => h('button', { type: 'button', class: `btn act ${danger ? 'danger' : ''}`, onclick: fn }, label);
  rows.replaceChildren(...state.characters.map((c) => {
    const active = c.id === state.activeId;
    return h('tr', {},
      h('td', {}, h('span', { class: 'name' }, c.ign), active ? h('span', { class: 'badge active' }, t('c.active')) : null),
      h('td', {}, c.cls), h('td', {}, c.server), h('td', {}, c.alliance),
      h('td', { class: 'muted' }, c.clan || t('c.none')),
      h('td', { class: 'muted' }, String(Object.keys(c.favorites).length)),
      h('td', { class: 'acts' },
        active ? null : btn(t('c.use'), () => setActive(c.id)),
        btn(t('c.editBtn'), () => openCharDialog(c)),
        btn(t('c.delete'), () => deleteChar(c), true)));
  }));
}

function deleteChar(c) {
  if (!confirm(t('c.del', { ign: c.ign }))) return;
  state.characters = state.characters.filter((x) => x.id !== c.id);
  if (state.activeId === c.id) state.activeId = state.characters[0]?.id || '';
  saveState();
  renderCharSelect();
  renderCharacters();
  render();
}

const dlg = $('#char-dialog');
function fillOptions(sel, list, placeholder) {
  const keep = sel.value;
  sel.replaceChildren(h('option', { value: '' }, placeholder), ...list.map((v) => h('option', { value: v }, v)));
  sel.value = keep;
}
function fillDialogOptions() {
  fillOptions($('#c-class'), CLASSES, t('c.selClass'));
  fillOptions($('#c-server'), SERVERS, t('c.selServer'));
  fillOptions($('#c-alliance'), ALLIANCES, t('c.selAlliance'));
}

function openCharDialog(c) {
  editingCharId = c ? c.id : null;
  $('#char-title').textContent = c ? t('c.edit') : t('c.add');
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
    $('#char-error').textContent = t('c.dup');
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
  if (loadError && !missions.length) return t('e.failed', { err: loadError });
  if (lastLoad.source === 'cache') return when ? t('d.offlineDate', { date: when }) : t('d.offline');
  if (lastLoad.source === 'empty') return t('d.empty');
  return when ? t('d.updated', { date: when }) : '';
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
  if (settingsRefs.data) settingsRefs.data.textContent = dataSummary() || t('s.noData');
}

/* ---------- Theme, navigation, sidebar ---------- */
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-btn .label').textContent = dark ? t('nav.toLight') : t('nav.toDark');
  $('#theme-btn i').replaceChildren(icon(dark ? 'sun' : 'moon'));
  $('#theme-btn').title = $('#theme-btn .label').textContent;
}
function setTheme(v) {
  prefs.theme = v;
  savePrefs();
  window.themeApply();
  if (settingsRefs.themeSeg) setSeg(settingsRefs.themeSeg, v);
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
  $('#collapse-btn').title = t('nav.collapse');
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
  const title = t(`n.${kind}${n === 1 ? '1' : 'N'}`, { name: first.name, count: n, n: REMIND_MIN });
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
function row(title, hint, control) {
  return h('div', { class: 'setting' },
    h('div', {}, h('div', { class: 'setting-title' }, title), hint ? h('div', { class: 'sub' }, hint) : null),
    control);
}

function switchEl(label, key) {
  const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': label, checked: !!prefs[key] });
  input.addEventListener('change', async () => {
    prefs[key] = input.checked;
    if (key === 'notify' && input.checked && window.desktop.requestNotify) {
      const ok = await window.desktop.requestNotify();   // browsers ask for permission here
      if (!ok) { prefs.notify = false; input.checked = false; settingsRefs.notifyMsg.textContent = t('s.testNA'); }
    }
    savePrefs();
  });
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
  const res = await window.desktop.notify({ title: t('n.testTitle'), body: t('n.testBody') });
  settingsRefs.notifyMsg.textContent = res && res.ok ? t('s.testSent') : t('s.testNA');
}

async function copyEmail(btn) {
  try { await navigator.clipboard.writeText(DEV.email); }
  catch {
    const ta = h('textarea', { 'aria-hidden': 'true' }, DEV.email);
    document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove();
  }
  btn.textContent = t('s.copied');
  setTimeout(() => { btn.textContent = t('s.copy'); }, 1500);
}

function updateText(s) {
  switch (s.state) {
    case 'checking': return t('u.checking');
    case 'available': return t('u.available', { v: s.version });
    case 'downloading': return t('u.downloading');
    case 'ready': return t('u.ready', { v: s.version });
    case 'current': return t('u.current');
    case 'error': return t('u.error', { err: s.error || '' });
    default: return t('s.notChecked');
  }
}

function buildSettings() {
  const themeSeg = segEl([['system', t('s.system')], ['light', t('s.light')], ['dark', t('s.dark')]], prefs.theme);
  bindSeg(themeSeg, setTheme);
  settingsRefs.themeSeg = themeSeg;

  const langSel = h('select', { class: 'field', 'aria-label': t('s.language') },
    i18n.LANGS.map((l) => h('option', { value: l.code, selected: l.code === i18n.lang }, l.name)));
  langSel.addEventListener('change', () => { prefs.lang = langSel.value; savePrefs(); i18n.setLang(langSel.value); });

  const fmtSeg = segEl([['system', t('s.system')], ['12', t('s.h12')], ['24', t('s.h24')]], prefs.timeFormat);
  bindSeg(fmtSeg, (v) => { prefs.timeFormat = v; savePrefs(); fillResetOptions(); render(); });

  const reset = h('select', { class: 'field', 'aria-label': t('s.dailyReset') });
  reset.addEventListener('change', () => { prefs.resetHour = Number(reset.value); savePrefs(); render(); });
  settingsRefs.reset = reset;

  const weekSeg = segEl([['1', t('s.mon')], ['0', t('s.sun')]], String(prefs.weekStart));
  bindSeg(weekSeg, (v) => { prefs.weekStart = Number(v); savePrefs(); render(); });

  const scopeSeg = segEl([['favorites', t('s.favs')], ['all', t('s.allSpawn')]], prefs.remindScope);
  bindSeg(scopeSeg, (v) => { prefs.remindScope = v; savePrefs(); });

  settingsRefs.notifyMsg = h('span', { class: 'sub', role: 'status' });
  const testNote = h('button', { type: 'button', class: 'btn small', onclick: testNotification }, t('s.sendTest'));
  const testSound = h('button', { type: 'button', class: 'btn small', onclick: playChime }, t('s.playSound'));

  settingsRefs.data = h('span', { class: 'sub' }, dataSummary() || t('s.noData'));
  const refreshBtn = h('button', { type: 'button', class: 'btn', onclick: loadData }, icon('refresh'), t('s.refresh'));

  settingsRefs.update = h('span', { class: 'sub' }, IS_WEB ? t('s.webUpdates') : lastUpdate ? updateText(lastUpdate) : t('s.notChecked'));
  const updateBtn = IS_WEB ? null : h('button', { type: 'button', class: 'btn', onclick: () => window.desktop.checkForUpdates() }, t('s.check'));
  settingsRefs.version = h('span', { class: 'sub' }, settingsRefs.versionText || '');

  const copyBtn = h('button', { type: 'button', class: 'btn small' }, t('s.copy'));
  copyBtn.addEventListener('click', () => copyEmail(copyBtn));
  const mail = h('a', { class: 'link', href: `mailto:${DEV.email}` }, DEV.email);

  $('#settings-body').replaceChildren(
    h('h3', {}, t('s.appearance')),
    h('div', { class: 'panel' },
      row(t('s.language'), t('s.languageHint'), langSel),
      row(t('s.theme'), t('s.themeHint'), themeSeg)),
    h('h3', {}, t('s.reminders')),
    h('div', { class: 'panel' },
      row(t('s.notif'), t('s.notifHint'),
        h('div', { class: 'setting-end' }, settingsRefs.notifyMsg, testNote, switchEl(t('s.notif'), 'notify'))),
      row(t('s.sound'), t('s.soundHint'),
        h('div', { class: 'setting-end' }, testSound, switchEl(t('s.sound'), 'sound'))),
      row(t('s.remindMe'), t('s.remindHint'),
        h('div', { class: 'checks' },
          checkRow(t('s.before', { n: REMIND_MIN }), 'remindBefore'),
          checkRow(t('s.at'), 'remindAt'),
          checkRow(t('s.after', { n: REMIND_MIN }), 'remindAfter'))),
      row(t('s.which'), t('s.whichHint'), scopeSeg)),
    h('p', { class: 'sub' }, t('s.keepOpen')),
    h('h3', {}, t('s.timeResets')),
    h('div', { class: 'panel' },
      row(t('s.timeFormat'), null, fmtSeg),
      row(t('s.dailyReset'), t('s.dailyResetHint'), reset),
      row(t('s.weekStarts'), t('s.weekStartsHint'), weekSeg)),
    h('h3', {}, t('s.data')),
    h('div', { class: 'panel' }, row(t('s.published'), null, h('div', { class: 'setting-end' }, settingsRefs.data, refreshBtn))),
    h('h3', {}, t('s.appSec')),
    h('div', { class: 'panel' },
      row(t('s.updates'), null, h('div', { class: 'setting-end' }, settingsRefs.update, updateBtn)),
      row(t('s.version'), null, settingsRefs.version)),
    h('h3', {}, t('s.about')),
    h('div', { class: 'panel' },
      row(t('s.developer'), null, h('span', {}, DEV.name)),
      row(t('s.email'), null, h('div', { class: 'setting-end' }, mail, copyBtn))),
    h('p', { class: 'sub' }, t('s.disclaimer')));
  fillResetOptions();
}

/* ---------- Language ---------- */
function applyLanguage() {
  i18n.apply();
  syncThemeBtn();
  applyCollapsed();
  fillDialogOptions();
  if (dlg.open) $('#char-title').textContent = editingCharId ? t('c.edit') : t('c.add');
  renderFilters();
  renderCharSelect();
  renderCharacters();
  buildSettings();
  render();
  els.status.textContent = dataSummary();
  if (lastUpdate) showUpdate(lastUpdate);
}
i18n.onChange(applyLanguage);

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

function showUpdate(s) {
  const text = updateText(s);
  if (settingsRefs.update) settingsRefs.update.textContent = text;
  const show = ['available', 'downloading', 'ready', 'error'].includes(s.state);
  banner.hidden = !show;
  banner.dataset.state = s.state;
  message.textContent = text;
  progress.hidden = s.state !== 'downloading';
  if (s.state === 'downloading') progress.value = s.percent || 0;
  installBtn.hidden = s.state !== 'ready';
}
window.desktop.getVersion().then((v) => {
  const label = IS_WEB ? 'Web' : `v${v}`;
  $('#version').textContent = label;
  settingsRefs.versionText = label;
  if (settingsRefs.version) settingsRefs.version.textContent = label;
});
window.desktop.onUpdateStatus((s) => { lastUpdate = s; showUpdate(s); });
installBtn.addEventListener('click', () => window.desktop.installUpdate());
if (IS_WEB) $('#web-link').hidden = false;

/* ---------- Start ---------- */
i18n.apply();
fillDialogOptions();
applyCollapsed();
syncThemeBtn();
syncControls();
renderCharSelect();
renderCharacters();
buildSettings();
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
