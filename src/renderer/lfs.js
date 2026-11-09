'use strict';
// Git LFS: tracked patterns in the sidebar, an LFS file browser, track / untrack / fetch / pull / prune,
// "LFS" badges on changed files and a readable view of pointer-file diffs. Needs the git-lfs extension.

let lfsInstalled = null;

async function lfsAvailable() {
  if (lfsInstalled === null) lfsInstalled = (await window.api.git(state.repo, ['lfs', 'version'])).code === 0;
  return lfsInstalled;
}

async function loadLfs() {
  const [available, ga] = await Promise.all([lfsAvailable(), window.api.readFile(state.repo, '.gitattributes')]);
  const patterns = ga.ok
    ? ga.text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /\bfilter=lfs\b/.test(l)).map((l) => l.split(/\s+/)[0])
    : [];
  state.lfs = { available, patterns };
}

// Flags changed files that Git LFS manages (filter=lfs) so the file lists can show a badge.
async function markLfsFiles(files) {
  if (!files.length) return;
  const ga = await window.api.readFile(state.repo, '.gitattributes');
  if (!ga.ok || !/filter=lfs/.test(ga.text)) return;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const r = await window.api.git(state.repo, ['check-attr', '-z', 'filter', '--', ...files.slice(0, 500).map((f) => f.path)]);
  const parts = r.stdout.split('\0');
  for (let i = 0; i + 2 < parts.length; i += 3) if (parts[i + 2] === 'lfs' && byPath.has(parts[i])) byPath.get(parts[i]).lfs = true;
}

function lfsSection() {
  const l = state.lfs;
  if (!l.available && !l.patterns.length) return '';
  const tools = l.available
    ? '<button class="sb-tool" data-act="lfs-files" title="LFS files">📄</button><button class="sb-tool" data-act="lfs-pull" title="Download LFS objects (git lfs pull)">⇣</button><button class="sb-tool" data-act="lfs-track" title="Track a pattern with Git LFS">＋</button>'
    : '';
  const items = l.patterns.map((p) => `<div class="sb-item" data-kind="lfs" data-name="${esc(p)}" title="Tracked by Git LFS">${esc(p)}</div>`);
  if (!l.available) items.push('<div class="sb-item" style="color:var(--err)" title="Install Git LFS from git-lfs.com">git-lfs is not installed</div>');
  return `<div class="sb-head">Git LFS<span class="sb-tools">${tools}</span></div>${items.join('')}`;
}

function lfsMenu(e, pattern) {
  e.preventDefault();
  ctxMenu(e.clientX, e.clientY, [
    state.lfs.available && { label: 'Stop tracking with LFS', action: () => lfsUntrack(pattern) },
    { label: 'Copy pattern', action: () => navigator.clipboard.writeText(pattern) },
  ].filter(Boolean));
}

async function lfsTrack() {
  const pattern = await prompt2('Track with Git LFS', 'File pattern (for example *.psd or assets/**)');
  if (!pattern) return;
  await run('LFS track', async () => {
    await git(['lfs', 'track', '--', pattern]);
    setStatus('Tracking ' + pattern + ' — commit .gitattributes to share it');
  });
}

async function lfsUntrack(pattern) {
  if (!(await confirm2('Stop tracking', `Stop tracking ${pattern} with Git LFS? Files already committed stay in LFS until they are migrated.`, true))) return;
  await run('LFS untrack', () => git(['lfs', 'untrack', '--', pattern]));
}

const lfsFetch = () => run('LFS fetch', () => git(['lfs', 'fetch']));
const lfsPull = () => run('LFS pull', () => git(['lfs', 'pull']));
const lfsPrune = () => run('LFS prune', () => git(['lfs', 'prune']));
const lfsInstall = () => run('Install Git LFS', () => git(['lfs', 'install', '--local']));

async function lfsFilesDialog() {
  const r = await window.api.git(state.repo, ['lfs', 'ls-files', '--long', '--size']);
  if (r.code !== 0) return notice('Git LFS', (r.stderr || 'git lfs ls-files failed').trim());
  const rows = r.stdout.split('\n').filter(Boolean).map((l) => {
    const m = /^([0-9a-f]{40,64}) ([*-]) (.+?)(?: \(([^()]*)\))?$/.exec(l);
    return m ? { oid: m[1], local: m[2] === '*', path: m[3], size: m[4] || '' } : null;
  }).filter(Boolean);

  const ov = $('#overlay');
  let filter = '';
  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.oninput = ov.onkeydown = null; };
  const draw = () => {
    const v = rows.filter((x) => !filter || x.path.toLowerCase().includes(filter));
    const missing = rows.filter((x) => !x.local).length;
    ov.innerHTML = `<div class="modal wide"><h3>Git LFS files <small class="dim">${rows.length} file(s)${missing ? `, ${missing} not matching the committed version` : ''}</small></h3>
      <div class="bd-tools"><input type="search" id="lfs-filter" placeholder="Filter…" value="${esc(filter)}">
        <button data-lfs="fetch" title="Download objects for all refs into the LFS cache">Fetch</button><button data-lfs="pull" title="Fetch and check out the files">Pull</button><button data-lfs="prune" title="Delete old local LFS objects">Prune</button><button data-lfs="install" title="Set up the Git LFS hooks in this repository">Install</button></div>
      <div class="rb-list lfs-list">${v.map((x) => `<div class="bd-row"><span class="st ${x.local ? 'A' : 'M'}" title="${x.local ? 'Downloaded and identical to the committed version' : 'Pointer only, or different from the committed version'}">${x.local ? '●' : '○'}</span><span class="bd-name" title="${esc(x.path)}">${esc(x.path)}</span><span class="bd-date">${esc(x.size)}</span>${x.local ? '' : `<button class="sb-tool" data-dl="${esc(x.path)}">Download</button>`}<span class="bd-date lfs-oid">${x.oid.slice(0, 10)}</span></div>`).join('') || '<div class="empty">No LFS files</div>'}</div>
      <div class="rb-foot"><span></span><span class="btns"><button class="primary" id="lfs-close">Close</button></span></div></div>`;
    const f = $('#lfs-filter');
    f.focus();
    f.setSelectionRange(f.value.length, f.value.length);
  };
  ov.classList.remove('hidden');
  draw();
  ov.oninput = (e) => { if (e.target.id === 'lfs-filter') { filter = e.target.value.trim().toLowerCase(); draw(); } };
  ov.onclick = (e) => {
    if (e.target.closest('#lfs-close')) return close();
    const dl = e.target.closest('[data-dl]');
    if (dl) { const p = dl.dataset.dl; close(); return run('LFS download', () => git(['lfs', 'pull', `--include=${p}`])); }
    const b = e.target.closest('[data-lfs]');
    if (!b) return;
    close();
    ({ fetch: lfsFetch, pull: lfsPull, prune: lfsPrune, install: lfsInstall })[b.dataset.lfs]();
  };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
}

/* ---------- pointer diffs ---------- */

const LFS_POINTER = /^[-+ ]version https:\/\/git-lfs\.github\.com\/spec\/v1$/m;

const humanSize = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = +n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(v < 10 ? 2 : 1) : v} ${u[i]}`;
};

function lfsDiffHtml(text) {
  const side = { '-': {}, '+': {} };
  for (const l of text.split('\n')) {
    const sign = l[0];
    if (sign !== '-' && sign !== '+') continue;
    const body = l.slice(1);
    if (body.startsWith('oid sha256:')) side[sign].oid = body.slice(11).trim();
    else if (body.startsWith('size ')) side[sign].size = body.slice(5).trim();
  }
  const card = (label, s) => (s.oid || s.size
    ? `<div class="lfs-side"><div class="clabel">${label}</div><div>${s.size ? `<b>${humanSize(s.size)}</b> <span class="dim">(${esc(s.size)} bytes)</span>` : ''}</div><div class="lfs-oid dim">${esc((s.oid || '').slice(0, 24))}${s.oid ? '…' : ''}</div></div>`
    : `<div class="lfs-side dim"><div class="clabel">${label}</div><div>—</div></div>`);
  return `<div class="lfs-diff"><div class="lfs-title">Git LFS object <span class="lfs-badge">LFS</span></div>
    <div class="lfs-sides">${card('Before', side['-'])}${card('After', side['+'])}</div>
    <p class="dim">This file is stored with Git LFS, so only its pointer is part of the diff.</p></div>`;
}
