const q = new URLSearchParams(location.search);
const ms = Math.max(2000, Number(q.get('ms')) || 9000);
document.body.dataset.kind = q.get('kind') || 'info';
document.getElementById('title').textContent = q.get('title') || '';
document.getElementById('body').textContent = q.get('body') || '';
document.getElementById('bar').style.animationDuration = `${ms}ms`;

const card = document.getElementById('card');
card.addEventListener('click', (e) => {
  if (e.target.closest('#x')) window.toast.close(); else window.toast.click();
});
setTimeout(() => card.classList.add('out'), ms - 250);
setTimeout(() => window.toast.close(), ms);
