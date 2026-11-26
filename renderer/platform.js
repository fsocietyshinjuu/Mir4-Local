/* Runs the same app in a normal browser. Inside the desktop app, preload.js already provides window.desktop, so this does nothing. */
(function () {
  if (window.desktop) return;
  const OWNER = 'fsocietyshinjuu', REPO = 'Mir4-Local', BRANCH = 'main';
  const URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/data/missions.json`;
  const CACHE = 'mir4local.web.cache.v1';
  const ETAG = 'mir4local.web.etag.v1';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; }
  }

  async function loadMissions(opts = {}) {
    const force = !!opts.force;
    const cached = readCache();
    const etag = force ? '' : (localStorage.getItem(ETAG) || '');
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const headers = etag ? { 'If-None-Match': etag } : {};
        const res = await fetch(`${URL}?t=${Date.now()}`, { headers, cache: 'no-store' });
        if (res.status === 304 && cached) return { ok: true, source: 'online', unchanged: true, data: cached };
        if (res.status === 404) return { ok: true, source: 'empty', data: { missions: [] } };
        if (!res.ok) throw new Error(`Server replied ${res.status}`);
        const data = await res.json();
        try {
          localStorage.setItem(CACHE, JSON.stringify(data));
          const e = res.headers.get('etag');
          if (e) localStorage.setItem(ETAG, e);
        } catch {}
        return { ok: true, source: 'online', data };
      } catch (err) {
        lastErr = err;
        if (attempt < 2) await wait(300 * (attempt + 1));
      }
    }
    if (cached) return { ok: true, source: 'cache', data: cached, error: lastErr && lastErr.message };
    return { ok: false, error: (lastErr && lastErr.message) || 'Could not load mission data' };
  }

  async function requestNotify() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission === 'granted';
  }

  window.desktop = {
    isWeb: true,
    getVersion: async () => 'web',
    checkForUpdates: async () => {},
    installUpdate: async () => {},
    onUpdateStatus: () => {},
    loadMissions,
    requestNotify,
    notifyStatus: () => ('Notification' in window ? Notification.permission : 'unsupported'),
    setLabels: async () => true,
    getCloseBehavior: async () => 'ask',
    setCloseBehavior: async () => true,
    notify: async (n) => {
      if (!(await requestNotify())) return { ok: false };
      try { new Notification(n.title, { body: n.body, icon: 'assets/icon.png', silent: true }); return { ok: true }; }
      catch { return { ok: false }; }
    },
  };
})();
