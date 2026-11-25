'use strict';
// Tab list: the first toolbar button switches the open tabs between the usual bar above the content and a list
// on the left, headed by the current workspace (click it to switch workspace, "+" opens a new tab). The choice is
// remembered.

const TABS_VIEW_KEY = 'tabsView';
const tabsAsList = () => { try { return localStorage.getItem(TABS_VIEW_KEY) === 'list'; } catch { return false; } };

function applyTabsView() {
  const list = tabsAsList();
  $('#app').classList.toggle('tabs-list', list);
  $('#tb-tabsview').classList.toggle('on', list);
  if (list) renderTabList();
}

function toggleTabsView() {
  try { localStorage.setItem(TABS_VIEW_KEY, tabsAsList() ? 'bar' : 'list'); } catch { /* ignore */ }
  applyTabsView();
}

function renderTabList() {
  const el = $('#tablist');
  if (!el || !tabsAsList()) return;
  const ws = wsLoad().current;
  el.innerHTML = `<div class="tl-head"><button class="tl-ws" data-tl="ws" title="Workspaces"><span data-no-i18n>${esc(ws.split('/').pop())}</span><span class="tb-caret">▾</span></button>
      <button class="tl-add" data-tl="add" title="New tab — repository manager">+</button></div>
    <div class="tl-list">${tabs.map((t, i) => {
      const name = t.mgr ? window.t('Repository Manager') : t.repo.split(/[\\/]/).pop();
      const dot = t.dirty && gitOpts().tabDirty ? `<span class="tab-dot" title="${esc(window.t('Uncommitted changes'))}">●</span>` : '';
      return `<div class="tl-row${i === active ? ' active' : ''}${t.mgr ? ' mgr' : ''}" data-i="${i}" draggable="true" title="${esc(t.mgr ? name : t.repo)}">${dot}<span class="tl-name" data-no-i18n>${esc(name)}</span><span class="tl-x" data-close="${i}" title="Close tab">✕</span></div>`;
    }).join('') || '<div class="tl-empty">No open tabs</div>'}</div>`;
}

$('#tablist').onclick = (e) => {
  const b = e.target.closest('[data-tl]');
  if (b && b.dataset.tl === 'add') return openMgrTab();
  if (b && b.dataset.tl === 'ws') return toolbarWorkspaceMenu(b);
  const x = e.target.closest('[data-close]');
  if (x) return closeTab(+x.dataset.close);
  const r = e.target.closest('.tl-row');
  if (r && +r.dataset.i !== active) activate(+r.dataset.i);
};
$('#tablist').onauxclick = (e) => {
  const r = e.target.closest('.tl-row');
  if (e.button === 1 && r) closeTab(+r.dataset.i);
};

// The workspace menu, shown under the list header instead of the toolbar button.
function toolbarWorkspaceMenu(anchor) {
  const real = $('#tb-ws');
  const r = anchor.getBoundingClientRect();
  workspaceMenu();
  const d = document.querySelector('.tb-drop');
  if (d && real) { d.style.left = r.left + 'px'; d.style.top = r.bottom + 2 + 'px'; }
}

/* ---------- reordering tabs by dragging (tab bar and tab list) ---------- */

// Moves the tab at `from` so it ends up before the tab now at `to` (to = tabs.length puts it last). The active
// tab stays active and the new order is saved.
function moveTab(from, to) {
  if (from < 0 || from >= tabs.length || to === from || to === from + 1) return;
  const current = tabs[active];
  const [t] = tabs.splice(from, 1);
  tabs.splice(to > from ? to - 1 : to, 0, t);
  active = tabs.indexOf(current);
  renderTabs();
  persistTabs();
}

let tabDragFrom = -1;
const clearTabDrop = () => document.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));

// `horizontal` is true for the tab bar (before/after by x) and false for the list (by y).
function wireTabDrag(container, selector, horizontal) {
  container.addEventListener('dragstart', (e) => {
    const el = e.target.closest(selector);
    if (!el) return;
    tabDragFrom = +el.dataset.i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tabDragFrom));
    el.classList.add('dragging');
  });
  const where = (e) => {
    const el = e.target.closest(selector);
    if (!el || tabDragFrom < 0) return null;
    const b = el.getBoundingClientRect();
    const after = horizontal ? e.clientX > b.left + b.width / 2 : e.clientY > b.top + b.height / 2;
    return { el, to: +el.dataset.i + (after ? 1 : 0), after };
  };
  container.addEventListener('dragover', (e) => {
    const w = where(e);
    clearTabDrop();
    if (!w) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (w.to !== tabDragFrom && w.to !== tabDragFrom + 1) w.el.classList.add(w.after ? 'drop-after' : 'drop-before');
  });
  container.addEventListener('drop', (e) => {
    const w = where(e);
    const from = tabDragFrom;
    tabDragFrom = -1;
    clearTabDrop();
    if (!w) return;
    e.preventDefault();
    moveTab(from, w.to);
  });
  container.addEventListener('dragend', () => {
    tabDragFrom = -1;
    clearTabDrop();
    container.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
  });
}

wireTabDrag($('#tabs'), '.tab[data-i]', true);
wireTabDrag($('#tablist'), '.tl-row[data-i]', false);

$('#tb-tabsview').onclick = toggleTabsView;
applyTabsView();
