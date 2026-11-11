const banner = document.getElementById('update-banner');
const message = document.getElementById('update-message');
const progress = document.getElementById('update-progress');
const installBtn = document.getElementById('install-btn');
const checkBtn = document.getElementById('check-btn');

window.desktop.getVersion().then((v) => {
  document.getElementById('version').textContent = `v${v}`;
});

window.desktop.onUpdateStatus((s) => {
  banner.hidden = s.state === 'dev';
  banner.dataset.state = s.state;
  message.textContent = s.message;
  progress.hidden = s.state !== 'downloading';
  if (s.state === 'downloading') progress.value = s.percent || 0;
  installBtn.hidden = s.state !== 'ready';
});

installBtn.addEventListener('click', () => window.desktop.installUpdate());
checkBtn.addEventListener('click', () => window.desktop.checkForUpdates());
