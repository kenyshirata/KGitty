'use strict';
// The sidebar has two panes, chosen with the icons at its top: the branches / remotes / tags tree and "Search
// Commits". The search filters the commit list by message, author, path or diff content, in the whole repository
// or only in the commits reachable from the current branch.

const SEARCH_MODES = [
  ['message', 'Commit Message', 'Commit message'],
  ['author', 'Author', 'Author'],
  ['path', 'Path', 'Path'],
  ['diff', 'Diff Content', 'Diff content'],
];

function searchOpts() {
  try { return { mode: 'message', scope: 'repo', ...JSON.parse(localStorage.getItem('searchOpts') || '{}') }; } catch { return { mode: 'message', scope: 'repo' }; }
}
function setSearchOpts(o) {
  try { localStorage.setItem('searchOpts', JSON.stringify({ ...searchOpts(), ...o })); } catch { /* ignore */ }
  drawSearchPane();
  if (state.filter) renderList();
}

function drawSearchPane() {
  const { mode } = searchOpts();
  const m = SEARCH_MODES.find((x) => x[0] === mode) || SEARCH_MODES[0];
  $('#ss-mode-label').textContent = window.t(m[1]);
  $('#search').placeholder = window.t(m[2]);
}

function showSbTab(name) {
  if (name !== 'refs' && name !== 'search') name = 'refs';
  try { localStorage.setItem('sbTab', name); } catch { /* ignore */ }
  $('#sb-refs').classList.toggle('hidden', name !== 'refs');
  $('#sb-filter').classList.toggle('hidden', name !== 'refs');
  $('#sb-search').classList.toggle('hidden', name !== 'search');
  document.querySelectorAll('#sidebar .sb-tab').forEach((b) => b.classList.toggle('on', b.dataset.sbtab === name));
}

function focusSearch() {
  showSbTab('search');
  const s = $('#search');
  s.focus();
  s.select();
}

/* ---------- matching ---------- */

let searchCache = null;   // { key, set } — commits found by git for the path / diff modes
let searchTimer = null;
let searchBusy = false;
let branchReach = null;   // { key, set } — commits reachable from HEAD, for "Current Branch"

const searchKey = () => [state.repo, state.headHash, state.commits.length, state.filter, searchOpts().mode, searchOpts().scope].join('\u0000');
const reachKey = () => [state.repo, state.headHash, state.commits.length].join('\u0000');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function loadBranchReach() {
  const key = reachKey();
  const r = await window.api.git(state.repo, ['rev-list', 'HEAD']);
  if (reachKey() !== key) return;
  branchReach = { key, set: new Set(r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []) };
  renderList();
}

function runGitSearch() {
  clearTimeout(searchTimer);
  const key = searchKey();
  const { mode, scope } = searchOpts();
  const text = state.filter;
  searchBusy = true;
  searchTimer = setTimeout(async () => {
    const args = ['log', '--format=%H'];
    if (scope === 'repo') args.push('--exclude=refs/stash', '--all'); else args.push('HEAD');
    if (mode === 'diff') args.push('-G', escapeRegex(text), '-i');
    else args.push('--', `:(icase)*${text}*`);
    const r = await window.api.git(state.repo, args);
    if (searchKey() !== key) return;
    searchBusy = false;
    searchCache = { key, set: new Set(r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []) };
    renderList();
  }, 300);
}

// A function that says whether a commit matches the search, or null when nothing is being searched.
function searchPredicate() {
  const f = state.filter;
  if (!f) { searchBusy = false; return null; }
  const { mode, scope } = searchOpts();
  const lf = f.toLowerCase();
  if (mode === 'message' || mode === 'author') {
    searchBusy = false;
    let reach = null;
    if (scope === 'branch') {
      if (!branchReach || branchReach.key !== reachKey()) { searchBusy = true; loadBranchReach(); return () => false; }
      reach = branchReach.set;
    }
    return (c) => (!reach || reach.has(c.hash)) &&
      (mode === 'message' ? `${c.subject} ${c.hash}` : `${c.author} ${c.email || ''}`).toLowerCase().includes(lf);
  }
  if (searchCache && searchCache.key === searchKey()) { searchBusy = false; return (c) => searchCache.set.has(c.hash); }
  runGitSearch();
  return () => false;
}

/* ---------- wiring ---------- */

$('#sidebar').addEventListener('click', (e) => {
  const tab = e.target.closest('.sb-tab');
  if (tab) return showSbTab(tab.dataset.sbtab);
  const btn = e.target.closest('#ss-mode');
  if (!btn) return;
  const { mode, scope } = searchOpts();
  const items = SEARCH_MODES.map(([id, label]) => ({ label, check: id === mode, run: () => setSearchOpts({ mode: id }) }));
  items.push('-', { header: true, label: 'Search' },
    { label: 'Repository', check: scope === 'repo', run: () => setSearchOpts({ scope: 'repo' }) },
    { label: 'Current Branch', check: scope === 'branch', run: () => setSearchOpts({ scope: 'branch' }) });
  toolbarMenu(btn, items);
});

$('#search').oninput = (e) => { state.filter = e.target.value.trim(); renderList(); };
$('#search').onkeydown = (e) => { if (e.key === 'Escape' && state.filter) { e.target.value = ''; state.filter = ''; renderList(); } };

$('#sb-filter-input').oninput = (e) => { sbFilter = e.target.value.trim().toLowerCase(); renderSidebar(); };
$('#sb-filter-input').onkeydown = (e) => { if (e.key === 'Escape' && sbFilter) { e.target.value = ''; sbFilter = ''; renderSidebar(); } };

drawSearchPane();
{
  let tab = 'refs';
  try { tab = localStorage.getItem('sbTab') || 'refs'; } catch { /* ignore */ }
  showSbTab(tab);
}
