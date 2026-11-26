'use strict';
// Right-click menu of a tab: close, open in the console / file explorer, rename, colour and move to another
// workspace. A tab's own name and colour are remembered per repository (key "tabMeta").

const TAB_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];

function tabMetaAll() {
  try { return JSON.parse(localStorage.getItem('tabMeta')) || {}; } catch { return {}; }
}
const tabMeta = (t) => (t && t.repo && tabMetaAll()[t.repo]) || {};
function setTabMeta(repo, patch) {
  const all = tabMetaAll();
  const m = { ...(all[repo] || {}), ...patch };
  if (!m.name) delete m.name;
  if (!m.color) delete m.color;
  if (Object.keys(m).length) all[repo] = m; else delete all[repo];
  try { localStorage.setItem('tabMeta', JSON.stringify(all)); } catch { /* ignore */ }
  renderTabs();
}
const tabLabel = (t) => (t.mgr ? window.t('Repository Manager') : tabMeta(t).name || t.repo.split(/[\\/]/).pop());

function closeAllTabs(keep) {
  if (state.busy) return;
  if (keep) {
    tabs.splice(0, tabs.length, keep);
    active = -1;
    activate(0);
    return;
  }
  tabs.length = 0;
  active = -1;
  Object.assign(state, freshRepoState());
  $('#app').classList.add('hidden');
  $('#welcome').classList.remove('hidden');
  renderRecent();
  renderTabs();
  persistTabs();
}

function moveTabToWorkspace(i, name) {
  const t = tabs[i];
  if (!t || state.busy) return;
  const d = wsLoad();
  const dest = d.tabs[name] || { repos: [], active: -1 };
  const id = t.mgr ? '@mgr' : t.repo;
  if (!dest.repos.includes(id)) dest.repos.push(id);
  d.tabs[name] = dest;
  wsSave(d);
  closeTab(i);
}

function tabContextMenu(x, y, i) {
  const t = tabs[i];
  if (!t) return;
  closeMenu();
  const meta = tabMeta(t);
  const d = wsLoad();
  const repo = t.repo;
  const baseName = repo ? repo.split(/[\\/]/).pop() : '';
  const items = [
    { label: 'Close All', run: () => closeAllTabs() },
    { label: 'Close All But This', run: () => closeAllTabs(t) },
    ...(t.mgr ? [] : [
      '-',
      { label: 'Open in Console', run: async () => { const err = await window.api.openConsole(repo); if (err) notice('Open in Console', err); } },
      { label: 'Open in File Explorer', run: () => window.api.reveal(repo) },
      '-',
      { label: 'Rename', run: async () => {
        const v = await prompt2('Rename', 'Name', meta.name || baseName);
        if (v !== null) setTabMeta(repo, { name: v.trim() === baseName ? '' : v.trim() });
      } },
    ]),
    '-',
    { label: 'Move to Workspace', sub: true },
  ];
  const el = document.createElement('div');
  el.className = 'mb-drop main tab-ctx';
  const dots = TAB_COLORS.map((c) => `<button class="tc-dot${meta.color === c ? ' on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('');
  el.innerHTML = items.map((it, k) => (it === '-' ? '<hr>' : `<div class="mb-item" data-k="${k}"><span class="mb-label">${esc(it.label)}</span>${it.sub ? '<span class="mb-arrow">›</span>' : ''}</div>`)).join('') +
    (t.mgr ? '' : `<div class="tc-colors">${dots}<button class="tc-dot tc-none" data-color="">⊘</button></div>`);
  document.body.appendChild(el);
  el.style.left = Math.max(4, Math.min(x, innerWidth - el.offsetWidth - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - el.offsetHeight - 4)) + 'px';

  let subEl = null;
  const closeSub = () => { if (subEl) { subEl.remove(); subEl = null; } };
  const dismiss = () => {
    closeSub();
    el.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', dismiss);
  };
  const outside = (e) => { if (!e.target.closest('.tab-ctx, .tab-ctx-sub')) dismiss(); };
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  const openSub = (row) => {
    closeSub();
    subEl = document.createElement('div');
    subEl.className = 'mb-drop tab-ctx-sub';
    subEl.innerHTML = d.names.map((n, k) => `<div class="mb-item" data-w="${k}"><span class="mb-label"><span class="mb-check">${n === d.current ? '✓' : ''}</span><span data-no-i18n>${esc(n)}</span></span></div>`).join('');
    document.body.appendChild(subEl);
    const r = row.getBoundingClientRect();
    subEl.style.left = Math.min(r.right - 2, innerWidth - subEl.offsetWidth - 4) + 'px';
    subEl.style.top = Math.min(r.top - 5, innerHeight - subEl.offsetHeight - 4) + 'px';
    subEl.onclick = (e) => {
      const w = e.target.closest('[data-w]');
      if (!w) return;
      const name = d.names[+w.dataset.w];
      dismiss();
      if (name !== d.current) moveTabToWorkspace(i, name);
    };
  };
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', dismiss);

  el.onmouseover = (e) => {
    const row = e.target.closest('.mb-item');
    if (!row) return;
    if (items[+row.dataset.k].sub) openSub(row); else closeSub();
  };
  el.onclick = (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { dismiss(); return setTabMeta(repo, { color: c.dataset.color }); }
    const row = e.target.closest('.mb-item');
    if (!row) return;
    const it = items[+row.dataset.k];
    if (it.sub) return openSub(row);
    dismiss();
    it.run();
  };
}

const onTabContext = (e) => {
  const r = e.target.closest('.tab, .tl-row');
  if (!r) return;
  e.preventDefault();
  tabContextMenu(e.clientX, e.clientY, +r.dataset.i);
};
$('#tabs').addEventListener('contextmenu', onTabContext);
$('#tablist').addEventListener('contextmenu', onTabContext);
