'use strict';
// Repository manager: a searchable list of repositories organised in groups, with the current branch and
// number of changes of each, folder scanning, and quick access to the recently opened ones.

const RM_KEY = 'repoMgr';

function rmLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(RM_KEY));
    if (d && Array.isArray(d.repos)) return { repos: d.repos, groups: d.groups || [], collapsed: d.collapsed || {} };
  } catch { /* ignore */ }
  return { repos: [], groups: [], collapsed: {} };
}
const rmSave = (d) => { try { localStorage.setItem(RM_KEY, JSON.stringify(d)); } catch { /* ignore */ } };
const rmNorm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const rmBase = (p) => rmNorm(p).split('/').pop() || p;

const rmInfo = new Map(); // path -> { at, branch, changes, missing }

async function rmProbe(path) {
  const hit = rmInfo.get(path);
  if (hit && Date.now() - hit.at < 20000) return hit;
  const head = await window.api.git(path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  let info;
  if (head.code !== 0 && /not a git repository|cannot change to|No such file|ENOENT|not a directory/i.test(head.stderr)) info = { at: Date.now(), missing: true };
  else {
    const st = await window.api.git(path, ['status', '--porcelain']);
    let branch = head.stdout.trim();
    if (branch === 'HEAD') branch = '(detached)';
    if (!branch) branch = '(no commits)';
    info = { at: Date.now(), branch, changes: st.stdout.split('\n').filter(Boolean).length };
  }
  rmInfo.set(path, info);
  return info;
}

function rmChips(info) {
  if (!info) return '';
  if (info.missing) return '<span class="rm-chip rm-missing">not found</span>';
  return `<span class="rm-chip" title="Current branch">⑂ ${esc(info.branch)}</span>${info.changes ? `<span class="rm-chip rm-dirty" title="Uncommitted changes">${info.changes} change${info.changes > 1 ? 's' : ''}</span>` : ''}`;
}

async function repoManager() {
  const ov = $('#overlay');
  let data = rmLoad();
  let query = '';

  const close = () => { ov.classList.add('hidden'); ov.innerHTML = ''; ov.onclick = ov.oninput = ov.onkeydown = ov.oncontextmenu = null; mgrRefresh(); };
  const save = () => rmSave(data);
  const open = (path) => { close(); openRepo(path); };

  const managed = () => new Set(data.repos.map((r) => rmNorm(r.path)));
  const recentOnly = () => { const m = managed(); return recents().filter((p) => !m.has(rmNorm(p))); };
  const matches = (name, path) => !query || (name + ' ' + path).toLowerCase().includes(query);

  const row = (path, name, extra = '') => `<div class="rm-row" data-path="${esc(path)}" ${extra}>
    <span class="rm-ico">▣</span><span class="rm-name">${esc(name)}</span><span class="rm-chips" data-chips="${esc(path)}">${rmChips(rmInfo.get(path))}</span><span class="rm-path dim" title="${esc(path)}">${esc(path)}</span></div>`;

  const section = (key, title, body, count, groupName) => {
    const closed = !query && data.collapsed[key];
    return `<div class="rm-group"><div class="rm-ghead" data-gkey="${esc(key)}" ${groupName != null ? `data-group="${esc(groupName)}"` : ''}><span>${closed ? '▸' : '▾'}</span><span>${esc(title)}</span><span class="dim">${count}</span></div>${closed ? '' : body}</div>`;
  };

  const draw = () => {
    const sections = [];
    const rec = recentOnly().filter((p) => matches(rmBase(p), p));
    if (rec.length) sections.push(section('@recent', 'Recent', rec.map((p) => row(p, rmBase(p), 'data-recent="1"')).join(''), rec.length));
    const byGroup = (g) => data.repos.filter((r) => (r.group && data.groups.includes(r.group) ? r.group : '') === g && matches(r.name, r.path));
    for (const g of data.groups) {
      const list = byGroup(g);
      if (query && !list.length) continue;
      sections.push(section('g:' + g, g, list.map((r) => row(r.path, r.name)).join('') || '<div class="rm-empty dim">Empty — right-click a repository and choose “Move to group”.</div>', list.length, g));
    }
    const loose = byGroup('');
    if (loose.length) sections.push(section('@none', data.groups.length ? 'Ungrouped' : 'Repositories', loose.map((r) => row(r.path, r.name)).join(''), loose.length));
    const total = data.repos.length;
    ov.innerHTML = `<div class="modal wide rm"><h3>Repositories <small class="dim">${total} saved</small></h3>
      <div class="rm-tools"><input type="search" id="rm-q" placeholder="Search repositories…" value="${esc(query)}">
        <button data-rm="add">Add…</button><button data-rm="scan" title="Find every repository inside a folder">Scan folder…</button><button data-rm="clone">Clone…</button><button data-rm="group">New group</button></div>
      <div class="rm-list">${sections.join('') || `<div class="empty">${query ? 'No repository matches' : 'No repositories yet — add one, scan a folder or clone a repository.'}</div>`}</div>
      <div class="btns"><button class="primary" id="rm-close">Close</button></div></div>`;
    const q = $('#rm-q');
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
    fillInfo();
    ov.onkeydown = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && e.target.id === 'rm-q') { const first = ov.querySelector('.rm-row'); if (first) open(first.dataset.path); }
    };
  };

  // Branch and change counts are loaded in the background so the list opens instantly.
  const fillInfo = async () => {
    const paths = [...new Set([...ov.querySelectorAll('.rm-row')].map((r) => r.dataset.path))];
    let i = 0;
    const worker = async () => {
      while (i < paths.length && !ov.classList.contains('hidden')) {
        const p = paths[i++];
        const info = await rmProbe(p);
        ov.querySelectorAll('[data-chips]').forEach((el) => { if (el.dataset.chips === p) el.innerHTML = rmChips(info); });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  };

  const addPath = async (dir) => {
    const r = await window.api.git(dir, ['rev-parse', '--show-toplevel']);
    if (r.code !== 0) return null;
    const top = rmNorm(r.stdout.trim());
    if (!managed().has(top)) data.repos.push({ path: top, name: rmBase(top), group: '' });
    return top;
  };

  const rename = async (path) => {
    const r = data.repos.find((x) => rmNorm(x.path) === rmNorm(path));
    const name = await prompt2('Rename', 'Display name', r ? r.name : rmBase(path));
    if (name && r) { r.name = name; save(); }
    draw();
  };

  const newGroup = async () => {
    const name = await prompt2('New group', 'Group name');
    if (name && !data.groups.includes(name)) { data.groups.push(name); save(); }
    draw();
    return name;
  };

  const moveTo = async (path, group) => {
    let r = data.repos.find((x) => rmNorm(x.path) === rmNorm(path));
    if (!r) { await addPath(path); r = data.repos.find((x) => rmNorm(x.path) === rmNorm(path)); }
    if (!r) return;
    if (group === null) { group = await prompt2('New group', 'Group name'); if (!group) return draw(); if (!data.groups.includes(group)) data.groups.push(group); }
    r.group = group;
    save();
    draw();
  };

  const rowMenu = (e, rowEl) => {
    e.preventDefault();
    const path = rowEl.dataset.path;
    const isManaged = !rowEl.dataset.recent;
    ctxMenu(e.clientX, e.clientY, [
      { label: 'Open', action: () => open(path) },
      { label: 'Show in file manager', action: () => window.api.reveal(path) },
      '-',
      ...(isManaged ? [{ label: 'Rename…', action: () => rename(path) }] : [{ label: 'Add to the list', action: async () => { await addPath(path); save(); draw(); } }]),
      ...data.groups.map((g) => ({ label: 'Move to “' + g + '”', action: () => moveTo(path, g) })),
      { label: 'Move to a new group…', action: () => moveTo(path, null) },
      ...(isManaged ? [{ label: 'Move to Ungrouped', action: () => moveTo(path, '') }] : []),
      '-',
      isManaged
        ? { label: 'Remove from the list', action: () => { data.repos = data.repos.filter((r) => rmNorm(r.path) !== rmNorm(path)); save(); draw(); } }
        : { label: 'Remove from recent', action: () => { localStorage.setItem('recent', JSON.stringify(recents().filter((x) => x !== path))); renderRecent(); draw(); } },
    ]);
  };

  const groupMenu = (e, head) => {
    const g = head.dataset.group;
    if (g == null) return;
    e.preventDefault();
    ctxMenu(e.clientX, e.clientY, [
      { label: 'Rename group…', action: async () => {
        const n = await prompt2('Rename group', 'Group name', g);
        if (n && n !== g && !data.groups.includes(n)) {
          data.groups[data.groups.indexOf(g)] = n;
          data.repos.forEach((r) => { if (r.group === g) r.group = n; });
          save();
        }
        draw();
      } },
      { label: 'Delete group (keeps the repositories)', action: () => { data.groups = data.groups.filter((x) => x !== g); data.repos.forEach((r) => { if (r.group === g) r.group = ''; }); save(); draw(); } },
    ]);
  };

  ov.classList.remove('hidden');
  draw();

  ov.oninput = (e) => { if (e.target.id === 'rm-q') { query = e.target.value.trim().toLowerCase(); draw(); } };
  ov.oncontextmenu = (e) => {
    const r = e.target.closest('.rm-row');
    if (r) return rowMenu(e, r);
    const h = e.target.closest('.rm-ghead');
    if (h) groupMenu(e, h);
  };
  ov.onclick = async (e) => {
    if (e.target.closest('#rm-close')) return close();
    const b = e.target.closest('[data-rm]');
    if (b) {
      const act = b.dataset.rm;
      if (act === 'add') {
        const dir = await window.api.pickFolder();
        if (!dir) return;
        const top = await addPath(dir);
        if (!top) await notice('Not a repository', dir + ' is not a Git repository.');
        else save();
        return draw();
      }
      if (act === 'scan') {
        const dir = await window.api.pickFolder();
        if (!dir) return;
        const el = $('.rm-list');
        if (el) el.innerHTML = '<div class="empty">Scanning…</div>';
        const found = await window.api.scanRepos(dir, 4);
        const before = data.repos.length;
        for (const p of found.paths) if (!managed().has(rmNorm(p))) data.repos.push({ path: rmNorm(p), name: rmBase(p), group: '' });
        save();
        draw();
        const added = data.repos.length - before;
        return setStatus(`Scan finished — ${added} new repositor${added === 1 ? 'y' : 'ies'}${found.truncated ? ' (stopped at the limit; scan a smaller folder for the rest)' : ''}`);
      }
      if (act === 'clone') { close(); return cloneRepo(); }
      if (act === 'group') return newGroup();
    }
    const h = e.target.closest('.rm-ghead');
    if (h) { data.collapsed[h.dataset.gkey] = !data.collapsed[h.dataset.gkey]; save(); return draw(); }
    const r = e.target.closest('.rm-row');
    if (r) open(r.dataset.path);
  };
}

// mgrtab.js loads after this file.
$('#tb-repos').onclick = () => openMgrTab();
$('#btn-repos').onclick = () => openMgrTab();
