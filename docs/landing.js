(function () {
  const REPO = 'fsocietyshinjuu/Mir4-Local';
  const $ = (s) => document.querySelector(s);
  const KEY = 'mir4local.prefs.v1';

  /* language */
  const sel = $('#lang');
  i18n.LANGS.forEach((l) => sel.append(new Option(l.name, l.code)));
  sel.addEventListener('change', () => i18n.setLang(sel.value));
  function renderLangs() {
    const box = $('#langs');
    box.replaceChildren(...i18n.LANGS.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l.name;
      b.setAttribute('aria-pressed', String(l.code === i18n.lang));
      b.addEventListener('click', () => i18n.setLang(l.code));
      return b;
    }));
    sel.value = i18n.lang;
  }

  /* theme */
  const ICONS = {
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    sun: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  };
  function syncTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#theme-icon').setAttribute('d', dark ? ICONS.sun : ICONS.moon);
    $('#theme').title = dark ? 'Light' : 'Dark';
  }
  $('#theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { const v = JSON.parse(localStorage.getItem(KEY)) || {}; v.theme = next; localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
    window.themeApply();
  });
  window.addEventListener('themechange', syncTheme);

  /* downloads: link straight to the installers of the latest release */
  let release = null;
  const ua = navigator.userAgent;
  const os = /Android|iPhone|iPad/i.test(ua) ? 'win' : /Windows/i.test(ua) ? 'win' : /Mac/i.test(ua) ? 'mac' : /Linux|X11/i.test(ua) ? 'linux' : 'win';
  const LABEL = { win: 'lp.dlWin', mac: 'lp.dlMac', linux: 'lp.dlLinux' };
  const PATTERN = { win: /\.exe$/i, mac: /\.dmg$/i, linux: /\.AppImage$/i };
  const fallback = `https://github.com/${REPO}/releases/latest`;
  const assetUrl = (k) => {
    const a = release && release.assets.find((x) => PATTERN[k].test(x.name));
    return a ? a.browser_download_url : fallback;
  };
  function renderDownloads() {
    const cta = $('#cta-dl');
    cta.textContent = i18n.t(LABEL[os]);
    cta.href = assetUrl(os);
    ['win', 'mac', 'linux'].forEach((k) => { $(`#dl-${k}`).href = assetUrl(k); });
    const line = release ? i18n.t('lp.latest', { v: release.tag_name.replace(/^v/, '') }) : '';
    $('#ver-line').textContent = line;
    $('#ver-line-2').textContent = line;
  }

  i18n.onChange(() => { renderLangs(); renderDownloads(); });
  i18n.apply();
  renderLangs();
  renderDownloads();
  syncTheme();
  $('#year').textContent = new Date().getFullYear();

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && Array.isArray(j.assets)) { release = j; renderDownloads(); } })
    .catch(() => {});
})();
