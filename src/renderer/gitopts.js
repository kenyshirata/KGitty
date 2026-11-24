'use strict';
// Git behaviour options from Preferences › General: automatic fetch, tags in fetch, the uncommitted-changes dot on
// tabs, submodule update after checkout, the character that replaces spaces in new branch names, push after
// commit and compact branch labels in the commit list.

const GIT_OPTS_DEFAULT = {
  autoFetch: true,
  fetchTags: false,
  tabDirty: true,
  submodulesOnCheckout: true,
  branchSpace: '-',
  pushOnCommit: false,
  compactLabels: true,
};
const AUTO_FETCH_MS = 10 * 60 * 1000;

function gitOpts() {
  try { return { ...GIT_OPTS_DEFAULT, ...JSON.parse(localStorage.getItem('gitOpts') || '{}') }; } catch { return { ...GIT_OPTS_DEFAULT }; }
}
function setGitOpts(o) {
  try { localStorage.setItem('gitOpts', JSON.stringify({ ...gitOpts(), ...o })); } catch { /* ignore */ }
  renderTabs();
  if (state.repo) renderList();
  probeTabs();
}

const fetchArgs = () => ['fetch', '--all', '--prune', ...(gitOpts().fetchTags ? ['--tags'] : [])];

// Spaces typed in a new branch name become the chosen character ("my feature" → "my-feature").
const branchNameFrom = (s) => s.trim().replace(/\s+/g, gitOpts().branchSpace);

// Runs after a checkout inside the same operation: brings submodules to the commits the new HEAD expects.
async function afterCheckout() {
  if (!gitOpts().submodulesOnCheckout) return;
  const has = await window.api.git(state.repo, ['ls-files', '--error-unmatch', '.gitmodules']);
  if (has.code === 0) await git(['submodule', 'update', '--init', '--recursive']);
}

/* ---------- automatic fetch ---------- */

const lastFetch = new Map(); // repo -> time of the last fetch (manual or automatic)

async function autoFetchTick() {
  if (!gitOpts().autoFetch || !state.repo || state.busy || document.hidden) return;
  const repo = state.repo;
  if (Date.now() - (lastFetch.get(repo) || 0) < AUTO_FETCH_MS) return;
  lastFetch.set(repo, Date.now());
  const r = await window.api.gitQuiet(repo, fetchArgs());
  if (r.code !== 0) return; // offline or needs a sign-in: try again at the next interval, silently
  if (state.repo === repo && !state.busy) refresh();
}
setInterval(autoFetchTick, 60 * 1000);
setTimeout(autoFetchTick, 15 * 1000);

/* ---------- uncommitted-changes dot on tabs ---------- */

// The active tab knows its status; the other tabs are checked in the background.
async function probeTabs() {
  if (!gitOpts().tabDirty) return;
  let changed = false;
  for (const t of tabs) {
    if (!t.repo || t === tabs[active]) continue;
    const r = await window.api.gitQuiet(t.repo, ['status', '--porcelain', '--untracked-files=normal']);
    const dirty = r.code === 0 && r.stdout.trim().length > 0;
    if (t.dirty !== dirty) { t.dirty = dirty; changed = true; }
  }
  if (changed) renderTabs();
}
setInterval(probeTabs, 30 * 1000);
window.addEventListener('focus', () => setTimeout(probeTabs, 500));
setTimeout(probeTabs, 3000);

// Called after each refresh of the active repository.
function markActiveTabDirty() {
  const t = tabs[active];
  if (!t || !t.repo) return;
  const dirty = state.status.length > 0;
  if (t.dirty !== dirty) { t.dirty = dirty; renderTabs(); }
}
