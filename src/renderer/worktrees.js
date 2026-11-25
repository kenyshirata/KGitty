'use strict';
// Git worktrees: list them in the sidebar, add / remove / lock / prune, and open one in its own tab.

const samePath = (a, b) => !!a && !!b && a.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === b.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();

async function loadWorktrees() {
  const r = await window.api.git(state.repo, ['worktree', 'list', '--porcelain']);
  const list = [];
  for (const block of r.stdout.split(/\n\s*\n/)) {
    const wt = {};
    for (const line of block.split('\n').filter(Boolean)) {
      const sp = line.indexOf(' ');
      const k = sp < 0 ? line : line.slice(0, sp), v = sp < 0 ? '' : line.slice(sp + 1);
      if (k === 'worktree') wt.path = v;
      else if (k === 'HEAD') wt.head = v;
      else if (k === 'branch') wt.branch = v.replace(/^refs\/heads\//, '');
      else if (k === 'detached') wt.detached = true;
      else if (k === 'bare') wt.bare = true;
      else if (k === 'locked') wt.locked = v || true;
      else if (k === 'prunable') wt.prunable = v || true;
    }
    if (wt.path) list.push(wt);
  }
  list.forEach((w, i) => { w.main = i === 0; w.current = samePath(w.path, state.repo); });
  state.worktrees = list;
}

function worktreeSection() {
  if (state.worktrees.length < 2) {
    return `<div class="sb-head">Worktrees<span class="sb-tools"><button class="sb-tool" data-act="add-worktree" title="Add worktree">＋</button></span></div>`;
  }
  const pruneable = state.worktrees.some((w) => w.prunable);
  const items = state.worktrees.map((w) => {
    const name = w.path.split('/').pop();
    const where = w.bare ? 'bare' : w.detached ? `detached ${w.head.slice(0, 7)}` : w.branch || '';
    const flags = (w.locked ? ' 🔒' : '') + (w.prunable ? ' ⚠ missing' : '');
    return `<div class="sb-item ${w.current ? 'current' : ''}" data-kind="worktree" data-name="${esc(w.path)}" title="${esc(w.path)}">${w.main ? '◆ ' : ''}${esc(name)}<span class="ab">${esc(where + flags)}</span></div>`;
  });
  return `<div class="sb-head">Worktrees<span class="sb-tools">${pruneable ? '<button class="sb-tool" data-act="prune-worktrees" title="Prune missing worktrees">🧹</button>' : ''}<button class="sb-tool" data-act="add-worktree" title="Add worktree">＋</button></span></div>${items.join('')}`;
}

function worktreeMenu(e, path) {
  e.preventDefault();
  const w = state.worktrees.find((x) => x.path === path);
  if (!w) return;
  ctxMenu(e.clientX, e.clientY, [
    !w.current && !w.prunable && { label: 'Open in new tab', action: () => openRepo(w.path) },
    !w.prunable && { label: 'Reveal in Explorer', action: () => window.api.reveal(w.path) },
    { label: 'Copy path', action: () => navigator.clipboard.writeText(w.path) },
    !w.main && '-',
    !w.main && (w.locked
      ? { label: 'Unlock', action: () => run('Unlock worktree', () => git(['worktree', 'unlock', '--', w.path])) }
      : { label: 'Lock', action: async () => { const why = await prompt2('Lock worktree', 'Reason (optional)', ''); run('Lock worktree', () => git(['worktree', 'lock', ...(why ? ['--reason', why] : []), '--', w.path])); } }),
    !w.main && !w.current && { label: 'Remove worktree…', action: () => removeWorktree(w) },
  ].filter(Boolean));
}

async function removeWorktree(w) {
  if (!(await confirm2('Remove worktree', `Remove the worktree at ${w.path}? Its folder is deleted; the branch is kept.`, true))) return;
  await run('Remove worktree', async () => {
    try {
      await git(['worktree', 'remove', '--', w.path]);
    } catch (e) {
      if (!/modified or untracked|--force/.test(e.message)) throw e;
      const force = await confirm2('Worktree has changes', 'It contains modified or untracked files that would be lost. Remove it anyway?', true);
      if (!force) return;
      await git(['worktree', 'remove', '--force', '--', w.path]);
    }
  });
}

const sanitizeBranch = (b) => b.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');

function addWorktreeDialog(preselect = null) {
  if (state.busy) return;
  const taken = new Set(state.worktrees.filter((w) => w.branch).map((w) => w.branch));
  const free = state.branches.map((b) => b.name).filter((n) => !taken.has(n));
  const ov = $('#overlay');
  const repoName = state.repo.split('/').pop();
  const parent = state.repo.split('/').slice(0, -1).join('/');
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.onkeydown = ov.onchange = ov.oninput = null; };
  const startMode = preselect && free.includes(preselect) ? 'existing' : free.length ? 'existing' : 'new';

  ov.innerHTML = `<div class="modal wide"><h3>Add worktree</h3>
    <div class="wt-modes">
      <label><input type="radio" name="wt-mode" value="existing" ${startMode === 'existing' ? 'checked' : ''} ${free.length ? '' : 'disabled'}> Existing branch</label>
      <label><input type="radio" name="wt-mode" value="new" ${startMode === 'new' ? 'checked' : ''}> New branch</label>
      <label><input type="radio" name="wt-mode" value="detach"> Detached at…</label>
    </div>
    <div class="field" id="wt-f-existing"><label>Branch (branches already checked out elsewhere are not listed)</label>
      <select id="wt-branch">${free.map((n) => `<option ${n === preselect ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="field" id="wt-f-new"><label>New branch name</label><input type="text" id="wt-newname"></div>
    <div class="field" id="wt-f-start"><label id="wt-start-label">Start point</label><input type="text" id="wt-start" value="${esc(state.head || 'HEAD')}" placeholder="branch, tag or commit"></div>
    <div class="field"><label>Folder</label><div class="row"><input type="text" id="wt-path"><button id="wt-browse">Browse…</button></div></div>
    <label class="cl-opt"><input type="checkbox" id="wt-open" checked> Open in a new tab</label>
    <div class="rb-foot"><span class="rb-err" id="wt-err"></span><span class="btns"><button id="wt-cancel">Cancel</button><button class="primary" id="wt-go">Add worktree</button></span></div></div>`;
  ov.classList.remove('hidden');

  const mode = () => ov.querySelector('[name=wt-mode]:checked').value;
  let pathEdited = false;
  const label = () => (mode() === 'existing' ? $('#wt-branch').value : mode() === 'new' ? $('#wt-newname').value.trim() : 'detached');
  const syncPath = () => { if (!pathEdited) $('#wt-path').value = `${parent}/${repoName}-${sanitizeBranch(label() || 'worktree')}`; };
  const sync = () => {
    const m = mode();
    $('#wt-f-existing').classList.toggle('hidden', m !== 'existing');
    $('#wt-f-new').classList.toggle('hidden', m !== 'new');
    $('#wt-f-start').classList.toggle('hidden', m === 'existing');
    $('#wt-start-label').textContent = m === 'new' ? 'Start point' : 'Commit, tag or branch';
    syncPath();
  };
  ov.onchange = (e) => { if (e.target.name === 'wt-mode' || e.target.id === 'wt-branch') sync(); };
  ov.oninput = (e) => {
    if (e.target.id === 'wt-path') pathEdited = true;
    if (e.target.id === 'wt-newname') syncPath();
  };
  const go = async () => {
    const m = mode(), path = $('#wt-path').value.trim().replace(/\\/g, '/');
    const start = $('#wt-start').value.trim();
    const name = $('#wt-newname').value.trim();
    const err = (t) => { $('#wt-err').textContent = t; };
    if (!path) return err('Choose a folder for the worktree.');
    if (m === 'new' && !name) return err('Enter a name for the new branch.');
    if ((m === 'new' || m === 'detach') && !start) return err('Enter a start point.');
    const args = m === 'existing' ? ['worktree', 'add', '--', path, $('#wt-branch').value]
      : m === 'new' ? ['worktree', 'add', '-b', name, '--', path, start]
        : ['worktree', 'add', '--detach', '--', path, start];
    const open = $('#wt-open').checked;
    close();
    const ok = await run('Add worktree', () => git(args));
    if (ok !== false && open) await openRepo(path);
  };
  ov.onclick = async (e) => {
    if (e.target.closest('#wt-cancel')) return close();
    if (e.target.closest('#wt-browse')) { const d = await window.api.pickFolder(); if (d) { pathEdited = true; $('#wt-path').value = d.replace(/\\/g, '/'); } return; }
    if (e.target.closest('#wt-go')) return go();
  };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') go(); };
  sync();
  (mode() === 'new' ? $('#wt-newname') : $('#wt-path')).focus();
}

const pruneWorktrees = () => run('Prune worktrees', () => git(['worktree', 'prune']));
