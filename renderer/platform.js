/* Runs the same app in a normal browser. Inside the desktop app, preload.js already provides window.desktop, so this does nothing. */
(function () {
  if (window.desktop) return;
  const OWNER = 'fsocietyshinjuu', REPO = 'Mir4-Local', BRANCH = 'main';
  const URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/data/missions.json`;
  const CACHE = 'mir4local.web.cache.v1';

  async function loadMissions() {
    try {
      const res = await fetch(`${URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) return { ok: true, source: 'empty', data: { missions: [] } };
      if (!res.ok) throw new Error(`Server replied ${res.status}`);
      const data = await res.json();
      try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch {}
      return { ok: true, source: 'online', data };
    } catch (err) {
      try { return { ok: true, source: 'cache', data: JSON.parse(localStorage.getItem(CACHE)), error: err.message }; }
      catch { return { ok: false, error: err.message }; }
    }
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
    notify: async (n) => {
      if (!(await requestNotify())) return { ok: false };
      new Notification(n.title, { body: n.body, icon: 'assets/icon.png', silent: true });
      return { ok: true };
    },
  };
})();
