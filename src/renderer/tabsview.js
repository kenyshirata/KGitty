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
      return `<div class="tl-row${i === active ? ' active' : ''}${t.mgr ? ' mgr' : ''}" data-i="${i}" title="${esc(t.mgr ? name : t.repo)}">${dot}<span class="tl-name" data-no-i18n>${esc(name)}</span><span class="tl-x" data-close="${i}" title="Close tab">✕</span></div>`;
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

$('#tb-tabsview').onclick = toggleTabsView;
applyTabsView();
