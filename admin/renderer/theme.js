// Runs before the page paints so there is no flash of the wrong theme.
(function () {
  const KEY = document.currentScript.dataset.key;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const pref = () => { try { return JSON.parse(localStorage.getItem(KEY)).theme || 'system'; } catch { return 'system'; } };
  function apply() {
    const t = pref();
    const dark = t === 'dark' || (t === 'system' && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    window.dispatchEvent(new Event('themechange'));
  }
  mq.addEventListener('change', apply);
  window.themeApply = apply;
  apply();
})();
