'use strict';
// Global keyboard shortcuts. Each entry is { keys, label, group, run, repo?, free? }:
// `repo` = needs an open repository, `free` = also works without a modifier key (ignored while typing).

const overlayOpen = () => !$('#overlay').classList.contains('hidden') || !$('#overlay2').classList.contains('hidden');
const typingTarget = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function moveSelection(delta) {
  const rows = [...document.querySelectorAll('#commit-list .crow')];
  if (!rows.length) return;
  const cur = rows.findIndex((r) => r.classList.contains('sel'));
  const next = rows[Math.min(rows.length - 1, Math.max(0, (cur < 0 ? 0 : cur + delta)))];
  if (next.dataset.wc) selectWc(); else selectCommit(next.dataset.hash);
  const sel = document.querySelector('#commit-list .crow.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function toggleDiffView() {
  diffView = diffView === 'split' ? 'unified' : 'split';
  try { localStorage.setItem('diffView', diffView); } catch { /* ignore */ }
  if (state.file) showFileDiff();
}

const switchTab = (delta) => { if (tabs.length > 1) activate((active + delta + tabs.length) % tabs.length); };

const SHORTCUTS = [
  { group: 'Repository', keys: 'Ctrl+O', label: 'Open repository', run: () => pickAndOpen() },
  { group: 'Repository', keys: 'Ctrl+Shift+M', label: 'Repository manager', run: () => repoManager() },
  { group: 'Repository', keys: 'Ctrl+Shift+O', label: 'Clone repository', run: () => cloneRepo() },
  { group: 'Repository', keys: 'Ctrl+R', label: 'Refresh', repo: true, run: () => refresh() },
  { group: 'Repository', keys: 'F5', label: 'Refresh', repo: true, hidden: true, run: () => refresh() },
  { group: 'Repository', keys: 'Ctrl+Shift+F', label: 'Fetch', repo: true, run: () => fetchAll() },
  { group: 'Repository', keys: 'Ctrl+Shift+L', label: 'Pull', repo: true, run: () => pull() },
  { group: 'Repository', keys: 'Ctrl+Shift+P', label: 'Push', repo: true, run: () => push() },
  { group: 'Repository', keys: 'Ctrl+Shift+Alt+P', label: 'Force push (with lease)', repo: true, run: () => forcePush() },
  { group: 'Repository', keys: 'Ctrl+B', label: 'New branch', repo: true, run: () => newBranch() },
  { group: 'Repository', keys: 'Ctrl+Shift+B', label: 'Delete branches…', repo: true, run: () => deleteBranchesDialog() },
  { group: 'Repository', keys: 'Ctrl+Shift+S', label: 'Stash changes', repo: true, run: () => stashPush() },
  { group: 'Repository', keys: 'Ctrl+Z', label: 'Undo last destructive operation', repo: true, notTyping: true, run: () => undoLast() },
  { group: 'Repository', keys: 'Ctrl+Shift+Z', alt: 'Ctrl+Y', label: 'Redo', repo: true, notTyping: true, run: () => redoLast() },
  { group: 'Repository', keys: 'Ctrl+Shift+G', label: 'Reflog', repo: true, run: () => showReflog() },

  { group: 'Tabs', keys: 'Ctrl+T', label: 'Open repository in a new tab', run: () => pickAndOpen() },
  { group: 'Tabs', keys: 'Ctrl+W', label: 'Close tab', repo: true, run: () => closeTab(active) },
  { group: 'Tabs', keys: 'Ctrl+Tab', label: 'Next tab', repo: true, run: () => switchTab(1) },
  { group: 'Tabs', keys: 'Ctrl+Shift+Tab', label: 'Previous tab', repo: true, run: () => switchTab(-1) },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ group: 'Tabs', keys: 'Alt+' + n, label: n === 1 ? 'Go to tab 1–9' : 'Go to tab ' + n, show: n === 1 ? 'Alt+1–9' : undefined, hidden: n > 1, run: () => { if (tabs[n - 1] && active !== n - 1) activate(n - 1); } })),

  { group: 'Commits & changes', keys: 'Ctrl+K', label: 'Filter commits', repo: true, run: () => { const s = $('#search'); s.focus(); s.select(); } },
  { group: 'Commits & changes', keys: 'Ctrl+F', label: 'Filter commits', repo: true, hidden: true, run: () => { const s = $('#search'); s.focus(); s.select(); } },
  { group: 'Commits & changes', keys: 'ArrowDown', alt: 'J', label: 'Next commit', repo: true, free: true, run: () => moveSelection(1) },
  { group: 'Commits & changes', keys: 'ArrowUp', alt: 'K', label: 'Previous commit', repo: true, free: true, run: () => moveSelection(-1) },
  { group: 'Commits & changes', keys: 'Ctrl+1', alt: 'Ctrl+L', label: 'Show All Commits', repo: true, run: () => selectLog() },
  { group: 'Commits & changes', keys: 'Ctrl+2', alt: 'Ctrl+0', label: 'Show Local Changes', repo: true, run: () => selectWc() },
  { group: 'Commits & changes', keys: 'Ctrl+M', label: 'Write commit message', repo: true, run: () => { selectWc(); const m = $('#msg'); if (m) m.focus(); } },
  { group: 'Commits & changes', keys: 'Ctrl+Enter', label: 'Commit (in the message box)', repo: true, run: () => { if ($('#msg') && [$('#msg'), $('#desc')].includes(document.activeElement)) doCommit(); } },
  { group: 'Commits & changes', keys: 'Ctrl+Shift+A', label: 'Stage all', repo: true, run: () => { const p = state.status.filter((f) => f.unstaged).map((f) => f.path); if (p.length) stage(p); } },
  { group: 'Commits & changes', keys: 'Ctrl+Shift+U', label: 'Unstage all', repo: true, run: () => { const p = state.status.filter((f) => f.staged).map((f) => f.path); if (p.length) unstage(p); } },
  { group: 'Commits & changes', keys: 'Ctrl+Shift+E', label: 'Toggle file tree / flat list', repo: true, run: () => toggleFileView() },
  { group: 'Commits & changes', keys: 'Ctrl+Shift+D', label: 'Toggle unified / side-by-side diff', repo: true, run: () => toggleDiffView() },

  { group: 'Help', keys: 'Ctrl+P', label: 'Command palette', run: () => commandPalette() },
  { group: 'Help', keys: 'Ctrl+,', label: 'Preferences', run: () => prefsDialog() },
  { group: 'Help', keys: 'Ctrl+Alt+A', label: 'Appearance settings', run: () => appearanceDialog() },
  { group: 'Help', keys: 'Ctrl+=', label: 'Zoom in', run: () => zoomBy(0.1) },
  { group: 'Help', keys: 'Ctrl++', label: 'Zoom in', hidden: true, run: () => zoomBy(0.1) },
  { group: 'Help', keys: 'Ctrl+-', label: 'Zoom out', run: () => zoomBy(-0.1) },
  { group: 'Help', keys: 'Ctrl+Alt+0', label: 'Reset zoom', run: () => { setAppearance({ zoom: 1 }); if (state.repo) setStatus('Zoom 100%'); } },
  { group: 'Help', keys: 'Ctrl+Alt+T', label: 'Switch theme (system / light / dark)', run: () => cycleTheme() },
  { group: 'Help', keys: 'F1', alt: '?', label: 'Keyboard shortcuts', free: true, run: () => showShortcuts() },
  { group: 'Help', keys: 'Esc', label: 'Close dialog or menu', hidden: true, run: () => {} },
];

function eventCombo(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  const name = k.length === 1 ? k.toUpperCase() : k;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey && (k.length > 1 || /[a-z0-9]/i.test(k))) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(name);
  return parts.join('+');
}

const COMBO_MAP = new Map();
for (const s of SHORTCUTS) {
  COMBO_MAP.set(s.keys, s);
  if (s.alt) COMBO_MAP.set(s.alt, s);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#ctx').classList.add('hidden'); return; }
  const combo = eventCombo(e);
  const s = combo && COMBO_MAP.get(combo);
  if (!s) return;
  const modified = combo.includes('Ctrl') || combo.includes('Alt') || /^F\d+$/.test(combo);
  if (!modified && (typingTarget(e.target) || overlayOpen())) return;
  if (overlayOpen() && s.keys !== 'F1') return;
  if (s.repo && !state.repo) return;
  if (s.notTyping && typingTarget(e.target)) return;
  e.preventDefault();
  s.run();
}, true);

function showShortcuts() {
  const ov = $('#overlay');
  const groups = {};
  SHORTCUTS.filter((s) => !s.hidden).forEach((s) => (groups[s.group] = groups[s.group] || []).push(s));
  const pretty = (k) => k.split('+').map((p) => `<kbd>${esc(p === 'ArrowDown' ? '↓' : p === 'ArrowUp' ? '↑' : p)}</kbd>`).join('');
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.onkeydown = null; };
  ov.innerHTML = `<div class="modal wide"><h3>Keyboard shortcuts</h3><div class="ks-grid">${Object.entries(groups).map(([g, list]) =>
    `<div class="ks-group"><div class="sb-head">${esc(g)}</div>${list.map((s) => `<div class="ks-row"><span>${esc(s.label)}</span><span>${pretty(s.show || s.keys)}${s.alt ? ` <small>or</small> ${pretty(s.alt)}` : ''}</span></div>`).join('')}</div>`).join('')}</div>
    <div class="btns"><button class="primary" id="ks-close">Close</button></div></div>`;
  ov.classList.remove('hidden');
  $('#ks-close').focus();
  ov.onclick = (e) => { if (e.target === ov || e.target.closest('#ks-close')) close(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape' || e.key === 'F1') { e.preventDefault(); close(); } };
}

$('#tb-keys').onclick = showShortcuts;
