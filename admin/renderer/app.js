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

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const emptyData = () => ({ version: 1, updatedAt: null, timeLabel: 'Server time', missions: [] });

function normalize(d) {
  const base = emptyData();
  return {
    version: 1,
    updatedAt: d?.updatedAt ?? null,
    timeLabel: typeof d?.timeLabel === 'string' ? d.timeLabel : base.timeLabel,
    missions: Array.isArray(d?.missions) ? d.missions : [],
  };
}

/* ---------- State ---------- */
let data = emptyData();
let dirty = false;
let editingId = null;
let formTimes = [];
let settings = {};

const f = {
  form: $('#form'), name: $('#f-name'), map: $('#f-map'), area: $('#f-area'), location: $('#f-location'),
  type: $('#f-type'), cycle: $('#f-cycle'), time: $('#f-time'),
};
const els = {
  rows: $('#rows'), chips: $('#chips'), timesGroup: $('#times-group'), formError: $('#form-error'),
  formTitle: $('#form-title'), saveBtn: $('#save-btn'), cancelBtn: $('#cancel-btn'),
  dirty: $('#dirty'), msg: $('#msg'), count: $('#count'), timeLabel: $('#time-label'),
  publish: $('#publish-btn'), pull: $('#pull-btn'),
};

function say(text, kind = '') {
  els.msg.hidden = !text;
  els.msg.textContent = text;
  els.msg.dataset.kind = kind;
}

async function persist() { await window.admin.saveDraft({ data, dirty }); }
function updateDirty() {
  els.dirty.dataset.dirty = String(dirty);
  els.dirty.textContent = dirty ? 'Unpublished changes' : 'Everything is published';
}
function touch() { dirty = true; persist(); renderAll(); }

/* ---------- Form ---------- */
function renderChips() {
  els.chips.replaceChildren(...formTimes.map((t) =>
    h('span', { class: 'chip' }, t,
      h('button', {
        type: 'button',
        'aria-label': `Remove ${t}`,
        onclick: () => { formTimes = formTimes.filter((x) => x !== t); renderChips(); },
      }, '×'))));
}

function addTime() {
  const t = f.time.value;
  if (!t) return;
  if (!formTimes.includes(t)) formTimes.push(t);
  formTimes.sort();
  f.time.value = '';
  els.formError.hidden = true;
  renderChips();
  f.time.focus();
}

function syncTypeUI() { els.timesGroup.hidden = f.type.value !== 'Spawn'; }

function resetForm() {
  editingId = null;
  f.form.reset();
  formTimes = [];
  renderChips();
  syncTypeUI();
  els.formError.hidden = true;
  els.formTitle.textContent = 'Add mission';
  els.saveBtn.textContent = 'Add mission';
  els.cancelBtn.hidden = true;
}

function startEdit(m) {
  editingId = m.id;
  f.name.value = m.name; f.map.value = m.map; f.area.value = m.area; f.location.value = m.location;
  f.type.value = m.type; f.cycle.value = m.cycle;
  formTimes = [...(m.spawnTimes || [])];
  renderChips();
  syncTypeUI();
  els.formTitle.textContent = 'Edit mission';
  els.saveBtn.textContent = 'Save changes';
  els.cancelBtn.hidden = false;
  f.name.focus();
  f.name.scrollIntoView({ block: 'center' });
}

f.type.addEventListener('change', syncTypeUI);
$('#add-time').addEventListener('click', addTime);
f.time.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTime(); } });
els.cancelBtn.addEventListener('click', resetForm);

f.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const rec = {
    name: f.name.value.trim(), map: f.map.value.trim(), area: f.area.value.trim(),
    location: f.location.value.trim(), type: f.type.value, cycle: f.cycle.value,
  };
  if (rec.type === 'Spawn' && !formTimes.length) {
    els.formError.textContent = 'Add at least one spawn time, or change the type to Summon.';
    els.formError.hidden = false;
    return;
  }
  rec.spawnTimes = rec.type === 'Spawn' ? [...formTimes] : [];

  if (editingId) {
    const i = data.missions.findIndex((m) => m.id === editingId);
    data.missions[i] = { id: editingId, ...rec };
  } else {
    data.missions.push({ id: newId(), ...rec });
  }
  resetForm();
  touch();
  f.name.focus();
});

/* ---------- List ---------- */
function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= data.missions.length) return;
  [data.missions[i], data.missions[j]] = [data.missions[j], data.missions[i]];
  touch();
}

function renderTable() {
  els.count.textContent = data.missions.length ? `(${data.missions.length})` : '';
  if (!data.missions.length) {
    els.rows.replaceChildren(h('tr', {}, h('td', { colspan: 8, class: 'empty' },
      'No missions yet. Add one above, or select Pull from GitHub to load published data.')));
    return;
  }
  els.rows.replaceChildren(...data.missions.map((m, i) => h('tr', {},
    h('td', {}, m.name), h('td', {}, m.map), h('td', {}, m.area), h('td', {}, m.location),
    h('td', {}, m.type), h('td', {}, m.cycle),
    h('td', {}, m.type === 'Spawn' ? m.spawnTimes.join(', ') : '—'),
    h('td', { class: 'row-actions' },
      h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Move down', disabled: i === data.missions.length - 1, onclick: () => move(i, 1) }, '↓'),
      h('button', { type: 'button', class: 'ghost small', onclick: () => startEdit(m) }, 'Edit'),
      h('button', {
        type: 'button', class: 'ghost small danger',
        onclick: () => {
          if (!confirm(`Delete "${m.name}"?`)) return;
          data.missions = data.missions.filter((x) => x.id !== m.id);
          if (editingId === m.id) resetForm();
          touch();
        },
      }, 'Delete')))));
}

function renderDatalists() {
  const uniq = (key) => [...new Set(data.missions.map((m) => m[key]))].sort();
  $('#maps').replaceChildren(...uniq('map').map((v) => h('option', { value: v })));
  $('#areas').replaceChildren(...uniq('area').map((v) => h('option', { value: v })));
}

function renderAll() {
  renderTable();
  renderDatalists();
  els.timeLabel.value = data.timeLabel;
  updateDirty();
}

els.timeLabel.addEventListener('input', () => {
  data.timeLabel = els.timeLabel.value;
  dirty = true;
  persist();
  updateDirty();
});

/* ---------- GitHub ---------- */
els.publish.addEventListener('click', async () => {
  els.publish.disabled = true;
  say('Publishing…');
  const res = await window.admin.publish(data);
  els.publish.disabled = false;
  if (!res.ok) return say(res.error, 'error');
  data.updatedAt = res.updatedAt;
  dirty = false;
  await persist();
  renderAll();
  say('Published. The public app shows the new data the next time it loads or refreshes.', 'ok');
});

async function pull(askFirst) {
  if (askFirst && dirty && !confirm('You have unpublished changes. Pulling replaces them with the published data. Continue?')) return;
  els.pull.disabled = true;
  say('Pulling from GitHub…');
  const res = await window.admin.pull();
  els.pull.disabled = false;
  if (!res.ok) return say(res.error, 'error');
  if (!res.data) return say('Nothing is published yet. Add missions and publish them.');
  data = normalize(res.data);
  dirty = false;
  resetForm();
  await persist();
  renderAll();
  say('Loaded the published data.', 'ok');
}
els.pull.addEventListener('click', () => pull(true));

/* ---------- Settings ---------- */
const dlg = $('#settings-dialog');
function fillSettings() {
  $('#s-owner').value = settings.owner || '';
  $('#s-repo').value = settings.repo || '';
  $('#s-branch').value = settings.branch || 'main';
  $('#s-token').value = '';
  $('#token-hint').textContent = settings.hasToken
    ? 'A token is saved on this computer. Leave blank to keep it.'
    : 'Needs Contents: read and write on this repository. It is stored encrypted on this computer.';
}
$('#settings-btn').addEventListener('click', () => { fillSettings(); dlg.showModal(); });
$('#s-cancel').addEventListener('click', () => dlg.close());
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await window.admin.saveSettings({
    owner: $('#s-owner').value, repo: $('#s-repo').value,
    branch: $('#s-branch').value, token: $('#s-token').value,
  });
  if (!res.ok) return say(res.error, 'error');
  settings = res.settings;
  dlg.close();
  say('Settings saved.', 'ok');
});

/* ---------- Start ---------- */
(async function start() {
  const init = await window.admin.init();
  settings = init.settings;
  if (init.draft) {
    data = normalize(init.draft.data);
    dirty = !!init.draft.dirty;
  }
  resetForm();
  renderAll();
  if (!init.draft) {
    if (settings.hasToken) pull(false);
    else say('Open Settings and add your GitHub token to publish data.');
  }
})();
