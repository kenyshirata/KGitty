'use strict';
// Menu bar at the top of the window: File, View, Repository, Window and Help. Each entry runs an existing command;
// the shortcut shown next to it is the one registered in shortcuts.js. Open a menu with a click or Alt+letter,
// move with the arrow keys, run with Enter, close with Esc or a click elsewhere.

const hasRepo = () => !!state.repo;
const flowOn = () => hasRepo() && state.flow && state.flow.init;
const lfsOn = () => hasRepo() && state.lfs && state.lfs.available;

const MENUS = [
  { label: 'File', key: 'f', items: [
    { label: 'New Tab', keys: 'Ctrl+T', run: () => openMgrTab() },
    { label: 'Open Repository…', keys: 'Ctrl+O', run: () => pickAndOpen() },
    { label: 'Clone…', keys: 'Ctrl+Shift+O', run: () => cloneRepo() },
    { label: 'Manage Repositories…', run: () => repoManager() },
    '-',
    { label: 'Close Tab', keys: 'Ctrl+W', when: () => active >= 0, run: () => closeTab(active) },
    '-',
    { label: 'Switch Workspace…', run: () => workspaceMenu() },
    { label: 'Configure Workspaces…', run: () => workspacesDialog() },
    '-',
    { label: 'Preferences…', keys: 'Ctrl+,', run: () => prefsDialog() },
    { label: 'Check for Updates…', run: () => checkForUpdates() },
    '-',
    { label: 'Exit', run: () => window.close() },
  ] },
  { label: 'View', key: 'v', items: [
    { label: 'Show All Commits', keys: 'Ctrl+1', when: hasRepo, run: () => selectLog() },
    { label: 'Show Local Changes', keys: 'Ctrl+2', when: hasRepo, run: () => selectWc() },
    '-',
    { label: 'Filter Commits', keys: 'Ctrl+K', when: hasRepo, run: () => { const s = $('#search'); s.focus(); s.select(); } },
    { label: 'Toggle File Tree / Flat List', keys: 'Ctrl+Shift+E', when: hasRepo, run: () => toggleFileView() },
    { label: 'Toggle Unified / Side-by-side Diff', keys: 'Ctrl+Shift+D', when: hasRepo, run: () => toggleDiffView() },
    '-',
    { label: 'Show Lost Commits (Reflog)', keys: 'Ctrl+Shift+G', when: hasRepo, run: () => showReflog() },
    '-',
    { label: 'Appearance…', keys: 'Ctrl+Alt+A', run: () => appearanceDialog() },
  ] },
  { label: 'Repository', key: 'r', items: [
    { label: 'Refresh', keys: 'F5', when: hasRepo, run: () => refresh() },
    '-',
    { label: 'Fetch…', keys: 'Ctrl+Shift+F', when: hasRepo, run: () => fetchDialog() },
    { label: 'Pull', keys: 'Ctrl+Shift+L', when: hasRepo, run: () => pull() },
    { label: 'Push', keys: 'Ctrl+Shift+P', when: hasRepo, run: () => push() },
    { label: 'Force push (with lease)', keys: 'Ctrl+Shift+Alt+P', when: hasRepo, run: () => forcePush() },
    '-',
    { label: 'Save Stash…', keys: 'Ctrl+Shift+S', when: hasRepo, run: () => stashPush() },
    { label: 'New Branch…', keys: 'Ctrl+B', when: hasRepo, run: () => newBranch() },
    { label: 'Delete branches…', keys: 'Ctrl+Shift+B', when: hasRepo, run: () => deleteBranchesDialog() },
    { label: 'New Worktree…', when: hasRepo, run: () => addWorktreeDialog() },
    '-',
    { label: 'Git Flow', when: hasRepo, sub: [
      { label: 'Initialize Git Flow…', when: () => hasRepo() && state.flow && !state.flow.init, run: () => flowInit() },
      { label: 'Start feature…', when: flowOn, run: () => flowStart('feature') },
      { label: 'Start release…', when: flowOn, run: () => flowStart('release') },
      { label: 'Start hotfix…', when: flowOn, run: () => flowStart('hotfix') },
    ] },
    { label: 'Git LFS', when: hasRepo, sub: [
      { label: 'Track a pattern…', when: lfsOn, run: () => lfsTrack() },
      { label: 'LFS files…', when: lfsOn, run: () => lfsFilesDialog() },
      { label: 'Pull', when: lfsOn, run: () => lfsPull() },
    ] },
    { label: 'Submodules', when: hasRepo, sub: [
      { label: 'Add submodule…', when: hasRepo, run: () => addSubmodule() },
      { label: 'Update all submodules', when: () => hasRepo() && state.submodules.length > 0, run: () => updateAllSubmodules() },
    ] },
    '-',
    { label: 'Undo', keys: 'Ctrl+Z', when: () => hasRepo() && state.undo.length > 0, run: () => undoLast() },
    { label: 'Redo', keys: 'Ctrl+Shift+Z', when: () => hasRepo() && state.redo.length > 0, run: () => redoLast() },
    '-',
    { label: 'Open in Console', when: hasRepo, run: () => openConsole() },
    { label: 'Open in File Explorer', when: hasRepo, run: () => window.api.reveal(state.repo) },
    { label: 'Copy repository path', when: hasRepo, run: () => navigator.clipboard.writeText(state.repo) },
  ] },
  { label: 'Window', key: 'w', items: [
    { label: 'Select Previous Tab', keys: 'Ctrl+Shift+Tab', when: () => tabs.length > 1, run: () => switchTab(-1) },
    { label: 'Select Next Tab', keys: 'Ctrl+Tab', when: () => tabs.length > 1, run: () => switchTab(1) },
    '-',
    { label: 'Switch Theme', keys: 'Ctrl+Alt+T', run: () => cycleTheme() },
    '-',
    { label: 'Zoom In', keys: 'Ctrl+=', run: () => zoomBy(0.1) },
    { label: 'Zoom Out', keys: 'Ctrl+-', run: () => zoomBy(-0.1) },
    { label: 'Reset zoom', keys: 'Ctrl+Alt+0', run: () => setAppearance({ zoom: 1 }) },
  ] },
  { label: 'Help', key: 'h', items: [
    { label: 'Command palette', keys: 'Ctrl+P', run: () => commandPalette() },
    { label: 'Keyboard shortcuts', keys: 'F1', run: () => showShortcuts() },
    '-',
    { label: 'Check for Updates…', run: () => checkForUpdates() },
    { label: 'About KGitty', run: () => aboutDialog() },
  ] },
];

// Only public details: the developer's name as it appears in the public repository and the GitHub profile.
const ABOUT = {
  developer: 'Keny Shirata Jolondek',
  github: 'https://github.com/kenyshirata',
  repo: 'https://github.com/kenyshirata/KGitty',
};

async function aboutDialog() {
  let version = '';
  try { version = await window.api.appVersion(); } catch { /* ignore */ }
  const link = (href, text, raw) => `<a href="${esc(href)}" target="_blank" ${raw ? 'data-no-i18n' : ''}>${esc(text)}</a>`;
  modal({
    title: 'About KGitty',
    body: `<div class="about"><img src="img/icon.png" alt="" onerror="this.remove()"><div class="about-main">
      <div class="about-name"><b>KGitty</b>${version ? ` <span class="dim" data-no-i18n>${esc(version)}</span>` : ''}</div>
      <p class="about-slogan">A fast and easy-to-use Git client</p>
      <dl class="about-info">
        <dt>Developed by</dt><dd><span data-no-i18n>${esc(ABOUT.developer)}</span></dd>
        <dt>GitHub</dt><dd>${link(ABOUT.github, '@kenyshirata', true)}</dd>
        <dt>Source code</dt><dd>${link(ABOUT.repo, 'github.com/kenyshirata/KGitty', true)}</dd>
        <dt>Feedback</dt><dd>${link(ABOUT.repo + '/issues', 'Report a problem or suggest an idea')}</dd>
        <dt>License</dt><dd>MIT</dd>
      </dl></div></div>`,
    buttons: [{ label: 'Close', value: true, primary: true }],
  });
}

let mbOpen = -1; // index of the open menu, -1 = none

function renderMenubar() {
  $('#menubar').innerHTML = MENUS.map((m, i) => `<div class="mb-top${i === mbOpen ? ' open' : ''}" data-m="${i}"><span>${esc(m.label)}</span></div>`).join('');
}

function menuItemsHtml(items, path) {
  return items.map((it, i) => {
    if (it === '-') return '<hr>';
    const off = it.when && !it.when();
    return `<div class="mb-item${off ? ' off' : ''}${it.sub ? ' has-sub' : ''}" data-path="${path}${i}"><span class="mb-label">${esc(it.label)}</span>` +
      (it.sub ? '<span class="mb-arrow">›</span>' : `<span class="mb-keys" data-no-i18n>${esc(it.keys || '')}</span>`) + '</div>';
  }).join('');
}

function itemAt(path) {
  const idx = path.split('.').map(Number);
  let list = MENUS[mbOpen].items, it = null;
  for (const n of idx) { it = list[n]; list = it.sub || []; }
  return it;
}

function closeSubmenus() { document.querySelectorAll('.mb-drop.sub').forEach((d) => d.remove()); }

function openSubmenu(row) {
  closeSubmenus();
  const it = itemAt(row.dataset.path);
  if (!it || !it.sub || row.classList.contains('off')) return;
  const d = document.createElement('div');
  d.className = 'mb-drop sub';
  d.innerHTML = menuItemsHtml(it.sub, row.dataset.path + '.');
  document.body.appendChild(d);
  const r = row.getBoundingClientRect();
  d.style.left = Math.min(r.right - 2, innerWidth - d.offsetWidth - 4) + 'px';
  d.style.top = Math.min(r.top - 5, innerHeight - d.offsetHeight - 4) + 'px';
}

function openMenu(i) {
  closeMenu();
  mbOpen = i;
  renderMenubar();
  const top = document.querySelector(`.mb-top[data-m="${i}"]`);
  const d = document.createElement('div');
  d.className = 'mb-drop main';
  d.innerHTML = menuItemsHtml(MENUS[i].items, '');
  document.body.appendChild(d);
  const r = top.getBoundingClientRect();
  d.style.left = Math.min(r.left, innerWidth - d.offsetWidth - 4) + 'px';
  d.style.top = r.bottom + 'px';
  $('#ctx').classList.add('hidden');
}

function closeMenu() {
  document.querySelectorAll('.mb-drop').forEach((d) => d.remove());
  if (mbOpen >= 0) { mbOpen = -1; renderMenubar(); }
}

function runMenuItem(row) {
  if (!row || row.classList.contains('off')) return;
  const it = itemAt(row.dataset.path);
  if (!it) return;
  if (it.sub) return openSubmenu(row);
  closeMenu();
  it.run();
}

// Keyboard: arrows move within the deepest open menu, Left/Right switch menus or enter / leave a submenu.
function menuKey(e) {
  const drops = [...document.querySelectorAll('.mb-drop')];
  const drop = drops[drops.length - 1];
  const rows = [...drop.querySelectorAll('.mb-item:not(.off)')];
  const cur = drop.querySelector('.mb-item.hot');
  const at = rows.indexOf(cur);
  const hot = (el) => { drop.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot')); if (el) el.classList.add('hot'); };
  if (e.key === 'Escape') { if (drop.classList.contains('sub')) drop.remove(); else closeMenu(); }
  else if (e.key === 'ArrowDown') hot(rows[(at + 1) % rows.length]);
  else if (e.key === 'ArrowUp') hot(rows[(at - 1 + rows.length) % rows.length]);
  else if (e.key === 'ArrowRight' && cur && cur.classList.contains('has-sub')) { openSubmenu(cur); const s = $('.mb-drop.sub .mb-item:not(.off)'); if (s) s.classList.add('hot'); }
  else if (e.key === 'ArrowRight') openMenu((mbOpen + 1) % MENUS.length);
  else if (e.key === 'ArrowLeft' && drop.classList.contains('sub')) drop.remove();
  else if (e.key === 'ArrowLeft') openMenu((mbOpen - 1 + MENUS.length) % MENUS.length);
  else if (e.key === 'Enter' && cur) { if (cur.classList.contains('has-sub')) { openSubmenu(cur); const s = $('.mb-drop.sub .mb-item:not(.off)'); if (s) s.classList.add('hot'); } else runMenuItem(cur); }
  else return;
  e.preventDefault();
  e.stopPropagation();
}

$('#menubar').onmousedown = (e) => {
  const t = e.target.closest('.mb-top');
  if (!t) return;
  e.preventDefault();
  if (mbOpen === +t.dataset.m) closeMenu(); else openMenu(+t.dataset.m);
};
$('#menubar').onmouseover = (e) => {
  const t = e.target.closest('.mb-top');
  if (t && mbOpen >= 0 && mbOpen !== +t.dataset.m) openMenu(+t.dataset.m);
};
document.addEventListener('mouseover', (e) => {
  const row = e.target.closest && e.target.closest('.mb-item');
  if (!row) return;
  row.parentElement.querySelectorAll('.hot').forEach((x) => x.classList.remove('hot'));
  if (!row.classList.contains('off')) row.classList.add('hot');
  if (row.closest('.mb-drop.main')) { if (row.classList.contains('has-sub')) openSubmenu(row); else closeSubmenus(); }
});
document.addEventListener('click', (e) => {
  const row = e.target.closest('.mb-item');
  if (row) runMenuItem(row);
});
document.addEventListener('mousedown', (e) => {
  if (mbOpen >= 0 && !e.target.closest('.mb-drop') && !e.target.closest('#menubar')) closeMenu();
}, true);
document.addEventListener('keydown', (e) => {
  if (mbOpen >= 0) return menuKey(e);
  if (e.altKey && !e.ctrlKey && !e.shiftKey && !overlayOpen()) {
    const i = MENUS.findIndex((m) => m.key === e.key.toLowerCase());
    if (i >= 0) { e.preventDefault(); e.stopPropagation(); openMenu(i); const first = $('.mb-drop.main .mb-item:not(.off)'); if (first) first.classList.add('hot'); }
  }
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

renderMenubar();
