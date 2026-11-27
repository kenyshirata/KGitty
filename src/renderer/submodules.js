'use strict';
// Git submodules: list them in the sidebar, add / initialise / update / sync / remove, and open one as its own tab.

async function loadSubmodules() {
  // `git submodule status` is slow on Windows (about a second), so skip it for repositories without a .gitmodules file.
  const gm = await window.api.readFile(state.repo, '.gitmodules');
  if (!gm.ok) { state.submodules = []; return; }
  const [status, cfg] = await Promise.all([
    window.api.git(state.repo, ['submodule', 'status']),
    window.api.git(state.repo, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url|branch)$']),
  ]);
  const byPath = {};
  const names = {};
  for (const line of cfg.stdout.split('\n').filter(Boolean)) {
    const m = /^submodule\.(.+)\.(path|url|branch) (.*)$/.exec(line);
    if (!m) continue;
    (names[m[1]] = names[m[1]] || {})[m[2]] = m[3];
  }
  Object.entries(names).forEach(([name, v]) => { if (v.path) byPath[v.path] = { name, ...v }; });
  state.submodules = status.stdout.split('\n').filter(Boolean).map((l) => {
    const m = /^([ +\-U])([0-9a-f]+) (.+?)(?: \((.*)\))?$/.exec(l);
    if (!m) return null;
    const [, flag, sha, path, desc] = m;
    const c = byPath[path] || {};
    return { flag, sha, path, desc: desc || '', url: c.url || '', branch: c.branch || '' };
  }).filter(Boolean);
}

function submoduleBadge(s) {
  if (s.flag === '-') return '<span class="ab">not initialized</span>';
  if (s.flag === '+') return '<span class="ab">⚠ changed</span>';
  if (s.flag === 'U') return '<span class="ab">⚠ conflict</span>';
  return '';
}

function submoduleSection() {
  const items = state.submodules.map((s) => `<div class="sb-item" data-kind="submodule" data-name="${esc(s.path)}" title="${esc(s.path + ' @ ' + s.sha.slice(0, 7) + (s.url ? '\n' + s.url : ''))}">${esc(s.path)}${submoduleBadge(s)}</div>`);
  const uninit = state.submodules.some((s) => s.flag === '-');
  return `<div class="sb-head">Submodules<span class="sb-tools">${state.submodules.length ? `<button class="sb-tool" data-act="update-submodules" title="${uninit ? 'Initialize and update all' : 'Update all'}">⟳</button>` : ''}<button class="sb-tool" data-act="add-submodule" title="Add submodule">＋</button></span></div>${items.join('')}`;
}

const subArgs = (cmd, path, extra = []) => ['submodule', cmd, ...extra, '--', path];

function submoduleMenu(e, path) {
  e.preventDefault();
  const s = state.submodules.find((x) => x.path === path);
  if (!s) return;
  const ready = s.flag !== '-';
  ctxMenu(e.clientX, e.clientY, [
    ready && { label: 'Open in new tab', action: () => openRepo(state.repo + '/' + path) },
    { label: ready ? 'Update to recorded commit' : 'Initialize and update', action: () => run('Update submodule', () => git(['submodule', 'update', '--init', '--recursive', '--', path])) },
    { label: 'Update to latest on remote', action: () => run('Update submodule', () => git(['submodule', 'update', '--init', '--remote', '--', path])) },
    { label: 'Sync URL from .gitmodules', action: () => run('Sync submodule', () => git(subArgs('sync', path))) },
    '-',
    ready && { label: 'Deinitialize', action: async () => { if (await confirm2('Deinitialize submodule', `Remove the working copy of ${path}? Local changes inside it are lost.`, true)) run('Deinitialize submodule', () => git(subArgs('deinit', path, ['--force']))); } },
    { label: 'Remove submodule…', action: async () => { if (await confirm2('Remove submodule', `Remove ${path} from the repository and .gitmodules? The removal is staged.`, true)) run('Remove submodule', async () => { try { await git(subArgs('deinit', path, ['--force'])); } catch { /* not initialized */ } await git(['rm', '-f', '--', path]); }); } },
    '-',
    { label: 'Copy path', action: () => navigator.clipboard.writeText(path) },
    s.url && { label: 'Copy URL', action: () => navigator.clipboard.writeText(s.url) },
  ].filter(Boolean));
}

function addSubmoduleDialog() {
  return new Promise((resolve) => {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="modal"><h3>Add submodule</h3>
      <div class="field"><label>Repository URL</label><input type="text" id="sm-url" placeholder="https://github.com/user/lib.git"></div>
      <div class="field"><label>Path inside this repository</label><input type="text" id="sm-path"></div>
      <div class="field"><label>Branch to track (optional)</label><input type="text" id="sm-branch"></div>
      <div class="btns"><button id="sm-cancel">Cancel</button><button class="primary" id="sm-ok">Add</button></div></div>`;
    ov.classList.remove('hidden');
    const url = $('#sm-url'), path = $('#sm-path');
    let edited = false;
    const close = (v) => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onkeydown = null; resolve(v); };
    url.oninput = () => { if (!edited) path.value = repoNameFromUrl(url.value); };
    path.oninput = () => { edited = true; };
    const submit = () => { if (url.value.trim() && path.value.trim()) close({ url: url.value.trim(), path: path.value.trim(), branch: $('#sm-branch').value.trim() }); };
    $('#sm-cancel').onclick = () => close(null);
    $('#sm-ok').onclick = submit;
    ov.onkeydown = (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter') submit(); };
    url.focus();
  });
}

async function addSubmodule() {
  if (state.busy) return;
  const c = await addSubmoduleDialog();
  if (!c) return;
  await run('Add submodule', () => git(['submodule', 'add', ...(c.branch ? ['-b', c.branch] : []), '--', c.url, c.path]));
}

const updateAllSubmodules = () => run('Update submodules', () => git(['submodule', 'update', '--init', '--recursive']));
