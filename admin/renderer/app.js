/* Mir4Local admin app */
const PREFS_KEY = 'mir4local.admin.prefs.v1';
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
const prefs = { theme: 'system', collapsed: false, ...readJson(PREFS_KEY, {}) };
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const localOffset = () => -new Date().getTimezoneOffset();
const OFFSETS = [-720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840];
function offsetLabel(min) {
  if (!min) return 'UTC';
  const a = Math.abs(min), hh = Math.floor(a / 60), mm = a % 60;
  return `UTC${min < 0 ? '-' : '+'}${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}`;
}

function normalize(d) {
  const utcOffset = Number.isFinite(d?.utcOffset) ? d.utcOffset : localOffset();
  return {
    version: 1,
    updatedAt: d?.updatedAt ?? null,
    utcOffset,
    timeLabel: offsetLabel(utcOffset),
    missions: Array.isArray(d?.missions) ? d.missions : [],
  };
}

/* ---------- Seg helpers ---------- */
function setSeg(el, v) { $$('button[data-v]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); }
function getSeg(el) { return $('button[aria-pressed="true"]', el)?.dataset.v; }
function bindSeg(el, onPick) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    setSeg(el, b.dataset.v);
    if (onPick) onPick(b.dataset.v);
  });
}

/* ---------- State ---------- */
let data = normalize(null);
let dirty = false;
let settings = {};
let editingId = null;
let formTimes = [];
let lastFocus = null;
let remembered = null; // map/area/type/cycle kept between "Save and add another"
const filters = { q: '', type: '', cycle: '', map: '', area: '' };

const f = {
  form: $('#form'), name: $('#f-name'), map: $('#f-map'), area: $('#f-area'), location: $('#f-location'),
  type: $('#f-type'), cycle: $('#f-cycle'), time: $('#f-time'),
};
const els = {
  rows: $('#rows'), empty: $('#empty'), emptyText: $('#empty-text'), emptyActions: $('#empty-actions'),
  scroll: $('.scroll'), count: $('#count'), tz: $('#tz'), search: $('#search'), clear: $('#clear-btn'), drawer: $('#drawer'), scrim: $('#scrim'), chips: $('#chips'),
  formError: $('#form-error'), publish: $('#publish-btn'), pull: $('#pull-btn'), dot: $('#pub-dot'),
};

hydrateIcons();

function toast(msg, opts = {}) {
  const t = h('div', { class: `toast ${opts.kind || ''}`, role: opts.kind === 'error' ? 'alert' : 'status' }, h('span', {}, msg));
  if (opts.action) t.append(h('button', { type: 'button', class: 'btn small', onclick: () => { opts.action.fn(); t.remove(); } }, opts.action.label));
  t.append(h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Dismiss', onclick: () => t.remove() }, icon('x')));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), opts.ms || (opts.kind === 'error' ? 10000 : 4500));
}

async function persist() { await window.admin.saveDraft({ data, dirty }); }
function touch() { dirty = true; persist(); renderAll(); }

/* ---------- Theme, nav, sidebar ---------- */
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-btn .label').textContent = dark ? 'Light mode' : 'Dark mode';
  $('#theme-btn i').replaceChildren(icon(dark ? 'sun' : 'moon'));
}
function setTheme(t) { prefs.theme = t; savePrefs(); window.themeApply(); setSeg($('#theme-seg'), t); }
window.addEventListener('themechange', syncThemeBtn);
$('#theme-btn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
bindSeg($('#theme-seg'), setTheme);

function showView(name) {
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('.nav-item[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === name ? 'page' : 'false'));
}
$$('.nav-item[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function applyCollapsed() {
  $('#app').classList.toggle('collapsed', prefs.collapsed);
  $('#collapse-btn').title = prefs.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}
$('#collapse-btn').addEventListener('click', () => { prefs.collapsed = !prefs.collapsed; savePrefs(); applyCollapsed(); });

/* ---------- Time zone ---------- */
function renderTz() {
  const list = OFFSETS.includes(data.utcOffset) ? OFFSETS : [...OFFSETS, data.utcOffset].sort((a, b) => a - b);
  els.tz.replaceChildren(...list.map((o) => h('option', { value: String(o) }, offsetLabel(o))));
  els.tz.value = String(data.utcOffset);
  $('#tz-hint').textContent = offsetLabel(data.utcOffset);
}
els.tz.addEventListener('change', () => {
  data.utcOffset = Number(els.tz.value);
  data.timeLabel = offsetLabel(data.utcOffset);
  touch();
});

/* ---------- Spawn time parsing ---------- */
function parseTimes(str) {
  const times = [], bad = [];
  const norm = str.replace(/\s*(am|pm)\b/gi, '$1');
  for (const tok of norm.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(tok);
    if (!m || (!m[2] && !m[3])) { bad.push(tok); continue; }
    let hh = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    const ap = m[3] && m[3].toLowerCase();
    if (mm > 59 || (ap ? hh < 1 || hh > 12 : hh > 23)) { bad.push(tok); continue; }
    if (ap) hh = (hh % 12) + (ap === 'pm' ? 12 : 0);
    times.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return { times, bad };
}

function showFormError(msg) { els.formError.textContent = msg; els.formError.hidden = !msg; }

function renderChips() {
  els.chips.replaceChildren(...formTimes.map((t) =>
    h('span', { class: 'chip' }, t,
      h('button', { type: 'button', 'aria-label': `Remove ${t}`, onclick: () => { formTimes = formTimes.filter((x) => x !== t); renderChips(); } }, icon('x')))));
}

// Adds whatever is typed in the time box. Returns false if it couldn't be read.
function commitTimeInput() {
  const raw = f.time.value.trim();
  if (!raw) return true;
  const { times, bad } = parseTimes(raw);
  if (bad.length) { showFormError(`Couldn't read: ${bad.join(', ')}. Use 24-hour times like 08:30, or 8:30pm.`); return false; }
  for (const t of times) if (!formTimes.includes(t)) formTimes.push(t);
  formTimes.sort();
  f.time.value = '';
  showFormError('');
  renderChips();
  return true;
}
$('#add-time').addEventListener('click', () => { commitTimeInput(); f.time.focus(); });
f.time.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitTimeInput(); } });

/* ---------- Drawer (add / edit) ---------- */
const syncTypeUI = () => { $('#times-group').hidden = getSeg(f.type) !== 'Spawn'; };
bindSeg(f.type, syncTypeUI);
bindSeg(f.cycle);

function fillForm(m) {
  const v = m || { name: '', location: '', ...(remembered || { map: '', area: '', type: 'Spawn', cycle: 'Daily' }), spawnTimes: [] };
  f.name.value = v.name; f.map.value = v.map; f.area.value = v.area; f.location.value = v.location;
  setSeg(f.type, v.type); setSeg(f.cycle, v.cycle);
  formTimes = [...(v.spawnTimes || [])];
  f.time.value = '';
  renderChips(); syncTypeUI(); showFormError('');
}

function openDrawer(m) {
  lastFocus = document.activeElement;
  editingId = m ? m.id : null;
  fillForm(m);
  $('#drawer-title').textContent = m ? 'Edit mission' : 'Add mission';
  $('#save-btn').textContent = m ? 'Save changes' : 'Add mission';
  $('#again-btn').hidden = !!m;
  els.drawer.hidden = false; els.scrim.hidden = false;
  requestAnimationFrame(() => {
    els.drawer.classList.add('open'); els.scrim.classList.add('open');
    f.name.focus();
  });
}

function closeDrawer() {
  els.drawer.classList.remove('open'); els.scrim.classList.remove('open');
  setTimeout(() => { els.drawer.hidden = true; els.scrim.hidden = true; }, 170);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
$('#drawer-close').addEventListener('click', closeDrawer);
$('#cancel-btn').addEventListener('click', closeDrawer);
els.scrim.addEventListener('click', closeDrawer);
$('#add-btn').addEventListener('click', () => openDrawer(null));

f.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const again = !!(e.submitter && e.submitter.dataset.again);
  const type = getSeg(f.type);
  if (type === 'Spawn') {
    if (!commitTimeInput()) return;
    if (!formTimes.length) { showFormError('Add at least one spawn time, or change the type to Summon.'); return; }
  }
  const rec = {
    name: f.name.value.trim(), map: f.map.value.trim(), area: f.area.value.trim(), location: f.location.value.trim(),
    type, cycle: getSeg(f.cycle), spawnTimes: type === 'Spawn' ? [...formTimes] : [],
  };
  if (editingId) {
    const i = data.missions.findIndex((m) => m.id === editingId);
    data.missions[i] = { id: editingId, ...rec };
  } else {
    data.missions.push({ id: newId(), ...rec });
  }
  remembered = { map: rec.map, area: rec.area, type: rec.type, cycle: rec.cycle };
  touch();
  if (again && !editingId) {
    fillForm(null);
    toast(`Added "${rec.name}"`);
    f.name.focus();
  } else {
    closeDrawer();
  }
});

/* ---------- List ---------- */
const anyFilter = () => !!(filters.q || filters.type || filters.cycle || filters.map || filters.area);

function visible() {
  const q = filters.q.trim().toLowerCase();
  return data.missions.filter((m) =>
    (!filters.type || m.type === filters.type) &&
    (!filters.cycle || m.cycle === filters.cycle) &&
    (!filters.map || m.map === filters.map) &&
    (!filters.area || m.area === filters.area) &&
    (!q || [m.name, m.map, m.area, m.location].join(' ').toLowerCase().includes(q)));
}

function move(id, dir) {
  const i = data.missions.findIndex((m) => m.id === id), j = i + dir;
  if (j < 0 || j >= data.missions.length) return;
  [data.missions[i], data.missions[j]] = [data.missions[j], data.missions[i]];
  touch();
}

function duplicate(m) {
  const copy = { ...m, id: newId(), name: `${m.name} (copy)`, spawnTimes: [...m.spawnTimes] };
  data.missions.splice(data.missions.findIndex((x) => x.id === m.id) + 1, 0, copy);
  touch();
  openDrawer(copy);
}

function remove(m) {
  const idx = data.missions.findIndex((x) => x.id === m.id);
  data.missions.splice(idx, 1);
  touch();
  toast(`Deleted "${m.name}"`, {
    action: { label: 'Undo', fn: () => { data.missions.splice(Math.min(idx, data.missions.length), 0, m); touch(); } },
  });
}

function clearFilters() {
  Object.assign(filters, { q: '', type: '', cycle: '', map: '', area: '' });
  els.search.value = '';
  renderAll();
}

function chipRow(el, values, current) {
  el.replaceChildren(...['', ...values].map((v) =>
    h('button', { type: 'button', class: 'fchip', 'data-v': v, 'aria-pressed': String(v === current) }, v || 'All')));
}

function renderFilters() {
  const maps = [...new Set(data.missions.map((m) => m.map))].sort();
  if (!maps.includes(filters.map)) filters.map = '';
  const areas = [...new Set(data.missions.filter((m) => !filters.map || m.map === filters.map).map((m) => m.area))].sort();
  if (!areas.includes(filters.area)) filters.area = '';
  chipRow($('#type-chips'), ['Spawn', 'Summon'], filters.type);
  chipRow($('#map-chips'), maps, filters.map);
  chipRow($('#area-chips'), areas, filters.area);
  chipRow($('#cycle-chips'), ['Daily', 'Weekly', 'Monthly'], filters.cycle);
  $('#map-group').hidden = !maps.length;
  $('#area-group').hidden = !areas.length;
  els.clear.hidden = !anyFilter();
}

function renderTable() {
  const list = visible();
  const canReorder = !anyFilter();
  els.count.textContent = data.missions.length ? `(${data.missions.length})` : '';

  els.rows.replaceChildren(...list.map((m) => {
    const i = data.missions.indexOf(m);
    const ib = (label, ic, fn, disabled) => h('button', { type: 'button', class: 'btn icon', title: label, 'aria-label': `${label} ${m.name}`, disabled, onclick: fn }, icon(ic));
    const tb = (label, fn, danger) => h('button', { type: 'button', class: `btn act ${danger ? 'danger' : ''}`, 'aria-label': `${label} ${m.name}`, onclick: fn }, label);
    const why = canReorder ? '' : 'Clear filters to reorder';
    return h('tr', { ondblclick: () => openDrawer(m) },
      h('td', { class: 'num' }, String(i + 1)),
      h('td', { class: 'name' }, m.name),
      h('td', { class: 'muted' }, m.map),
      h('td', {}, h('div', {}, m.area), h('div', { class: 'meta' }, m.location)),
      h('td', {}, h('span', { class: `badge ${m.type.toLowerCase()}` }, m.type)),
      h('td', { class: 'muted' }, m.cycle),
      h('td', { class: 'sched' }, m.type === 'Spawn' ? m.spawnTimes.join(', ') : 'None'),
      h('td', { class: 'acts' },
        ib(why || 'Move up', 'up', () => move(m.id, -1), !canReorder || i === 0),
        ib(why || 'Move down', 'down', () => move(m.id, 1), !canReorder || i === data.missions.length - 1),
        ib('Duplicate', 'copy', () => duplicate(m)),
        tb('Edit', () => openDrawer(m)),
        tb('Delete', () => remove(m), true)));
  }));

  const none = list.length === 0;
  els.scroll.hidden = none;
  els.empty.hidden = !none;
  if (none) {
    els.emptyActions.replaceChildren();
    if (!data.missions.length) {
      els.emptyText.textContent = 'No missions yet. Add your first one, or load what is already published.';
      els.emptyActions.append(
        h('button', { type: 'button', class: 'btn primary', onclick: () => openDrawer(null) }, icon('plus'), 'Add mission'),
        h('button', { type: 'button', class: 'btn', onclick: () => pull(false) }, icon('download'), 'Pull published data'));
    } else {
      els.emptyText.textContent = 'No missions match your filters.';
      els.emptyActions.append(h('button', { type: 'button', class: 'btn', onclick: clearFilters }, 'Clear filters'));
    }
  }
}

function renderLists() {
  const uniq = (k) => [...new Set(data.missions.map((m) => m[k]))].sort();
  $('#maps').replaceChildren(...uniq('map').map((v) => h('option', { value: v })));
  $('#areas').replaceChildren(...uniq('area').map((v) => h('option', { value: v })));
}

[['#type-chips', 'type'], ['#map-chips', 'map'], ['#area-chips', 'area'], ['#cycle-chips', 'cycle']].forEach(([sel, key]) =>
  $(sel).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    filters[key] = b.dataset.v;
    if (key === 'map') filters.area = '';
    renderFilters();
    renderTable();
  }));
els.clear.addEventListener('click', clearFilters);
els.search.addEventListener('input', () => { filters.q = els.search.value; els.clear.hidden = !anyFilter(); renderTable(); });

/* ---------- Publish view ---------- */
function renderPublish() {
  const spawn = data.missions.filter((m) => m.type === 'Spawn').length;
  $('#pub-state').textContent = dirty ? 'You have unpublished changes' : 'Everything is published';
  $('#pub-state').dataset.dirty = String(dirty);
  $('#pub-meta').textContent =
    `${data.missions.length} missions (${spawn} spawn, ${data.missions.length - spawn} summon). ` +
    (data.updatedAt ? `Last published ${new Date(data.updatedAt).toLocaleString()}.` : 'Not published yet.');
  $('#pub-target').textContent =
    `Saves data/missions.json to ${settings.owner || '?'}/${settings.repo || '?'} (${settings.branch || 'main'}). ` +
    'Players see changes when their app next refreshes, within 15 minutes or when they press Refresh.';
  els.dot.hidden = !dirty;
}

function renderAll() { renderLists(); renderFilters(); renderTable(); renderTz(); renderPublish(); }

async function publish() {
  els.publish.disabled = true;
  data.timeLabel = offsetLabel(data.utcOffset);
  const res = await window.admin.publish(data);
  els.publish.disabled = false;
  if (!res.ok) return toast(res.error, { kind: 'error' });
  data.updatedAt = res.updatedAt;
  dirty = false;
  await persist();
  renderAll();
  toast('Published. Players will see it on their next refresh.');
}
els.publish.addEventListener('click', publish);

async function pull(askFirst) {
  if (askFirst && dirty && !confirm('You have unpublished changes. Pulling replaces them with the published data. Continue?')) return;
  els.pull.disabled = true;
  const res = await window.admin.pull();
  els.pull.disabled = false;
  if (!res.ok) return toast(res.error, { kind: 'error' });
  if (!res.data) return toast('Nothing is published yet. Add missions and publish them.');
  data = normalize(res.data);
  dirty = false;
  await persist();
  renderAll();
  toast('Loaded the published data.');
}
els.pull.addEventListener('click', () => pull(true));

/* ---------- Settings view ---------- */
function fillSettings() {
  $('#s-owner').value = settings.owner || '';
  $('#s-repo').value = settings.repo || '';
  $('#s-branch').value = settings.branch || 'main';
  $('#s-token').value = '';
  $('#token-hint').textContent = settings.hasToken
    ? 'A token is saved on this computer. Leave blank to keep it.'
    : 'Needs Contents: read and write on this repository. Stored encrypted on this computer.';
}
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await window.admin.saveSettings({
    owner: $('#s-owner').value, repo: $('#s-repo').value, branch: $('#s-branch').value, token: $('#s-token').value,
  });
  if (!res.ok) return toast(res.error, { kind: 'error' });
  settings = res.settings;
  fillSettings();
  renderPublish();
  toast('Settings saved.');
});

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.drawer.hidden) { closeDrawer(); return; }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing && els.drawer.hidden) { e.preventDefault(); showView('missions'); els.search.focus(); }
  if (e.key === 'Escape' && document.activeElement === els.search) { clearFilters(); els.search.blur(); }
});

/* ---------- Start ---------- */
(async function start() {
  const init = await window.admin.init();
  settings = init.settings;
  if (init.draft) { data = normalize(init.draft.data); dirty = !!init.draft.dirty; }
  applyCollapsed();
  setSeg($('#theme-seg'), prefs.theme);
  syncThemeBtn();
  fillSettings();
  renderAll();
  if (!init.draft) {
    if (settings.hasToken) pull(false);
    else toast('Open Settings and add your GitHub token to publish data.');
  }
})();
