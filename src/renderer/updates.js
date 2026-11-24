'use strict';
// Automatic updates, window side: a slim bar when a new version exists, the "Updates" section of Preferences and
// the "Check for updates" command. The work itself is done by src/updater.js in the main process.

let updState = { state: 'idle' };
let updDismissed = null; // version the user chose "Later" for

function updateOpts() {
  try { return { auto: JSON.parse(localStorage.getItem('updateOpts')).auto !== false }; } catch { return { auto: true }; }
}

function renderUpdateBar() {
  const bar = $('#update-bar');
  const s = updState;
  const btn = (act, label, primary) => `<button data-upd="${act}" class="${primary ? 'primary' : ''}">${label}</button>`;
  let html = '';
  if (s.state === 'available' && s.version !== updDismissed) {
    html = `<span>KGitty <b>${esc(s.version)}</b> is available.</span>${btn('download', 'Download', true)}${s.notes ? btn('notes', "What's new") : ''}${btn('later', 'Later')}`;
  } else if (s.state === 'downloading') {
    html = `<span>Downloading KGitty ${esc(s.version || '')}… ${s.percent || 0}%</span><span class="upd-prog"><i style="width:${s.percent || 0}%"></i></span>`;
  } else if (s.state === 'ready' && s.version !== updDismissed) {
    html = `<span>KGitty <b>${esc(s.version)}</b> is ready to install.</span>${btn('install', 'Restart and update', true)}${btn('later', 'Later (installs when you quit)')}`;
  }
  bar.innerHTML = html;
  bar.classList.toggle('hidden', !html);
}

window.api.onUpdateStatus((s) => {
  updState = s;
  renderUpdateBar();
  if (s.manual) {
    if (s.state === 'none') setStatus('KGitty is up to date');
    else if (s.state === 'error') setStatus('Update check failed: ' + s.error, true);
    else if (s.state === 'dev') setStatus('Updates only work in the installed app');
    else if (s.state === 'checking') setStatus('Checking for updates…');
  }
  const line = $('#upd-line');
  if (line) line.textContent = updateLine(s);
});

function updateLine(s) {
  switch (s.state) {
    case 'checking': return 'Checking…';
    case 'available': return `Version ${s.version} is available.`;
    case 'none': return 'You have the latest version.';
    case 'downloading': return `Downloading… ${s.percent || 0}%`;
    case 'ready': return `Version ${s.version} is ready — restart to install.`;
    case 'error': return 'Could not check: ' + s.error;
    case 'dev': return 'Updates only work in the installed app.';
    default: return '';
  }
}

$('#update-bar').onclick = (e) => {
  const b = e.target.closest('[data-upd]');
  if (!b) return;
  const a = b.dataset.upd;
  if (a === 'download') window.api.downloadUpdate();
  else if (a === 'install') window.api.installUpdate();
  else if (a === 'later') { updDismissed = updState.version; renderUpdateBar(); }
  else if (a === 'notes') notice(`KGitty ${updState.version}`, updState.notes);
};

const checkForUpdates = () => window.api.checkUpdate();

window.api.setUpdateOpts(updateOpts());
