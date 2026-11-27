'use strict';
// Stash: a dialog to stash all or selected changes, and a detail view to inspect, apply, pop, drop or branch from a stash.

const stashPush = () => stashDialog();

function stashDialog() {
  if (state.busy) return;
  const files = state.status.filter((f) => !f.conflict);
  if (!files.length) return notice('Stash', 'There are no local changes to stash.');
  if (state.status.some((f) => f.conflict)) return notice('Stash', 'Resolve the conflicts before stashing.');
  const ov = $('#overlay');
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.onkeydown = ov.onchange = null; };
  ov.innerHTML = `<div class="modal wide"><h3>Stash changes</h3>
    <div class="field"><label>Message (optional)</label><input type="text" id="st-msg" placeholder="WIP on ${esc(state.head || 'HEAD')}"></div>
    <div class="st-opts">
      <label><input type="checkbox" id="st-untracked" checked> Include untracked files</label>
      <label><input type="checkbox" id="st-keep"> Keep staged changes in the working copy</label>
      <label><input type="checkbox" id="st-staged"> Only stash staged changes</label>
    </div>
    <div class="fhead"><span>Files (<span id="st-count">${files.length}</span>/${files.length})</span><span><button id="st-all">All</button> <button id="st-none">None</button></span></div>
    <div class="rb-list st-files">${files.map((f, i) => `<label class="bd-row"><input type="checkbox" data-f="${i}" checked><span class="st ${f.untracked ? 'U' : STATUS_LABEL[f.staged ? f.x : f.y] || 'M'}">${f.untracked ? 'U' : STATUS_LABEL[f.staged ? f.x : f.y] || 'M'}</span><span class="bd-name">${esc(f.path)}</span>${f.staged && f.unstaged ? '<span class="badge remote">partly staged</span>' : f.staged ? '<span class="badge local">staged</span>' : ''}</label>`).join('')}</div>
    <div class="rb-foot"><span class="rb-err" id="st-err"></span><span class="btns"><button id="st-cancel">Cancel</button><button class="primary" id="st-go">Stash</button></span></div></div>`;
  ov.classList.remove('hidden');
  $('#st-msg').focus();

  const boxes = () => [...ov.querySelectorAll('[data-f]')];
  const sync = () => {
    const only = $('#st-staged').checked;
    const n = boxes().filter((b) => b.checked).length;
    $('#st-count').textContent = only ? files.filter((f) => f.staged).length : n;
    boxes().forEach((b) => (b.disabled = only));
    $('#st-untracked').disabled = only;
    $('#st-go').disabled = only ? !files.some((f) => f.staged) : !n;
    $('#st-err').textContent = only && !files.some((f) => f.staged) ? 'Nothing is staged.' : '';
  };
  const go = () => {
    const only = $('#st-staged').checked;
    const chosen = files.filter((_, i) => boxes()[i].checked);
    const msg = $('#st-msg').value.trim();
    const args = ['stash', 'push'];
    if (only) args.push('--staged');
    else if ($('#st-untracked').checked) args.push('--include-untracked');
    if ($('#st-keep').checked && !only) args.push('--keep-index');
    if (msg) args.push('-m', msg);
    if (!only && chosen.length !== files.length) args.push('--', ...chosen.map((f) => f.path));
    close();
    run('Stash', () => git(args));
  };
  ov.onchange = sync;
  ov.onclick = (e) => {
    if (e.target.closest('#st-cancel')) return close();
    if (e.target.closest('#st-go')) return go();
    if (e.target.closest('#st-all') || e.target.closest('#st-none')) {
      const on = !!e.target.closest('#st-all');
      boxes().forEach((b) => (b.checked = on));
      sync();
    }
  };
  ov.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.id === 'st-msg' && !$('#st-go').disabled) go();
  };
  sync();
}

/* ---------- stash detail ---------- */

function selectStash(ref) {
  state.draft = readDraft();
  state.sel = { type: 'stash', ref };
  state.file = null;
  renderSidebar(); renderList(); renderDetail();
}

async function stashFiles(ref) {
  const tracked = await window.api.git(state.repo, ['diff', '--name-status', '-M', '-z', `${ref}^1`, ref]);
  const out = tracked.stdout.split('\0').filter((x) => x !== '');
  const files = [];
  for (let i = 0; i < out.length;) {
    const st = out[i++];
    if (st[0] === 'R' || st[0] === 'C') i++;
    files.push({ code: st[0], path: out[i++], untracked: false });
  }
  const u = await window.api.git(state.repo, ['ls-tree', '-r', '--name-only', '-z', `${ref}^3`]);
  if (u.code === 0) u.stdout.split('\0').filter(Boolean).forEach((p) => files.push({ code: 'U', path: p, untracked: true }));
  return files;
}

async function renderStashDetail() {
  const { ref } = state.sel;
  const left = $('#detail-left');
  const entry = state.stashes.find((s) => s.ref === ref);
  if (!entry) return selectWc();
  const [info, files] = await Promise.all([
    window.api.git(state.repo, ['log', '-1', '--format=%H%n%an%n%aI%n%s', ref]),
    stashFiles(ref).catch(() => []),
  ]);
  if (state.sel.type !== 'stash' || state.sel.ref !== ref) return;
  const [hash = '', author = '', date = '', subject = entry.msg] = info.stdout.split('\n');
  left.innerHTML = `<div class="cinfo"><div class="subject">${esc(subject)}</div>
      <div class="meta">${esc(ref)} · ${hash.slice(0, 7)}</div>
      <div class="meta"><b>${esc(author)}</b> · ${date ? new Date(date).toLocaleString(kgLocale()) : ''}</div></div>
    <div class="st-actions"><button data-st="apply" class="primary">Apply</button><button data-st="pop">Pop</button><button data-st="branch">Branch…</button><button data-st="drop" class="danger">Drop</button></div>
    <div class="fhead"><span>Stashed files (${files.length})</span><span class="fh-act">${viewToggle('stash', files)}</span></div>` +
    renderFileList(files, 'stash', true, (f, d) => fileRow(f.path, f.code, { area: 'stash', depth: d }));
  const keep = state.file && files.some((f) => f.path === state.file.path);
  if (keep) showFileDiff();
  else { state.file = null; $('#detail-right').innerHTML = '<div class="empty">Select a file to see its changes</div>'; }
}

async function showStashFileDiff(path) {
  const { ref } = state.sel;
  let r = await window.api.git(state.repo, ['diff', '-M', `${ref}^1`, ref, '--', path]);
  if (!r.stdout.trim()) r = await window.api.git(state.repo, ['show', '--format=', `${ref}^3`, '--', path]);
  if (!state.file || state.file.path !== path || state.file.area !== 'stash') return;
  const seg = (v, label) => `<button data-view="${v}" class="${diffView === v ? 'primary' : ''}">${label}</button>`;
  $('#detail-right').innerHTML = `<div class="diff-title"><span>${esc(path)}</span><span class="seg">${seg('unified', 'Unified')}${seg('split', 'Side by side')}</span></div>` + renderDiff(r.stdout, null, path);
}

async function stashAction(kind) {
  const { ref } = state.sel;
  const entry = state.stashes.find((s) => s.ref === ref);
  if (!entry) return;
  if (kind === 'apply') return run('Apply stash', () => gitAllowConflict(['stash', 'apply', ref]));
  if (kind === 'pop') return run('Pop stash', () => gitAllowConflict(['stash', 'pop', ref]));
  if (kind === 'drop') {
    if (!(await confirm2('Drop stash', `Drop "${entry.msg}"? It can only be recovered through git fsck.`, true))) return;
    state.sel = { type: 'wc' };
    return run('Drop stash', () => git(['stash', 'drop', ref]));
  }
  if (kind === 'branch') {
    const name = await prompt2('Branch from stash', 'New branch name');
    if (!name) return;
    state.sel = { type: 'wc' };
    return run('Branch from stash', () => git(['stash', 'branch', name, ref]));
  }
}

$('#detail-left').addEventListener('click', (e) => {
  const b = e.target.closest('[data-st]');
  if (b && state.sel.type === 'stash') stashAction(b.dataset.st);
});

/* ---------- drop-down next to the Stash button ---------- */

// Recent stashes (click one to look at it) and "Save Snapshot…": a stash that leaves the working copy untouched.
async function saveSnapshot() {
  if (state.busy || !state.repo) return;
  const v = await modal({ title: 'Save snapshot', body: '<p class="hint">Stores the current changes to tracked files as a stash and leaves them in the working copy.</p>',
    fields: [{ label: 'Message (optional)', value: '' }], buttons: [{ label: 'Cancel', value: false }, { label: 'Save snapshot', value: true, primary: true }] });
  if (!v) return;
  const msg = (v[0] || '').trim() || `Snapshot on ${state.head || 'HEAD'}`;
  await run('Save snapshot', async () => {
    const hash = (await git(['stash', 'create', msg])).trim();
    if (!hash) throw new Error('There are no local changes to save.');
    await git(['stash', 'store', '-m', msg, hash]);
  });
}

function stashMenu() {
  if (!state.repo) return;
  const items = [{ header: true, label: 'Recent Stashes' }];
  if (!state.stashes.length) items.push({ label: 'No stashes', off: true, run: () => {} });
  for (const s of state.stashes.slice(0, 6)) items.push({ label: s.msg, raw: true, run: () => selectStash(s.ref) });
  items.push('-', { label: 'Save Snapshot…', run: () => saveSnapshot() });
  toolbarMenu($('#tb-stash-menu'), items);
}

$('#tb-stash-menu').onclick = () => stashMenu();
