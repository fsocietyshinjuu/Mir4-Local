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

/* Reminder dedupe and load bookkeeping. Stored locally so a restart cannot replay old toasts. */
const FIRED_KEY = 'mir4local.fired.v1';
const fired = readJson(FIRED_KEY, {});
let loadingData = false;
let dataWarning = '';

/* Text published by the admin can carry per-language versions. i18n maps are keyed by field, then language. */
function trText(rec, field, fallback, index) {
  const map = rec && rec.i18n && rec.i18n[field];
  const v = Array.isArray(map) && index != null ? map[index] && map[index][i18n.lang] : map && map[i18n.lang];
  return v || fallback || '';
}
function trValues(rec, field, fallback, count) {
  const out = [];
  const map = rec && rec.i18n && rec.i18n[field];
  if (Array.isArray(map)) for (let i = 0; i < Math.max(count || 0, map.length); i++) out.push(trText(rec, field, (rec[field] || [])[i], i));
  else out.push(trText(rec, field, fallback));
  return out.filter(Boolean);
}
function searchWords(rec, fields) {
  return fields.flatMap((f) => [String(rec[f] || ''), ...trValues(rec, f, rec[f])]).join(' ').toLowerCase();
}

/* ---------- Published-data validation ---------- */
function safeImageUrl(v) {
  const s = String(v || '').trim();
  if (/^https:\/\//i.test(s)) return s;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s;
  return '';
}
function safeLink(v) {
  const s = String(v || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}
function cleanDay(d) {
  if (d === '*' || d === 'Daily') return '*';
  const n = DAY_CODES.includes(d) ? DAY_CODES.indexOf(d) : Number(d);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
}
function cleanSchedule(schedule, warn) {
  if (!Array.isArray(schedule)) { if (schedule != null) warn(); return []; }
  return schedule.map((e) => {
    if (!e || typeof e !== 'object') { warn(); return null; }
    const days = [...new Set((Array.isArray(e.days) ? e.days : []).map(cleanDay).filter((d) => d !== null))];
    const times = [...new Set((Array.isArray(e.times) ? e.times : []).map(String).filter((tm) => {
      if (!parseClock(tm)) { warn(); return false; }
      return true;
    }))];
    if (!days.length || !times.length) { warn(); return null; }
    return { days, times };
  }).filter(Boolean);
}

// Never let one bad published record break a whole tab. Fix what can be fixed, drop what cannot, count warnings.
function validateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Published data is not an object'], data: null, warnings: 0 };
  }
  let warnings = 0;
  const warn = () => { warnings++; };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const arr = (v) => (Array.isArray(v) ? v : []);
  const cleanList = (key, clean) => arr(raw[key]).map(clean).filter(Boolean);
  const out = { ...raw, missions: [], worldBosses: [], events: [], crafting: [], mystery: [] };

  if (Number.isFinite(raw.utcOffset)) out.utcOffset = Math.max(-840, Math.min(840, raw.utcOffset));
  else delete out.utcOffset;

  out.missions = cleanList('missions', (m) => {
    if (!m || typeof m !== 'object') { warn(); return null; }
    const name = str(m.name);
    if (!name) { warn(); return null; }
    const cycle = ['Daily', 'Weekly', 'Monthly'].includes(m.cycle) ? m.cycle : (warn(), 'Daily');
    const type = ['Spawn', 'Summon'].includes(m.type) ? m.type : (warn(), 'Spawn');
    const mode = ['scheduled', 'random', 'respawn'].includes(m.spawnMode || 'scheduled')
      ? (m.spawnMode || 'scheduled') : (warn(), 'scheduled');
    const times = arr(m.spawnTimes).map(String).filter((tm) => {
      if (!parseClock(tm)) { warn(); return false; }
      return true;
    });
    const rec = { ...m, id: str(m.id) || newId(), name, cycle, type, spawnMode: mode, spawnTimes: times };
    if (Number.isFinite(m.respawnMinutes) && m.respawnMinutes >= 0) rec.respawnMinutes = m.respawnMinutes;
    else delete rec.respawnMinutes;
    return rec;
  });

  const named = (r) => {
    if (!r || typeof r !== 'object') { warn(); return null; }
    const name = str(r.name);
    if (!name) { warn(); return null; }
    return { ...r, id: str(r.id) || newId(), name, schedule: cleanSchedule(r.schedule, warn) };
  };
  out.worldBosses = cleanList('worldBosses', named);
  out.events = cleanList('events', (e) => {
    const rec = named(e);
    if (!rec) return null;
    const areas = arr(e.areas).map((a) => {
      if (!a || typeof a !== 'object') { warn(); return null; }
      return { ...a, map: str(a.map), area: str(a.area), location: str(a.location), schedule: cleanSchedule(a.schedule, warn) };
    }).filter(Boolean);
    return { ...rec, map: str(e.map), area: str(e.area), location: str(e.location), areas };
  });
  out.crafting = cleanList('crafting', (c) => {
    if (!c || typeof c !== 'object') { warn(); return null; }
    const boss = str(c.boss);
    if (!boss) { warn(); return null; }
    const badgeImage = safeImageUrl(c.badgeImage);
    if (c.badgeImage && !badgeImage) warn();
    return { ...c, id: str(c.id) || newId(), boss, badge: str(c.badge), badgeImage,
      npc: str(c.npc), npcLocation: str(c.npcLocation), summonLocation: str(c.summonLocation) };
  });
  out.mystery = cleanList('mystery', (m) => {
    const rec = named(m);
    if (!rec) return null;
    const tutorial = safeLink(m.tutorial);
    if (m.tutorial && !tutorial) warn();
    return { ...rec, scrolls: arr(m.scrolls).map(String).filter(Boolean), tutorial };
  });

  return { ok: true, data: out, warnings };
}

/* ---------- Preferences ---------- */
const prefs = {
  theme: 'system', timeFormat: 'system', resetHour: 0, weekStart: 1, collapsed: false, sort: 'soonest',
  notify: false, sound: false, remindBefore: true, remindAt: true, remindAfter: true, remindScope: 'favorites',
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
    const p = parseClock(tm);
    if (!p) continue;
    // "24:00" belongs to the end of this day, so it shifts into tomorrow.
    const base = Date.UTC(y, mo, d + p.nextDay, p.h, p.m) - offsetMin * 60000;
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
// Spawn type: 'scheduled' (fixed daily times), 'random' (no fixed time) or 'respawn' (spawns again after a kill).
const modeOf = (m) => (m.type === 'Spawn' ? m.spawnMode || 'scheduled' : '');
const isSpawn = (m) => modeOf(m) === 'scheduled' && Array.isArray(m.spawnTimes) && m.spawnTimes.length > 0;
function fmtDuration(min) {
  const nf = (n, unit) => new Intl.NumberFormat(i18n.lang, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n);
  const hh = Math.floor(min / 60), mm = min % 60;
  return [hh ? nf(hh, 'hour') : '', mm ? nf(mm, 'minute') : ''].filter(Boolean).join(' ') || nf(0, 'minute');
}

/* ---------- Shared schedules for World Boss and Events ---------- */
const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayIndex = (d) => (DAY_CODES.includes(d) ? DAY_CODES.indexOf(d) : Number(d));
const dayName = (d) => (d === '*' || d === 'Daily'
  ? t('sc.daily')
  : new Intl.DateTimeFormat(i18n.lang, { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 7 + dayIndex(d)))));
function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (mm > 59 || hh > 24 || (hh === 24 && mm !== 0)) return null;
  return { h: hh === 24 ? 0 : hh, m: mm, nextDay: hh === 24 ? 1 : 0 };
}
function scheduleParts(schedule) {
  return (Array.isArray(schedule) ? schedule : []).map((e) => ({
    days: Array.isArray(e.days) ? e.days : (e.day != null ? [e.day] : []),
    times: Array.isArray(e.times) ? e.times : (e.time != null ? [e.time] : []),
  })).filter((e) => e.days.length && e.times.length);
}
function scheduleLines(schedule) {
  return scheduleParts(schedule).map((e) => ({
    day: e.days.some((d) => d === '*' || d === 'Daily') ? t('sc.daily') : e.days.map(dayName).join(', '),
    times: e.times.join(', '),
  }));
}
function fmtSchedule(schedule) {
  const lines = scheduleLines(schedule);
  return lines.length ? lines.map((l) => `${l.day}: ${l.times}`).join(' · ') : t('sc.none');
}
function nextSchedule(schedule, offsetMin, now = Date.now()) {
  let best = Infinity;
  for (const e of scheduleParts(schedule)) {
    for (let d = -1; d < 8; d++) {
      const local = new Date(now + d * DAY + offsetMin * 60000);
      const idx = local.getUTCDay();
      if (!e.days.some((x) => x === '*' || x === 'Daily' || dayIndex(x) === idx)) continue;
      for (const tm of e.times) {
        const p = parseClock(tm);
        if (!p) continue;
        const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + p.nextDay, p.h, p.m) - offsetMin * 60000;
        if (at > now && at < best) best = at;
      }
    }
  }
  return best;
}
function collectSchedule(...lists) { return lists.flat(Infinity).filter((x) => x && typeof x === 'object' && !Array.isArray(x)); }

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
let worldBosses = [];
let events = [];
let crafting = [];
let mystery = [];
let meta = {};
let lastSig = '';
let loaded = false;
let loadError = '';
let lastLoad = { source: '', updatedAt: '' };
let currentBase = [];
let cdRefs = [];
let homeRefs = [];
let contentRefs = [];
let upcomingRefs = [];
let homeList = [];
let editingCharId = null;
let lastUpdate = null;
const filters = { type: '', cycle: '', map: '', area: '', q: '', favOnly: false, hideDone: false };
const settingsRefs = {};

const els = {
  app: $('#app'), rows: $('#rows'), scroll: $('#view-missions .scroll'), empty: $('#empty'), emptyText: $('#empty-text'),
  emptyBtn: $('#empty-btn'), status: $('#data-status'), retry: $('#data-retry'), search: $('#search'), sort: $('#sort'),
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
    (!q || searchWords(m, ['name', 'map', 'area', 'location']).includes(q)));
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
  let ref = null;
  if (isSpawn(m)) {
    const cd = h('span', { class: 'cd' }, '--:--:--');
    const sub = h('div', { class: 'cd-sub' });
    const now = Date.now(), off = zoneOffset();
    const all = m.spawnTimes.map((tm) => nextSpawn([tm], off, now).next).sort((a, b) => a - b).map(fmtClock).join(', ');
    ref = { m, cd, sub };
    countdown = h('td', { title: t('cd.tip', { times: all }) }, cd, sub);
  } else if (modeOf(m) === 'random') {
    countdown = h('td', {}, h('span', { class: 'pill' }, t('cd.random')));
  } else if (modeOf(m) === 'respawn') {
    countdown = h('td', {}, h('span', { class: 'pill' }, t('cd.respawn')),
      m.respawnMinutes ? h('div', { class: 'cd-sub' }, t('cd.respawnAbout', { time: fmtDuration(m.respawnMinutes) })) : null);
  } else {
    countdown = h('td', {}, h('span', { class: 'pill' }, vlabel('Summon')));
  }

  const tr = h('tr', { class: done ? 'done' : '' },
    h('td', {},
      h('div', { class: 'name' }, trText(m, 'name', m.name)),
      h('div', { class: 'meta' }, trText(m, 'map', m.map), h('span', { class: 'pill' }, vlabel(m.cycle)))),
    h('td', {}, h('div', {}, trText(m, 'area', m.area)), h('div', { class: 'meta' }, trText(m, 'location', m.location))),
    countdown,
    h('td', {}, h('label', { class: 'status' }, check, statusText)),
    h('td', {}, fav));
  if (ref) { ref.tr = tr; cdRefs.push(ref); }
  return tr;
}

function render() {
  currentBase = filtered();
  els.clear.hidden = !anyFilter();
  const list = sortList(filters.hideDone ? currentBase.filter((m) => !isComplete(m)) : currentBase);
  cdRefs = [];
  const keepTop = els.scroll.scrollTop;
  els.rows.replaceChildren(...list.map(renderRow));
  els.scroll.scrollTop = keepTop;
  tick();
  updateSummary();

  const none = list.length === 0;
  els.scroll.hidden = none;
  els.empty.hidden = !none;
  if (none) {
    if (!missions.length) {
      els.emptyText.textContent = !loaded ? t('e.loading') : loadError ? t('e.failed', { err: loadError }) : t('e.none');
      els.emptyBtn.textContent = t('tr.refresh');
      els.emptyBtn.onclick = () => loadData({ force: true });
    } else {
      els.emptyText.textContent = t('e.nomatch');
      els.emptyBtn.textContent = t('f.clearAll');
      els.emptyBtn.onclick = clearFilters;
    }
    els.emptyBtn.hidden = !loaded;
  }
}

// Paints one countdown (table row or Home item) and returns its state: 'normal' | 'soon' | 'live'.
function paintCd(r, now, off) {
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
  return st;
}

// Updates countdowns in place every second (no re-render, so focus is never lost).
function paintSchedule(r, now, off) {
  const at = nextSchedule(r.schedule, off, now);
  if (!isFinite(at)) {
    if (r.cd.textContent !== '—') r.cd.textContent = '—';
    if (r.cd.dataset.state !== 'normal') r.cd.dataset.state = 'normal';
    if (r.sub.textContent !== t('sc.noNext')) r.sub.textContent = t('sc.noNext');
    return;
  }
  const left = at - now;
  const text = fmtCountdown(left);
  const sub = t('cd.at', { time: fmtClock(at) });
  const state = left < SOON_MIN * 60000 ? 'soon' : 'normal';
  if (r.cd.textContent !== text) r.cd.textContent = text;
  if (r.cd.dataset.state !== state) r.cd.dataset.state = state;
  if (r.sub.textContent !== sub) r.sub.textContent = sub;
  if (r.row) r.row.classList.toggle('is-soon', state === 'soon');
}

function tick() {
  const now = Date.now(), off = zoneOffset();
  for (const r of cdRefs) {
    const st = paintCd(r, now, off);
    const hot = !r.tr.classList.contains('done'); // finished missions are not highlighted
    r.tr.classList.toggle('is-soon', hot && st === 'soon');
    r.tr.classList.toggle('is-live', hot && st === 'live');
  }
  for (const r of homeRefs) {
    const st = paintCd(r, now, off);
    r.row.classList.toggle('is-soon', st === 'soon');
    r.row.classList.toggle('is-live', st === 'live');
  }
  for (const r of [...contentRefs, ...upcomingRefs]) paintSchedule(r, now, off);
  tickHomeStats(now, off);
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

/* ---------- Home ---------- */
// Bosses shown on Home: your favorites if you have any (and they are not done yet), otherwise every scheduled boss.
// If every favorite spawn boss is complete, do not fall back to the unfavorite list.
function homeScope() {
  const favs = profile().favorites;
  const favSpawn = missions.filter((m) => isSpawn(m) && favs[m.id]);
  const allDone = favSpawn.length > 0 && favSpawn.every(isComplete);
  if (allDone) return { list: [], favorites: true, allDone: true };
  const f = favSpawn.filter((m) => !isComplete(m));
  const all = missions.filter((m) => isSpawn(m) && !isComplete(m));
  return { list: f.length ? f : all, favorites: f.length > 0, allDone: false };
}

function tickHomeStats(now, off) {
  if ($('#view-home').hidden) return;
  let soon = 0, live = 0;
  for (const m of homeList) {
    const { next, prev } = nextSpawn(m.spawnTimes, off, now);
    if ((now - prev) / 60000 < LIVE_MIN) live++;
    else if (next - now < SOON_MIN * 60000) soon++;
  }
  $('#h-soon').textContent = String(soon);
  $('#h-live').textContent = String(live);
  $('#cell-soon').classList.toggle('zero', !soon);
  $('#cell-live').classList.toggle('zero', !live);
}

function renderCharCard() {
  const ch = state.characters.find((c) => c.id === state.activeId);
  const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  $('#char-card').replaceChildren(ch
    ? h('div', { class: 'charcard' },
        h('h3', {}, t('tr.character')),
        h('div', { class: 'ign' }, ch.ign),
        h('dl', { class: 'kv' },
          kv(t('c.class'), ch.cls), kv(t('c.server'), ch.server), kv(t('c.alliance'), ch.alliance),
          kv(t('c.clan'), ch.clan || t('c.none')), kv(t('f.favorites'), String(Object.keys(ch.favorites).length))),
        h('button', { type: 'button', class: 'btn', onclick: () => showView('characters') }, t('h.manage')))
    : h('div', { class: 'charcard' },
        h('h3', {}, t('tr.character')),
        h('p', { class: 'sub' }, t('c.empty')),
        h('button', { type: 'button', class: 'btn primary', onclick: () => openCharDialog(null) }, icon('plus'), t('c.add'))));
}

function celebration() {
  // Rotate weekly so the message stays stable while the app is open, but changes each week.
  const now = new Date();
  const week = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / (7 * DAY));
  const useB = (week + String(state.activeId || '').length) % 2 === 1;
  return {
    title: `${t(useB ? 'h.doneTitleB' : 'h.doneTitleA')} ${useB ? '⚔️' : '🎉'}`,
    sub: t(useB ? 'h.doneSubB' : 'h.doneSubA'),
  };
}

function renderUpcoming() {
  const now = Date.now(), off = zoneOffset();
  const items = [];
  for (const b of worldBosses) {
    const at = nextSchedule(b.schedule, off, now);
    if (!isFinite(at)) continue;
    items.push({ kind: t('nav.worldBoss'), name: trText(b, 'name', b.name),
      where: [trText(b, 'map', b.map), trText(b, 'area', b.area)].filter(Boolean).join(', '),
      schedule: b.schedule, at });
  }
  for (const e of events) {
    const schedule = collectSchedule(e.schedule, ...(e.areas || []).map((a) => a.schedule));
    const at = nextSchedule(schedule, off, now);
    if (!isFinite(at)) continue;
    const first = (e.areas || [])[0] || {};
    items.push({ kind: t('nav.events'), name: trText(e, 'name', e.name),
      where: [...new Set([trText(e, 'map', e.map), trText(first, 'map', first.map), trText(first, 'area', first.area)].filter(Boolean))].join(', '),
      schedule, at });
  }
  items.sort((a, b) => a.at - b.at);
  const top = items.slice(0, 6);
  upcomingRefs = [];
  $('#upcoming-list').replaceChildren(...top.map((item) => {
    const cd = h('span', { class: 'cd' }, '--:--:--');
    const sub = h('div', { class: 'cd-sub' });
    const row = h('div', { class: 'upcoming-row' },
      h('span', { class: 'kind' }, item.kind),
      h('div', {}, h('div', { class: 'name' }, item.name), h('div', { class: 'where' }, item.where)),
      h('div', { class: 'cd-wrap' }, cd, sub));
    upcomingRefs.push({ cd, sub, schedule: item.schedule, row });
    return row;
  }));
  $('#upcoming-empty').hidden = top.length > 0;
}

function renderHome() {
  const ch = state.characters.find((c) => c.id === state.activeId);
  $('#home-title').textContent = ch ? t('h.welcome', { name: ch.ign }) : t('h.welcomeNoChar');
  $('#home-sub').textContent = new Date().toLocaleDateString([i18n.lang], { weekday: 'long', month: 'long', day: 'numeric' });

  $$('.cell.prog').forEach((cell) => {
    const c = cell.dataset.cycle;
    const total = missions.filter((m) => m.cycle === c).length;
    const done = missions.filter((m) => m.cycle === c && isComplete(m)).length;
    $('.num', cell).textContent = total ? `${done}/${total}` : '0';
    $('.meter span', cell).style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  });

  const { list, favorites, allDone } = homeScope();
  homeList = list;
  const now = Date.now();
  const top = list.map((m) => ({ m, key: sortKey(m, now) })).sort((a, b) => a.key - b.key).slice(0, 8);
  homeRefs = [];
  $('#next-list').replaceChildren(...top.map(({ m }) => {
    const cd = h('span', { class: 'cd' }, '--:--:--');
    const sub = h('div', { class: 'cd-sub' });
    const row = h('div', { class: 'next-row' },
      h('div', {}, h('div', { class: 'name' }, trText(m, 'name', m.name)),
        h('div', { class: 'meta' }, [trText(m, 'map', m.map), trText(m, 'area', m.area), trText(m, 'location', m.location)].join(', '))),
      h('div', { class: 'cd-wrap' }, cd, sub));
    homeRefs.push({ m, cd, sub, row });
    return row;
  }));
  $('#next-done').hidden = !allDone;
  $('#next-empty').hidden = allDone || top.length > 0;
  if (allDone) {
    const msg = celebration();
    $('#done-title').textContent = msg.title;
    $('#done-sub').textContent = msg.sub;
  }
  $('#next-scope').textContent = missions.length
    ? (allDone ? t('h.nextAllDone') : favorites ? t('h.nextFavs') : t('h.nextAll')) : '';
  renderUpcoming();
  renderCharCard();
  tick();
}

/* ---------- World Boss, Events, Crafting and Mystery ---------- */
function scheduleCell(schedule) {
  const cd = h('span', { class: 'cd' }, '--:--:--');
  const sub = h('div', { class: 'cd-sub' });
  contentRefs.push({ cd, sub, schedule });
  return h('td', { class: 'next-cell' }, cd, sub);
}

function scheduleBlock(schedule) {
  const lines = scheduleLines(schedule);
  return h('div', { class: 'sched-lines' }, lines.length
    ? lines.map((l) => h('div', { class: 'sched-line' }, h('span', { class: 'day' }, l.day), ': ', h('span', { class: 'times' }, l.times)))
    : h('div', { class: 'sched-line muted' }, t('sc.none')));
}

function renderWorldBoss() {
  const rows = $('#wb-rows');
  rows.replaceChildren(...worldBosses.map((b) => h('tr', {},
    h('td', {}, h('div', { class: 'name' }, trText(b, 'name', b.name))),
    h('td', { class: 'muted' }, trText(b, 'map', b.map)),
    h('td', {}, h('div', {}, trText(b, 'area', b.area)), h('div', { class: 'meta' }, trText(b, 'location', b.location))),
    h('td', {}, scheduleBlock(b.schedule)),
    scheduleCell(b.schedule))));
  $('#wb-empty').hidden = worldBosses.length > 0;
  rows.closest('.scroll').hidden = !worldBosses.length;
}

function renderEvents() {
  const rows = $('#ev-rows');
  rows.replaceChildren(...events.map((e) => {
    const schedule = collectSchedule(e.schedule, ...(e.areas || []).map((a) => a.schedule));
    const areas = (e.areas || []).length ? e.areas : [{ map: e.map, area: e.area, location: e.location, schedule: e.schedule }];
    return h('tr', {},
      h('td', {}, h('div', { class: 'name' }, trText(e, 'name', e.name))),
      h('td', { class: 'muted' }, trText(e, 'map', e.map)),
      h('td', {}, h('div', { class: 'area-lines' }, areas.map((a) => h('div', { class: 'area-line' },
        h('div', { class: 'where' }, [trText(a, 'map', a.map), trText(a, 'area', a.area)].filter(Boolean).join(' · ')),
        a.location ? h('div', { class: 'meta' }, trText(a, 'location', a.location)) : null,
        scheduleBlock(a.schedule))))),
      h('td', {}, scheduleBlock(schedule)),
      scheduleCell(schedule));
  }));
  $('#ev-empty').hidden = events.length > 0;
  rows.closest('.scroll').hidden = !events.length;
}

function renderCrafting() {
  const rows = $('#cr-rows');
  rows.replaceChildren(...crafting.map((c) => {
    const src = safeImageUrl(c.badgeImage);
    const image = src
      ? h('img', { class: 'badge-img', src, alt: trText(c, 'badge', c.badge), loading: 'lazy', referrerpolicy: 'no-referrer',
          onerror: (e) => e.currentTarget.replaceWith(h('span', { class: 'badge-img missing' }, t('cr.noImage'))) })
      : h('span', { class: 'badge-img missing' }, t('cr.noImage'));
    return h('tr', {},
      h('td', {}, h('div', { class: 'name' }, trText(c, 'boss', c.boss))),
      h('td', {}, trText(c, 'badge', c.badge)),
      h('td', {}, image),
      h('td', {}, h('div', {}, trText(c, 'npc', c.npc)), h('div', { class: 'meta' }, trText(c, 'npcLocation', c.npcLocation))),
      h('td', {}, trText(c, 'summonLocation', c.summonLocation)));
  }));
  $('#cr-empty').hidden = crafting.length > 0;
  rows.closest('.scroll').hidden = !crafting.length;
}

function renderMystery() {
  const rows = $('#my-rows');
  rows.replaceChildren(...mystery.map((m) => h('tr', {},
    h('td', {}, h('div', { class: 'name' }, trText(m, 'name', m.name))),
    h('td', {}, h('div', { class: 'scroll-list' }, (m.scrolls || []).map((s, i) =>
      h('span', { class: 'pill' }, trText(m, 'scrolls', s, i))))),
    h('td', {}, m.tutorial
      ? h('a', { class: 'tutorial-link', href: m.tutorial, target: '_blank', rel: 'noopener noreferrer' }, t('my.open'), icon('download'))
      : h('span', { class: 'muted' }, '—')))));
  $('#my-empty').hidden = mystery.length > 0;
  rows.closest('.scroll').hidden = !mystery.length;
}

function renderContent() {
  contentRefs = [];
  renderWorldBoss();
  renderEvents();
  renderCrafting();
  renderMystery();
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
  fillSelect(els.mapSel, maps, filters.map, t('f.allMaps'), (v) => trText(missions.find((m) => m.map === v), 'map', v));
  fillSelect(els.areaSel, areas, filters.area, t('f.allAreas'), (v) => trText(missions.find((m) => m.area === v), 'area', v));
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
  renderHome();
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
  if (dataWarning) return `${t('d.invalid')}${when ? ` (${when})` : ''}`;
  if (lastLoad.source === 'fallback') return t('d.fallback');
  if (lastLoad.source === 'cache') return when ? t('d.offlineDate', { date: when }) : t('d.offline');
  if (lastLoad.source === 'empty') return t('d.empty');
  if (lastLoad.source === 'online') return when ? `${t('d.online')} · ${t('d.updated', { date: when })}` : t('d.online');
  return when ? t('d.updated', { date: when }) : '';
}

function updateDataStatus() {
  const text = dataSummary();
  els.status.textContent = text;
  if (els.retry) {
    els.retry.hidden = !(loadError || dataWarning || lastLoad.source === 'cache' || lastLoad.source === 'fallback');
    els.retry.textContent = t('d.retry');
  }
  if (settingsRefs.data) settingsRefs.data.textContent = text || t('s.noData');
}

function applyValidatedData(d) {
  lastSig = JSON.stringify(d);
  meta = d;
  missions = d.missions;
  worldBosses = d.worldBosses;
  events = d.events;
  crafting = d.crafting;
  mystery = d.mystery;
  renderFilters();
}

async function loadData(opts = {}) {
  if (loadingData) return;
  loadingData = true;
  els.refresh.disabled = true;
  els.refresh.classList.add('busy');
  if (els.retry) els.retry.textContent = t('d.retrying');
  dataWarning = '';
  const useFallback = (err) => {
    const checked = window.MIR4_FALLBACK_DATA ? validateData(window.MIR4_FALLBACK_DATA) : null;
    if (checked && checked.ok) {
      applyValidatedData(checked.data);
      loadError = '';
      dataWarning = '';
      lastLoad = { source: 'fallback', updatedAt: checked.data.updatedAt || '' };
    } else loadError = err || 'Could not load mission data';
  };
  try {
    const res = await window.desktop.loadMissions({ force: !!opts.force });
    loaded = true;
    if (!res || !res.ok) {
      if (!missions.length) useFallback(res && res.error);
      else {
        loadError = (res && res.error) || 'Could not load mission data';
        lastLoad = { source: 'cache', updatedAt: lastLoad.updatedAt };
      }
    } else {
      const checked = validateData(res.data);
      if (!checked.ok) {
        if (!missions.length) useFallback(checked.errors.join('; '));
        else { loadError = checked.errors.join('; '); dataWarning = t('d.invalid'); }
      } else {
        loadError = '';
        dataWarning = checked.warnings ? t('d.invalid') : '';
        lastLoad = { source: res.source, updatedAt: checked.data.updatedAt || '' };
        if (!res.unchanged && lastSig !== JSON.stringify(checked.data)) applyValidatedData(checked.data);
      }
    }
  } catch (err) {
    loadError = err && err.message ? err.message : 'Could not load mission data';
  } finally {
    loadingData = false;
    els.refresh.disabled = false;
    els.refresh.classList.remove('busy');
  }
  render();
  renderContent();
  renderHome();
  updateDataStatus();
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
  if (name === 'home') renderHome();
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

/* In-app fallback used when desktop/browser notifications are unavailable or blocked. */
let appToastTimer = null;
function appToast(title, body) {
  const el = $('#app-toast');
  if (!el) return;
  el.replaceChildren(h('strong', {}, title), body ? h('span', {}, body) : null);
  el.hidden = false;
  clearTimeout(appToastTimer);
  appToastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

function fireReminder(kind, items) {
  const n = items.length;
  const first = items[0].m;
  const name = trText(first, 'name', first.name);
  const title = t(`n.${kind}${n === 1 ? '1' : 'N'}`, { name, count: n, n: REMIND_MIN });
  const body = n === 1
    ? [trText(first, 'map', first.map), trText(first, 'area', first.area), trText(first, 'location', first.location)].join(', ')
    : items.map((i) => trText(i.m, 'name', i.m.name)).join(', ');
  if (prefs.notify) {
    const status = window.desktop.notifyStatus ? window.desktop.notifyStatus() : 'granted';
    if (status === 'granted') {
      Promise.resolve(window.desktop.notify({ title, body, kind }))
        .then((res) => { if (!res || !res.ok) appToast(title, body); })
        .catch(() => appToast(title, body));
    } else appToast(title, body); // permission denied / not requested: never prompt from a background timer
  }
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
  const profileKey = state.activeId || 'default';
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
  let changed = false;
  for (const kind of ['before', 'at', 'after']) {
    const fresh = groups[kind].filter((item) => {
      const key = `${profileKey}|${item.m.id}|${item.spawnAt}|${kind}`;
      if (fired[key]) return false;
      fired[key] = now;
      changed = true;
      return true;
    });
    if (fresh.length) fireReminder(kind, fresh);
  }
  if (changed) {
    // Keep at most a week of history so the key does not grow forever.
    const cutoff = now - 7 * DAY;
    for (const key of Object.keys(fired)) if (fired[key] < cutoff) delete fired[key];
    const keys = Object.keys(fired);
    if (keys.length > 1000) for (const key of keys.slice(0, keys.length - 1000)) delete fired[key];
    writeJson(FIRED_KEY, fired);
  }
}

// Background tabs throttle timers; recalculate when the window becomes active again.
function resyncBackground() {
  if (document.hidden) return;
  lastReminderTick = Date.now() - 90000;
  checkReminders();
  tick();
}
document.addEventListener('visibilitychange', resyncBackground);
window.addEventListener('focus', resyncBackground);

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
      if (!ok) { prefs.notify = false; input.checked = false; settingsRefs.notifyMsg.textContent = t('s.notifyDenied'); }
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
  const status = window.desktop.notifyStatus ? window.desktop.notifyStatus() : 'granted';
  if (status === 'denied') {
    settingsRefs.notifyMsg.textContent = t('s.notifyDenied');
    return;
  }
  const res = await window.desktop.notify({ title: t('n.testTitle'), body: t('n.testBody'), kind: 'test' });
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
    case 'error': return s.code === 'nofiles' ? t('u.noFiles') : t('u.error', { err: s.error || '' });
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
  const notifyStatus = window.desktop.notifyStatus ? window.desktop.notifyStatus() : 'granted';
  if (notifyStatus !== 'granted' && notifyStatus !== 'unsupported') {
    settingsRefs.notifyMsg.textContent = t('s.notifyDenied');
  }
  const testNote = h('button', { type: 'button', class: 'btn small', onclick: testNotification }, t('s.sendTest'));
  const testSound = h('button', { type: 'button', class: 'btn small', onclick: playChime }, t('s.playSound'));

  settingsRefs.data = h('span', { class: 'sub' }, dataSummary() || t('s.noData'));
  const refreshBtn = h('button', { type: 'button', class: 'btn', onclick: loadData }, icon('refresh'), t('s.refresh'));

  settingsRefs.update = h('span', { class: 'sub' }, IS_WEB ? t('s.webUpdates') : lastUpdate ? updateText(lastUpdate) : t('s.notChecked'));
  const updateBtn = IS_WEB ? null : h('button', { type: 'button', class: 'btn', onclick: () => window.desktop.checkForUpdates() }, t('s.check'));
  settingsRefs.version = h('span', { class: 'sub' }, settingsRefs.versionText || '');

  const closeSeg = segEl([['ask', t('w.closeAsk')], ['tray', t('w.toTray')], ['quit', t('w.quit')]], 'ask');
  bindSeg(closeSeg, (v) => window.desktop.setCloseBehavior(v));
  if (!IS_WEB) window.desktop.getCloseBehavior().then((v) => setSeg(closeSeg, v));

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
      row(t('s.version'), null, settingsRefs.version),
      IS_WEB ? null : row(t('w.closeBehavior'), t('w.closeHint'), closeSeg)),
    h('h3', {}, t('s.about')),
    h('div', { class: 'panel' },
      row(t('s.developer'), null, h('span', {}, DEV.name)),
      row(t('s.email'), null, h('div', { class: 'setting-end' }, mail, copyBtn))),
    h('p', { class: 'sub' }, t('s.disclaimer')));
  fillResetOptions();
}

/* ---------- Texts the main process needs (close prompt, tray menu) ---------- */
function pushLabels() {
  if (IS_WEB || !window.desktop.setLabels) return;
  window.desktop.setLabels({
    closeTitle: t('w.closeTitle'), closeMsg: t('w.closeMsg'), toTray: t('w.toTray'), quit: t('w.quit'),
    cancel: t('c.cancel'), remember: t('w.remember'), trayOpen: t('w.trayOpen'),
  });
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
  renderContent();
  renderHome();
  pushLabels();
  updateDataStatus();
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
els.refresh.addEventListener('click', () => loadData({ force: true }));
if (els.retry) els.retry.addEventListener('click', () => loadData({ force: true }));
$('#home-open').addEventListener('click', () => showView('missions'));
if ($('#app-toast')) $('#app-toast').addEventListener('click', () => { $('#app-toast').hidden = true; });
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));

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
  $('#dismiss-btn').hidden = s.state !== 'error';
}
$('#dismiss-btn').addEventListener('click', () => { banner.hidden = true; });
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
renderContent();
renderHome();
pushLabels();
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
  if (!$('#view-home').hidden) renderHome();
}, 60 * 1000);
